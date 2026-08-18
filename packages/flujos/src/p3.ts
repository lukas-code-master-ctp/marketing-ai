import {
  crearRegistrador, definirTarea, ejecutarTarea, exigirPresupuesto,
  type MensajeLlm,
} from '@gc/ai'
import { cargarPerfilVigente, contextoDeMarca } from '@gc/brand'
import { esquema, type BaseDeDatos, type Canal } from '@gc/db'
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
      const slot = await cargarSlot(ctx.db, entrada.slotId, ctx.organizationId)

      await exigirPresupuesto(ctx.db, entrada.brandId, new Date(), ctx.brandSlug)

      const { version, perfil } = await cargarPerfilVigente(ctx.db, entrada.brandId, ctx.brandSlug)
      const estrategia = await cargarEstrategiaVigente(
        ctx.db, entrada.brandId, entrada.mes, ctx.brandSlug,
      )
      const instrucciones = await readFile(rutaPrompt(slot.channel), 'utf8')

      const tarea = definirTarea({
        nombre: 'generar_pieza',
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

      const { datos } = await ejecutarTarea(tarea, mensajes, {
        cliente: deps.cliente,
        ...(deps.env !== undefined ? { env: deps.env } : {}),
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

async function cargarSlot(
  db: BaseDeDatos,
  slotId: string,
  organizationId: string,
): Promise<FilaDeSlot> {
  const [fila] = await db
    .select({
      channel: esquema.planSlots.channel,
      format: esquema.planSlots.format,
      pillar: esquema.planSlots.pillar,
      angle: esquema.planSlots.angle,
      brief: esquema.planSlots.brief,
      scheduledFor: esquema.planSlots.scheduledFor,
    })
    .from(esquema.planSlots)
    .where(and(eq(esquema.planSlots.id, slotId), eq(esquema.planSlots.organizationId, organizationId)))

  if (!fila) {
    throw permanente(
      `El slot ${slotId} no existe o no pertenece a esta organización. La pieza se genera a ` +
        'partir de lo que la grilla planificó para ese slot, así que sin él no hay de dónde partir.',
    )
  }

  return fila
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
