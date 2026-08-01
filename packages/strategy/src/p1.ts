import {
  crearRegistrador, definirTarea, ejecutarTarea, exigirPresupuesto,
  type MensajeLlm,
} from '@gc/ai'
import { cargarPerfilVigente, contextoDeMarca } from '@gc/brand'
import { esquema, type BaseDeDatos } from '@gc/db'
import { definirPaso, type DefinicionDeFlujo } from '@gc/pipeline'
import { permanente } from '@gc/shared'
import { and, eq } from 'drizzle-orm'
import { readFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import { Estrategia, type TipoEstrategia } from './esquemas.js'
import { validarPeriodo } from './periodos.js'
import type { Dependencias } from './tipos.js'

export const TAREA_ESTRATEGIA = definirTarea({
  nombre: 'generar_estrategia',
  nivel: 'razonamiento',
  esquema: Estrategia,
  temperatura: 0.6,
  maxTokensSalida: 3000,
})

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

      await exigirPresupuesto(ctx.db, entrada.brandId, new Date(), ctx.brandSlug)

      const { version, perfil } = await cargarPerfilVigente(ctx.db, entrada.brandId, ctx.brandSlug)
      const instrucciones = await readFile(RUTA_PROMPT, 'utf8')

      const mensajes: MensajeLlm[] = [
        { rol: 'sistema', texto: instrucciones },
        {
          rol: 'usuario',
          texto: [
            contextoDeMarca(perfil),
            '',
            `## Encargo`,
            `Genera la estrategia de contenido para el periodo ${entrada.period}.`,
          ].join('\n'),
        },
      ]

      const { datos } = await ejecutarTarea(TAREA_ESTRATEGIA, mensajes, {
        cliente: deps.cliente,
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
