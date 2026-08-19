import {
  crearRegistrador, definirTarea, ejecutarTarea, exigirPresupuesto,
  type MensajeLlm,
} from '@gc/ai'
import { cargarPerfilVigente, contextoDeMarca } from '@gc/brand'
import { esquema, type BaseDeDatos, type Canal } from '@gc/db'
import { modelosDelNivel } from '@gc/operaciones'
import { definirPaso, type DefinicionDeFlujo } from '@gc/pipeline'
import { permanente } from '@gc/shared'
import {
  esquemaDePieza, leerEstrategiaDelTrimestre, validarMes, type TipoEstrategia, type TipoPieza,
} from '@gc/strategy'
import { and, eq } from 'drizzle-orm'
import { readFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import type { Dependencias } from './tipos.js'

// Aviso para quien despliegue esto: `fileURLToPath` corre en tiempo de
// ejecución con la ruta absoluta de la máquina donde vive este checkout —
// funciona en desarrollo local y en cualquier build hecho y ejecutado en la
// misma máquina/imagen, pero si el CLI (o el worker que lo reemplace) corre
// en una máquina distinta a la que generó el build, con una ruta de proyecto
// distinta, la ruta absoluta ya no existe y `readFile(rutaPrompt(canal))`
// falla con ENOENT. Igual que en p1.ts y p2.ts.
function rutaPrompt(canal: Canal): string {
  return fileURLToPath(new URL(`./prompts/pieza-${canal}.md`, import.meta.url))
}

export interface EntradaP3 {
  slotId: string
  mes: string
  brandId: string
}

export interface SalidaP3 {
  pieceId: string
  channel: Canal
  pieza: TipoPieza
}

interface FilaDeSlot {
  channel: Canal
  format: string
  pillar: string
  angle: string
  brief: string
  scheduledFor: Date
}

/** Lo que el paso del modelo le entrega al de persistencia. */
interface SalidaDeLaGeneracion {
  slotId: string
  channel: Canal
  pieza: TipoPieza
  version: number
}

export function crearFlujoPieza(deps: Dependencias): DefinicionDeFlujo {
  const pasoGenerar = definirPaso<EntradaP3, SalidaDeLaGeneracion>({
    nombre: 'generar_copy',
    // Explícito aunque coincida con el valor por omisión: quien cambie la forma
    // de `SalidaDeLaGeneracion` tiene que ver el número al lado para acordarse
    // de subirlo.
    versionDeSalida: 1,
    ejecutar: async (entrada, ctx) => {
      validarMes(entrada.mes)

      // Se consulta el slot antes del presupuesto y de cualquier llamada al
      // modelo: sin él no hay ni canal para elegir el instructivo ni ángulo ni
      // brief que escribir, así que fallar antes evita pagar por nada.
      const slot = await cargarSlot(ctx.db, ctx.organizationId, entrada)

      await exigirPresupuesto(ctx.db, entrada.brandId, new Date(), ctx.brandSlug)

      const { version, perfil } = await cargarPerfilVigente(ctx.db, entrada.brandId, ctx.brandSlug)
      const estrategia = await cargarEstrategiaVigente(
        ctx.db, entrada.brandId, entrada.mes, ctx.brandSlug,
      )
      const instrucciones = await readFile(rutaPrompt(slot.channel), 'utf8')

      // Un nombre por canal, no uno solo compartido: `nombreEsquema` sale de
      // este nombre (`ejecutar.ts`) y `ClienteDeMuestra` lee
      // `<carpeta>/<nombreEsquema>.json`, así que un nombre único para los
      // cinco canales exigiría que una sola muestra satisficiera cinco
      // esquemas `.strict()` incompatibles. De paso desagrega el costo por
      // canal en `ai_calls.task`.
      const tarea = definirTarea({
        nombre: `generar_pieza_${slot.channel}`,
        nivel: 'redaccion',
        esquema: esquemaDePieza(slot.channel),
        temperatura: 0.7,
        maxTokensSalida: 2000,
      })

      const mensajes: MensajeLlm[] = [
        { rol: 'sistema', texto: instrucciones },
        {
          rol: 'usuario',
          texto: [
            contextoDeMarca(perfil),
            '',
            '## Estrategia vigente',
            JSON.stringify(estrategia, null, 2),
            '',
            textoDelSlot(slot),
            '',
            '## Lo que tienes que producir',
            `Escribe el copy final de esta pieza de ${slot.channel}, listo para publicar.`,
          ].join('\n'),
        },
      ]

      // Se resuelve antes de la llamada, no después: si la organización no
      // eligió modelo para este nivel, el `permanente` de `modelosDelNivel`
      // tiene que cortar antes de gastar. Lee `tarea.nivel` y no un literal,
      // así que agregar un nivel nuevo no exige tocar este flujo.
      const modelos = await modelosDelNivel(ctx.db, ctx.organizationId, tarea.nivel)

      const { datos } = await ejecutarTarea(tarea, mensajes, {
        cliente: deps.cliente,
        modelos,
        registrarUso: crearRegistrador(ctx.db, {
          organizationId: ctx.organizationId,
          brandId: entrada.brandId,
          runId: ctx.runId,
          brandProfileVersion: version,
        }),
      })

      // `esquemaDePieza` valida la forma del canal sin el discriminante: se
      // agrega acá para que lo que viaje al paso de persistencia ya sea una
      // `TipoPieza` completa, discriminable por su propio `canal`.
      const pieza = { canal: slot.channel, ...datos } as TipoPieza

      return { slotId: entrada.slotId, channel: slot.channel, pieza, version }
    },
  })

  const pasoPersistir = definirPaso<SalidaDeLaGeneracion, SalidaP3>({
    nombre: 'persistir_pieza',
    // Explícito aunque coincida con el valor por omisión: quien cambie la forma
    // de `SalidaP3` tiene que ver el número al lado para acordarse de subirlo.
    versionDeSalida: 1,
    ejecutar: async (entrada, ctx) => {
      const { slotId, channel, pieza, version } = entrada

      const [fila] = await ctx.db
        .insert(esquema.contentPieces)
        .values({
          organizationId: ctx.organizationId,
          planSlotId: slotId,
          channel,
          data: pieza,
          brandProfileVersion: version,
        })
        .onConflictDoUpdate({
          target: esquema.contentPieces.planSlotId,
          set: { channel, data: pieza, brandProfileVersion: version },
        })
        .returning()

      return { pieceId: fila!.id, channel, pieza }
    },
  })

  return { nombre: 'p3_pieza', pasos: [pasoGenerar, pasoPersistir] }
}

/**
 * Carga el slot y revalida, dentro de la misma consulta, todo lo que
 * `slotsVigentesDelMes` (`@gc/operaciones`, de donde salen los candidatos que
 * encola `encolarPiezas`) ya filtró al armar la lista de candidatos: que el
 * slot no esté descartado, que pertenezca a la marca de la entrada y que su
 * plan sea el del mes de la entrada.
 *
 * Entre encolar y ejecutar pasan minutos —en producción despierta Cloud
 * Tasks, y Cloud Scheduler pasa cada cinco minutos como red de seguridad—, y
 * `id` + `organization_id` no alcanzan para saber que esas tres condiciones
 * siguen valiendo: alguien pudo descartar el slot desde la web con la corrida
 * ya `pendiente`, y sin esta revalidación P3 pagaría el modelo y escribiría
 * una `content_pieces` para un slot descartado. `brandId` y `mes` no filtran
 * la fila —eso ocultaría cuál de las tres condiciones falló bajo un genérico
 * "no se encontró"— sino que se comprueban después, para poder decir cuál se
 * incumplió: sin eso, un `input` con la marca o el mes equivocado manda a
 * buscar el error en el lugar equivocado.
 */
async function cargarSlot(
  db: BaseDeDatos,
  organizationId: string,
  entrada: EntradaP3,
): Promise<FilaDeSlot> {
  const [fila] = await db
    .select({
      channel: esquema.planSlots.channel,
      format: esquema.planSlots.format,
      pillar: esquema.planSlots.pillar,
      angle: esquema.planSlots.angle,
      brief: esquema.planSlots.brief,
      scheduledFor: esquema.planSlots.scheduledFor,
      status: esquema.planSlots.status,
      brandId: esquema.contentPlans.brandId,
      month: esquema.contentPlans.month,
    })
    .from(esquema.planSlots)
    .innerJoin(esquema.contentPlans, eq(esquema.planSlots.contentPlanId, esquema.contentPlans.id))
    .where(
      and(
        eq(esquema.planSlots.id, entrada.slotId),
        eq(esquema.planSlots.organizationId, organizationId),
      ),
    )

  if (!fila) {
    throw permanente(
      `El slot ${entrada.slotId} no existe o no pertenece a esta organización. La pieza se genera ` +
        'a partir de lo que la grilla planificó para ese slot, así que sin él no hay de dónde partir.',
    )
  }

  if (fila.status === 'descartado') {
    throw permanente(
      `El slot ${entrada.slotId} está descartado: alguien lo sacó de la grilla después de que esta ` +
        'corrida quedó encolada. No se genera una pieza para un slot que ya no forma parte del plan.',
    )
  }

  if (fila.brandId !== entrada.brandId) {
    throw permanente(
      `El slot ${entrada.slotId} pertenece a la marca ${fila.brandId}, no a ${entrada.brandId} ` +
        'como dice la entrada de esta corrida. Generar con la marca equivocada usaría su perfil y ' +
        'su léxico prohibido para el texto de otra marca.',
    )
  }

  if (fila.month !== `${entrada.mes}-01`) {
    throw permanente(
      `El slot ${entrada.slotId} pertenece al plan de ${fila.month.slice(0, 7)}, no al de ` +
        `${entrada.mes} como dice la entrada de esta corrida. Un mes desalineado elegiría el ` +
        'trimestre de estrategia equivocado sin avisar.',
    )
  }

  const { channel, format, pillar, angle, brief, scheduledFor } = fila
  return { channel, format, pillar, angle, brief, scheduledFor }
}

/**
 * Envoltorio sobre `leerEstrategiaDelTrimestre` que traduce sus dos casos de
 * fallo a un `permanente`: sin estrategia vigente no hay contexto de marca
 * completo para escribir la pieza, y `leerEstrategiaDelTrimestre` ya sabe
 * distinguir "no hay" de "hay pero no valida" — lo mismo que hace P2.
 *
 * A diferencia de P2, acá no hace falta devolver el `id` de la estrategia:
 * P3 no guarda ningún vínculo hacia ella, solo lee su contenido para armar
 * el mensaje.
 */
async function cargarEstrategiaVigente(
  db: BaseDeDatos,
  brandId: string,
  mes: string,
  nombreVisible?: string,
): Promise<TipoEstrategia> {
  const lectura = await leerEstrategiaDelTrimestre(db, brandId, mes, { archivadas: 'excluir' })

  if (lectura.tipo === 'ausente') {
    throw permanente(
      `La marca ${nombreVisible ?? brandId} no tiene estrategia vigente para ${lectura.periodo}. ` +
        `Genérala antes de escribir piezas de ${mes}.`,
    )
  }

  if (lectura.tipo === 'invalida') {
    throw permanente(`La estrategia guardada de ${nombreVisible ?? brandId} no valida`)
  }

  return lectura.estrategia
}

/**
 * El slot, como sección propia del mensaje. El título coincide con el que
 * nombran los cinco instructivos de canal al referirse al ángulo, al brief y
 * al formato: si el nombre de la sección cambia acá, hay que cambiarlo
 * también ahí.
 */
function textoDelSlot(slot: FilaDeSlot): string {
  return [
    '## El slot a escribir',
    `- Canal: ${slot.channel}`,
    `- Formato: ${slot.format}`,
    `- Pilar: ${slot.pillar}`,
    `- Fecha: ${slot.scheduledFor.toISOString().slice(0, 10)}`,
    `- Ángulo: ${slot.angle}`,
    `- Brief: ${slot.brief}`,
  ].join('\n')
}
