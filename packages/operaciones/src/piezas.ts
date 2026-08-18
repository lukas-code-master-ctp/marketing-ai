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
  /**
   * Corridas de `p3_pieza` del mes que terminaron fallidas — cuenta
   * **corridas**, no slots, y ninguna corrida fallida se limpia nunca.
   * `mostrarBotonPiezas` (`page.tsx`) reencola solo los slots sin pieza ni
   * corrida viva, así que reintentar una pieza que falló dos veces antes de
   * salir bien deja `fallidas` en 2 para siempre, y con varias tandas se
   * acumula sin techo — un número que crece con el tiempo aunque el mes
   * termine con sus veinte piezas escritas. Documentado a propósito y sin
   * arreglar (Menor 9 de la revisión de `feat/piezas-y-su-texto`; el
   * arreglo real —descontar los fallidos ya reemplazados por una corrida
   * posterior que sí completó ese slot, o no contar corridas cuyo slot ya
   * tiene pieza— queda en `pendientes.md`).
   */
  fallidas: number
  /** Corridas de `p3_pieza` del mes todavía vivas. */
  enVuelo: number
}

/**
 * Los slots no descartados del plan del mes, y cuáles de esos ya tienen
 * pieza — el criterio que `resumenDePiezas` y `encolarPiezas` necesitan por
 * igual, escrito una sola vez para que no queden dos definiciones del mismo
 * filtro sincronizadas a mano. `resumenDePiezas` lo usa para contar;
 * `encolarPiezas`, para decidir a quién encolar.
 *
 * Dos consultas, en el mismo espíritu que `grillaDelMes`: los slots no
 * descartados (un solo `SELECT` con el `JOIN` a `content_plans`, para no
 * traer primero el plan y después sus slots) y las piezas que cuelgan de
 * esos slots. Las dos filtran por `organizationId` además de por la marca
 * resuelta, siguiendo el patrón de `encargos.ts`.
 *
 * `conPieza` es un `Set`, no un conteo: `content_pieces.plan_slot_id` es
 * `unique`, así que su tamaño ya es el número de slots con pieza, y a
 * `encolarPiezas` le hace falta el conjunto en sí para filtrar candidatos.
 */
export async function slotsVigentesDelMes(
  db: BaseDeDatos,
  organizationId: string,
  args: { brandId: string; mes: string },
): Promise<{ ids: string[]; conPieza: Set<string> }> {
  const slotsVigentes = await db
    .select({ id: esquema.planSlots.id })
    .from(esquema.planSlots)
    .innerJoin(esquema.contentPlans, eq(esquema.planSlots.contentPlanId, esquema.contentPlans.id))
    .where(
      and(
        eq(esquema.contentPlans.brandId, args.brandId),
        eq(esquema.contentPlans.organizationId, organizationId),
        eq(esquema.contentPlans.month, `${args.mes}-01`),
        eq(esquema.planSlots.organizationId, organizationId),
        ne(esquema.planSlots.status, 'descartado'),
      ),
    )

  const ids = slotsVigentes.map((s) => s.id)

  const piezas = ids.length === 0
    ? []
    : await db
        .select({ planSlotId: esquema.contentPieces.planSlotId })
        .from(esquema.contentPieces)
        .where(
          and(
            eq(esquema.contentPieces.organizationId, organizationId),
            inArray(esquema.contentPieces.planSlotId, ids),
          ),
        )

  return { ids, conPieza: new Set(piezas.map((p) => p.planSlotId)) }
}

/**
 * Tres consultas, en el mismo espíritu que `grillaDelMes`: los slots no
 * descartados del plan del mes y las piezas que cuelgan de ellos —las dos
 * de `slotsVigentesDelMes`—, y las corridas de `p3_pieza` de ese mes
 * agrupadas por estado.
 */
export async function resumenDePiezas(
  db: BaseDeDatos,
  organizationId: string,
  args: { slug: string; mes: string },
): Promise<ResumenDePiezas> {
  validarMes(args.mes)
  const ref = await resolverMarca(db, organizationId, args.slug)

  const { ids: idsDeSlots, conPieza } = await slotsVigentesDelMes(
    db, organizationId, { brandId: ref.brandId, mes: args.mes },
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

  return { total: idsDeSlots.length, listas: conPieza.size, fallidas, enVuelo }
}

/**
 * Mapa de `planSlotId` a pieza, en una sola consulta, para que la pantalla
 * pinte cada slot del mes sin una consulta por slot.
 *
 * Una fila cuyo `data` no valida contra `PiezaDeContenido` se omite del mapa
 * en vez de lanzar: es el mismo criterio con el que `leerEncargo` distingue
 * una fila inválida de una ausente, pero acá no hay una pantalla que explique
 * la diferencia todavía, así que omitir es lo honesto.
 *
 * **No excluye los slots descartados** — a diferencia de `slotsVigentesDelMes`,
 * que sí filtra `ne(status, 'descartado')` y es lo que alimenta `total` y
 * `listas` en `resumenDePiezas`. Un slot que tenía pieza y se descartó
 * después sigue devolviendo su pieza acá, así que `PanelDeDetalle` la
 * muestra igual (`RejillaDelMes` no la esconde por estar descartado el
 * slot). Consecuencia benigna —una pieza vieja de un slot que ya no cuenta,
 * no una pieza equivocada— pero asimétrica con el resumen: la pantalla
 * puede mostrar más piezas de las que el resumen cuenta (Menor 12 de la
 * revisión de la rama). No se igualó a propósito: unificar el criterio con
 * `slotsVigentesDelMes` exigiría el mismo `JOIN` a `content_plans` que esa
 * función ya hace por separado, y esta consulta no lo necesitaba hasta hoy
 * — queda para cuando alguien note la asimetría desde la pantalla, no desde
 * el código.
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
