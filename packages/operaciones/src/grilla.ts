import { cargarPerfilVigente } from '@gc/brand'
import { esquema, type BaseDeDatos, type Canal } from '@gc/db'
import { ErrorDeDominio, permanente } from '@gc/shared'
import {
  Estrategia, SlotPropuesto, trimestreDe, validarGrilla, type Problema, type TipoEstrategia,
} from '@gc/strategy'
import { and, asc, eq, ne } from 'drizzle-orm'
import { resolverMarca } from './marcas.js'

export interface SlotDeLaGrilla {
  id: string
  fecha: string
  hora: string
  canal: string
  formato: string
  pilar: string
  angulo: string
  brief: string
  descartado: boolean
  esDerivado: boolean
  idDelPadre: string | null
}

export interface GrillaDelMes {
  contentPlanId: string | null
  estado: 'borrador' | 'aprobada' | 'en_ejecucion' | 'cerrada' | null
  slots: SlotDeLaGrilla[]
  porCanal: Record<string, number>
  avisos: Problema[]
}

/**
 * Lee la grilla del mes tal como quedó persistida y recalcula sus avisos
 * (cadencia, distribución de pilares) sobre los slots que siguen vigentes.
 *
 * Los avisos de `SalidaP2` no se guardan en ninguna tabla: son el resultado
 * de `validarGrilla` en el momento de generar. Un valor persistido quedaría
 * obsoleto en cuanto se descarta un slot, porque eso cambia tanto la cadencia
 * por canal como la distribución entre pilares. Recalcular al leer garantiza
 * que los avisos siempre describan la grilla como está hoy, no como quedó al
 * generarla.
 */
export async function grillaDelMes(
  db: BaseDeDatos,
  organizationId: string,
  slugDeMarca: string,
  mes: string,
): Promise<GrillaDelMes> {
  const ref = await resolverMarca(db, organizationId, slugDeMarca)

  const [plan] = await db
    .select()
    .from(esquema.contentPlans)
    .where(
      and(
        eq(esquema.contentPlans.brandId, ref.brandId),
        eq(esquema.contentPlans.month, `${mes}-01`),
      ),
    )

  // Sin plan no hay grilla ni avisos que calcular: nada que leer.
  if (!plan) {
    return { contentPlanId: null, estado: null, slots: [], porCanal: {}, avisos: [] }
  }

  // `ORDER BY` explícito: el calendario muestra los slots en este orden y
  // Postgres no garantiza ninguno sin pedirlo.
  const filas = await db
    .select()
    .from(esquema.planSlots)
    .where(eq(esquema.planSlots.contentPlanId, plan.id))
    .orderBy(asc(esquema.planSlots.scheduledFor))

  const slots: SlotDeLaGrilla[] = filas.map((f) => {
    const [fecha, resto] = f.scheduledFor.toISOString().split('T')
    return {
      id: f.id,
      fecha: fecha!,
      hora: resto!.slice(0, 5),
      canal: f.channel,
      formato: f.format,
      pilar: f.pillar,
      angulo: f.angle,
      brief: f.brief,
      descartado: f.status === 'descartado',
      esDerivado: f.sourceSlotId !== null,
      idDelPadre: f.sourceSlotId,
    }
  })

  const porCanal: Record<string, number> = {}
  for (const s of slots) {
    if (s.descartado) continue
    porCanal[s.canal] = (porCanal[s.canal] ?? 0) + 1
  }

  const avisos = await recalcularAvisos(db, ref.brandId, ref.brandSlug, mes, slots)

  return { contentPlanId: plan.id, estado: plan.status, slots, porCanal, avisos }
}

/**
 * Si la marca no tiene perfil, o no tiene estrategia vigente para el
 * trimestre del mes pedido, esas cargas lanzan `permanente`. Se captura
 * porque una grilla ya generada debe seguir siendo visible aunque la
 * estrategia que la originó haya sido archivada o borrada después: que
 * falte con qué recalcular los avisos no es motivo para esconder la grilla.
 */
async function recalcularAvisos(
  db: BaseDeDatos,
  brandId: string,
  brandSlug: string | undefined,
  mes: string,
  slots: SlotDeLaGrilla[],
): Promise<Problema[]> {
  try {
    const { perfil } = await cargarPerfilVigente(db, brandId, brandSlug)
    const estrategia = await cargarEstrategiaDelTrimestre(db, brandId, brandSlug, mes)

    const vigentes = slots.filter((s) => !s.descartado)
    const problemas = validarGrilla(
      // `canal` sale de la columna `channel` de `plan_slots`, restringida por
      // CHECK a `Canal`: el cast solo repone en TypeScript lo que Postgres ya
      // garantiza, porque `SlotDeLaGrilla.canal` se tipa `string` en la interfaz.
      vigentes.map((s) => ({
        fecha: s.fecha, hora: s.hora, canal: s.canal as Canal, formato: s.formato,
        pilar: s.pilar, angulo: s.angulo, brief: s.brief,
      })),
      { mes, perfil, estrategia },
    )
    return problemas.filter((p) => p.severidad === 'aviso')
  } catch (error) {
    if (error instanceof ErrorDeDominio && error.clase === 'permanente') return []
    throw error
  }
}

