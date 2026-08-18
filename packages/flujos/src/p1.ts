import {
  crearRegistrador, definirTarea, ejecutarTarea, exigirPresupuesto,
  type MensajeLlm,
} from '@gc/ai'
import { cargarPerfilVigente, contextoDeMarca } from '@gc/brand'
import { esquema, type BaseDeDatos } from '@gc/db'
import { modelosDelNivel } from '@gc/operaciones'
import { definirPaso, type DefinicionDeFlujo } from '@gc/pipeline'
import { permanente } from '@gc/shared'
import { and, eq } from 'drizzle-orm'
import { readFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import { Encargo, Estrategia, validarPeriodo, type TipoEncargo, type TipoEstrategia } from '@gc/strategy'
import type { Dependencias } from './tipos.js'

export const TAREA_ESTRATEGIA = definirTarea({
  nombre: 'generar_estrategia',
  nivel: 'razonamiento',
  esquema: Estrategia,
  temperatura: 0.6,
  maxTokensSalida: 3000,
})

// Aviso para quien despliegue esto: `fileURLToPath` corre en tiempo de
// ejecución con la ruta absoluta de la máquina donde vive este checkout —
// funciona en desarrollo local y en cualquier build hecho y ejecutado en la
// misma máquina/imagen, pero si el CLI (o el worker que lo reemplace) corre
// en una máquina distinta a la que generó el build, con una ruta de proyecto
// distinta, la ruta absoluta ya no existe y `readFile(RUTA_PROMPT)` falla
// con ENOENT.
const RUTA_PROMPT = fileURLToPath(new URL('./prompts/generar-estrategia.md', import.meta.url))

export interface EntradaP1 {
  brandId: string
  period: string
}

export interface SalidaP1 {
  strategyId: string
  estrategia: TipoEstrategia
}

/** Lo que el paso del modelo le entrega al de persistencia. */
interface SalidaDeLaGeneracion {
  brandId: string
  period: string
  datos: TipoEstrategia
  version: number
}

export function crearFlujoEstrategia(deps: Dependencias): DefinicionDeFlujo {
  const pasoGenerar = definirPaso<EntradaP1, SalidaDeLaGeneracion>({
    nombre: 'generar_estrategia',
    // Explícito aunque coincida con el valor por omisión: quien cambie la forma
    // de `SalidaDeLaGeneracion` tiene que ver el número al lado para acordarse
    // de subirlo.
    versionDeSalida: 1,
    ejecutar: async (entrada, ctx) => {
      // Un periodo con formato inválido no cuesta nada: se valida antes de
      // tocar la base o el presupuesto.
      validarPeriodo(entrada.period)

      // Se consulta el estado antes del presupuesto y de cualquier llamada al
      // modelo: si la estrategia ya salió de borrador el upsert la va a
      // rechazar igual, y hoy eso se pagaba con una o dos llamadas primero.
      const estadoPrevio = await estadoDeLaEstrategia(ctx.db, entrada.brandId, entrada.period)
      if (estadoPrevio !== null && estadoPrevio !== 'borrador') {
        throw estrategiaNoRegenerable(entrada, estadoPrevio, ctx.brandSlug)
      }

      const encargo = await encargoDelTrimestre(ctx.db, entrada.brandId, entrada.period, ctx.brandSlug)

      await exigirPresupuesto(ctx.db, entrada.brandId, new Date(), ctx.brandSlug)

      const { version, perfil } = await cargarPerfilVigente(ctx.db, entrada.brandId, ctx.brandSlug)
      const instrucciones = await readFile(RUTA_PROMPT, 'utf8')

      // Se resuelve antes de la llamada, no después: si la organización no
      // eligió modelo para este nivel, el `permanente` de `modelosDelNivel`
      // tiene que cortar antes de gastar, igual que la comprobación de
      // presupuesto de arriba.
      const modelos = await modelosDelNivel(ctx.db, ctx.organizationId, TAREA_ESTRATEGIA.nivel)

      const mensajes: MensajeLlm[] = [
        { rol: 'sistema', texto: instrucciones },
        {
          rol: 'usuario',
          texto: [
            contextoDeMarca(perfil),
            '',
            textoDelEncargo(encargo),
            '',
            `## Lo que tienes que producir`,
            `Genera la estrategia de contenido para el periodo ${entrada.period}.`,
          ].join('\n'),
        },
      ]

      const { datos } = await ejecutarTarea(TAREA_ESTRATEGIA, mensajes, {
        cliente: deps.cliente,
        modelos,
        ...(deps.env !== undefined ? { env: deps.env } : {}),
        registrarUso: crearRegistrador(ctx.db, {
          organizationId: ctx.organizationId,
          brandId: entrada.brandId,
          runId: ctx.runId,
          brandProfileVersion: version,
        }),
      })

      return { brandId: entrada.brandId, period: entrada.period, datos, version }
    },
  })

  const pasoPersistir = definirPaso<SalidaDeLaGeneracion, SalidaP1>({
    nombre: 'persistir_estrategia',
    // Explícito aunque coincida con el valor por omisión: quien cambie la forma
    // de `SalidaP1` tiene que ver el número al lado para acordarse de subirlo.
    versionDeSalida: 1,
    ejecutar: async (entrada, ctx) => {
      const { brandId, period, datos, version } = entrada

      const [fila] = await ctx.db
        .insert(esquema.strategies)
        .values({
          organizationId: ctx.organizationId,
          brandId,
          period,
          data: datos,
          brandProfileVersion: version,
        })
        .onConflictDoUpdate({
          target: [esquema.strategies.brandId, esquema.strategies.period],
          // `status` queda fuera del set a propósito: un borrador sigue siendo
          // borrador, y el setWhere impide tocar una estrategia ya aprobada.
          set: { data: datos, brandProfileVersion: version },
          setWhere: eq(esquema.strategies.status, 'borrador'),
        })
        .returning()

      // Sin fila devuelta, el setWhere descartó la actualización: la estrategia
      // dejó de estar en borrador entre la comprobación previa y este upsert.
      // Se escala en vez de descartar en silencio el trabajo de revisión humana.
      if (!fila) {
        const estado = await estadoDeLaEstrategia(ctx.db, brandId, period)
        throw estrategiaNoRegenerable({ brandId, period }, estado ?? 'desconocido', ctx.brandSlug)
      }

      return { strategyId: fila.id, estrategia: datos }
    },
  })

  return { nombre: 'p1_estrategia', pasos: [pasoGenerar, pasoPersistir] }
}

async function estadoDeLaEstrategia(
  db: BaseDeDatos,
  brandId: string,
  period: string,
): Promise<string | null> {
  const [fila] = await db
    .select({ status: esquema.strategies.status })
    .from(esquema.strategies)
    .where(
      and(eq(esquema.strategies.brandId, brandId), eq(esquema.strategies.period, period)),
    )
  return fila?.status ?? null
}

async function encargoDelTrimestre(
  db: BaseDeDatos, brandId: string, period: string, brandSlug?: string,
): Promise<TipoEncargo> {
  const [fila] = await db
    .select({ data: esquema.strategyBriefs.data })
    .from(esquema.strategyBriefs)
    .where(and(
      eq(esquema.strategyBriefs.brandId, brandId),
      eq(esquema.strategyBriefs.period, period),
    ))
    .limit(1)

  if (!fila) {
    throw permanente(
      `No hay encargo escrito para ${period}. La estrategia se genera a partir de lo que ` +
        'quieres lograr el trimestre, así que sin eso no hay de dónde partir. ' +
        `Escríbelo en ${pantallaDelEncargo(brandSlug)}.`,
    )
  }

  const leido = Encargo.safeParse(fila.data)
  if (!leido.success) {
    throw permanente(
      `El encargo de ${period} no cumple su esquema: ${leido.error.message} ` +
        `Corrígelo en ${pantallaDelEncargo(brandSlug)}.`,
    )
  }
  return leido.data
}

/**
 * Nombra la pantalla donde se escribe el encargo, para quien corre
 * `pnpm cli estrategia:generar` y no tiene el formulario a la vista. Con
 * `brandSlug` —lo normal, porque el CLI y la web siempre lo conocen antes de
 * encolar— da la ruta exacta; sin él (una corrida reanudada de una versión
 * más vieja de la corrida, por ejemplo) queda una referencia genérica en vez
 * de una ruta con `undefined` adentro.
 */
function pantallaDelEncargo(brandSlug?: string): string {
  return brandSlug !== undefined
    ? `la pantalla de estrategia de la marca (\`/${brandSlug}/estrategia\`)`
    : 'la pantalla de estrategia de la marca, en la web'
}

/**
 * El encargo, como sección propia del mensaje.
 *
 * Va separado de `contextoDeMarca` a propósito: mezclarlos invita al modelo a
 * tratar como permanente algo que dura tres meses. El título es
 * «El encargo del trimestre» porque el instructivo del sistema nombra «el
 * encargo» al pedir el tope de publicaciones por semana, los canales y la
 * métrica: tiene que coincidir con el título real de la sección que los
 * declara, y no con el de la instrucción final que solo pide generar el
 * periodo.
 */
function textoDelEncargo(e: TipoEncargo): string {
  const opcional = (etiqueta: string, valor: string) =>
    valor.trim() === '' ? [] : [`- ${etiqueta}: ${valor}`]

  return [
    '## El encargo del trimestre',
    `- Objetivo: ${e.objetivo}`,
    `- Cómo se mide: ${e.comoSeMide}`,
    `- Capacidad total: ${e.publicacionesPorSemana} publicaciones por semana, sumando canales`,
    `- Canales disponibles: ${e.canalesDisponibles.join(', ')}`,
    ...opcional('Qué está pasando', e.queEstaPasando),
    ...opcional('Qué funcionó el trimestre pasado', e.queFunciono),
    ...opcional('Qué no funcionó', e.queNoFunciono),
    ...opcional('Qué evitar este trimestre', e.queEvitar),
    ...opcional('Además', e.algoMas),
  ].join('\n')
}

/**
 * El remedio que se indica es el único que existe: el upsert exige
 * `status = 'borrador'`, así que archivar no destraba nada —una estrategia
 * archivada queda tan irregenerable como una aprobada.
 */
function estrategiaNoRegenerable(entrada: EntradaP1, estado: string, nombreVisible?: string) {
  return permanente(
    `La estrategia de ${entrada.period} para la marca ${nombreVisible ?? entrada.brandId} está en ` +
      `estado "${estado}" y solo se regenera una que esté en borrador. ` +
      `Devuélvela a "borrador" para regenerarla.`,
  )
}
