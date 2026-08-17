import { esquema, type BaseDeDatos } from '@gc/db'
import { PiezaDeContenido, validarMes, type TipoPieza } from '@gc/strategy'
import { and, eq, inArray, ne, sql } from 'drizzle-orm'
import { resolverMarca } from './marcas.js'
import { ESTADOS_VIVOS } from './senales.js'

/**
 * Los cuatro números existen para distinguir tres casos que se parecen y que
 * la pantalla necesita separar: ninguna pieza encolada todavía (`total` sin
 * `listas` ni `enVuelo`), todas listas (`listas === total`), y algunas
 * fallidas. Confundirlos —por ejemplo sumando `fallidas` y `enVuelo` en un
 * solo número— sería peor que no tener el resumen.
 */
export interface ResumenDePiezas {
  /** Slots no descartados del mes. */
  total: number
  /** Cuántos ya tienen pieza. */
  listas: number
  /** Corridas de `p3_pieza` del mes que terminaron fallidas. */
  fallidas: number
  /** Corridas de `p3_pieza` del mes todavía vivas. */
  enVuelo: number
}

/**
 * Tres consultas, en el mismo espíritu que `grillaDelMes`: los slots no
 * descartados del plan del mes (un solo `SELECT` con el `JOIN` a
 * `content_plans`, para no traer primero el plan y después sus slots), las
 * piezas que cuelgan de esos slots, y las corridas de `p3_pieza` de ese mes
 * agrupadas por estado. Las tres filtran por `organizationId` además de por
 * la marca resuelta, siguiendo el patrón de `encargos.ts`.
 */
export async function resumenDePiezas(
  db: BaseDeDatos,
  organizationId: string,
  args: { slug: string; mes: string },
): Promise<ResumenDePiezas> {
  validarMes(args.mes)
  const ref = await resolverMarca(db, organizationId, args.slug)

  const slotsVigentes = await db
    .select({ id: esquema.planSlots.id })
    .from(esquema.planSlots)
    .innerJoin(esquema.contentPlans, eq(esquema.planSlots.contentPlanId, esquema.contentPlans.id))
    .where(
      and(
        eq(esquema.contentPlans.brandId, ref.brandId),
        eq(esquema.contentPlans.organizationId, organizationId),
        eq(esquema.contentPlans.month, `${args.mes}-01`),
        eq(esquema.planSlots.organizationId, organizationId),
        ne(esquema.planSlots.status, 'descartado'),
      ),
    )

  const idsDeSlots = slotsVigentes.map((s) => s.id)

  const piezas = idsDeSlots.length === 0
    ? []
    : await db
        .select({ id: esquema.contentPieces.id })
        .from(esquema.contentPieces)
        .where(
          and(
            eq(esquema.contentPieces.organizationId, organizationId),
            inArray(esquema.contentPieces.planSlotId, idsDeSlots),
          ),
        )

  const corridasPorEstado = await db
    .select({
      status: esquema.pipelineRuns.status,
      cantidad: sql<number>`count(*)`.mapWith(Number),
    })
    .from(esquema.pipelineRuns)
    .where(
      and(
        eq(esquema.pipelineRuns.organizationId, organizationId),
        eq(esquema.pipelineRuns.brandId, ref.brandId),
        eq(esquema.pipelineRuns.flow, 'p3_pieza'),
        sql`${esquema.pipelineRuns.input}->>'mes' = ${args.mes}`,
      ),
    )
    .groupBy(esquema.pipelineRuns.status)

  const vivos = new Set<string>(ESTADOS_VIVOS)
  let fallidas = 0
  let enVuelo = 0
  for (const fila of corridasPorEstado) {
    if (fila.status === 'fallido') fallidas += fila.cantidad
    else if (vivos.has(fila.status)) enVuelo += fila.cantidad
  }

  return { total: slotsVigentes.length, listas: piezas.length, fallidas, enVuelo }
}

/**
 * Mapa de `planSlotId` a pieza, en una sola consulta, para que la pantalla
 * pinte cada slot del mes sin una consulta por slot.
 *
 * Una fila cuyo `data` no valida contra `PiezaDeContenido` se omite del mapa
 * en vez de lanzar: es el mismo criterio con el que `leerEncargo` distingue
 * una fila inválida de una ausente, pero acá no hay una pantalla que explique
 * la diferencia todavía, así que omitir es lo honesto.
 */
export async function piezasDelMes(
  db: BaseDeDatos,
  organizationId: string,
  args: { slug: string; mes: string },
): Promise<Map<string, TipoPieza>> {
  validarMes(args.mes)
  const ref = await resolverMarca(db, organizationId, args.slug)

  const filas = await db
    .select({ planSlotId: esquema.contentPieces.planSlotId, data: esquema.contentPieces.data })
    .from(esquema.contentPieces)
    .innerJoin(esquema.planSlots, eq(esquema.contentPieces.planSlotId, esquema.planSlots.id))
    .innerJoin(esquema.contentPlans, eq(esquema.planSlots.contentPlanId, esquema.contentPlans.id))
    .where(
      and(
        eq(esquema.contentPieces.organizationId, organizationId),
        eq(esquema.planSlots.organizationId, organizationId),
        eq(esquema.contentPlans.organizationId, organizationId),
        eq(esquema.contentPlans.brandId, ref.brandId),
        eq(esquema.contentPlans.month, `${args.mes}-01`),
      ),
    )

  const mapa = new Map<string, TipoPieza>()
  for (const fila of filas) {
    const leido = PiezaDeContenido.safeParse(fila.data)
    if (leido.success) mapa.set(fila.planSlotId, leido.data)
  }
  return mapa
}