/**
 * Cambia el estado del slot a `descartado`. No toca a sus derivados: la
 * cascada de la base gobierna el borrado, no el cambio de estado, y eso es
 * deliberado — la interfaz lo advierte y ofrece descartarlos aparte, nunca
 * como una cascada implícita.
 */
export async function descartarSlot(
  db: BaseDeDatos,
  organizationId: string,
  slotId: string,
): Promise<void> {
  const [fila] = await db
    .update(esquema.planSlots)
    .set({ status: 'descartado' })
    .where(
      and(
        eq(esquema.planSlots.id, slotId),
        eq(esquema.planSlots.organizationId, organizationId),
      ),
    )
    .returning({ id: esquema.planSlots.id })

  if (!fila) throw permanente(`No existe el slot ${slotId} en esta organización`)
}

/**
 * Las mismas reglas que `SlotPropuesto` le impone a la grilla que genera el
 * modelo. `angle` y `brief` son NOT NULL sin CHECK, así que sin esto la
 * cadena vacía persiste y queda un slot que la generación jamás habría
 * podido producir — y que la Fase 2 leería para escribir la pieza. Se valida
 * contra el esquema, no contra una copia de sus números: si el mínimo cambia
 * ahí, cambia aquí.
 *
 * Vive en la operación y no en la Server Action para que el CLI lo herede,
 * igual que `validarPerfil` cubre a los dos caminos de carga de perfil.
 */
function exigirCamposEditables(campos: { angulo: string; brief: string }): void {
  const detalles = (['angulo', 'brief'] as const).flatMap((campo) => {
    const r = SlotPropuesto.shape[campo].safeParse(campos[campo])
    return r.success ? [] : r.error.issues.map((i) => `- ${campo}: ${i.message}`)
  })

  if (detalles.length > 0) {
    throw permanente(`Edición de slot inválida:\n${detalles.join('\n')}`)
  }
}

/** Cambia ángulo y brief de un slot. El resto de sus campos queda intacto. */
export async function editarSlot(
  db: BaseDeDatos,
  organizationId: string,
  slotId: string,
  campos: { angulo: string; brief: string },
): Promise<void> {
  exigirCamposEditables(campos)

  const [fila] = await db
    .update(esquema.planSlots)
    .set({ angle: campos.angulo, brief: campos.brief })
    .where(
      and(
        eq(esquema.planSlots.id, slotId),
        eq(esquema.planSlots.organizationId, organizationId),
      ),
    )
    .returning({ id: esquema.planSlots.id })

  if (!fila) throw permanente(`No existe el slot ${slotId} en esta organización`)
}

/**
 * Solo es válido aprobar una grilla que está en `borrador`. Si no vuelve
 * fila, se relee el estado actual para que el mensaje diga en cuál está de
 * verdad, en vez de repetir siempre el mismo genérico.
 */
export async function aprobarGrilla(
  db: BaseDeDatos,
  organizationId: string,
  contentPlanId: string,
): Promise<void> {
  const [fila] = await db
    .update(esquema.contentPlans)
    .set({ status: 'aprobada' })
    .where(
      and(
        eq(esquema.contentPlans.id, contentPlanId),
        eq(esquema.contentPlans.organizationId, organizationId),
        eq(esquema.contentPlans.status, 'borrador'),
      ),
    )
    .returning({ id: esquema.contentPlans.id })

  if (!fila) {
    const [actual] = await db
      .select({ status: esquema.contentPlans.status })
      .from(esquema.contentPlans)
      .where(
        and(
          eq(esquema.contentPlans.id, contentPlanId),
          eq(esquema.contentPlans.organizationId, organizationId),
        ),
      )

    if (!actual) {
      throw permanente(`No existe el plan ${contentPlanId} en esta organización`)
    }
    throw permanente(
      `El plan ${contentPlanId} está en estado "${actual.status}" y solo se aprueba uno en borrador`,
    )
  }
}

async function cargarEstrategiaDelTrimestre(
  db: BaseDeDatos,
  brandId: string,
  brandSlug: string | undefined,
  mes: string,
): Promise<TipoEstrategia> {
  const periodo = trimestreDe(mes)

  const [fila] = await db
    .select()
    .from(esquema.strategies)
    .where(
      and(
        eq(esquema.strategies.brandId, brandId),
        eq(esquema.strategies.period, periodo),
        ne(esquema.strategies.status, 'archivada'),
      ),
    )

  if (!fila) {
    throw permanente(
      `La marca ${brandSlug ?? brandId} no tiene estrategia vigente para ${periodo}`,
    )
  }

  const r = Estrategia.safeParse(fila.data)
  if (!r.success) {
    throw permanente(`La estrategia guardada de ${brandSlug ?? brandId} no valida`)
  }
  return r.data
}
