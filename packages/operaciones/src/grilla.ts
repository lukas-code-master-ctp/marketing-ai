import { cargarPerfilVigente, type TipoPerfilDeMarca } from '@gc/brand'
import { esquema, type BaseDeDatos, type Canal } from '@gc/db'
import { ErrorDeDominio, permanente } from '@gc/shared'
import {
  SlotPropuesto, leerEstrategiaDelTrimestre, validarGrilla, validarMes,
  type Problema,
} from '@gc/strategy'
import { and, asc, eq, gte, inArray, lt } from 'drizzle-orm'
import { resolverMarca } from './marcas.js'

export type EstadoDeGrilla = 'borrador' | 'aprobada' | 'en_ejecucion' | 'cerrada'

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
  estado: EstadoDeGrilla | null
  slots: SlotDeLaGrilla[]
  porCanal: Record<string, number>
  /**
   * Todos los problemas de `validarGrilla`, bloqueantes incluidos. Se llamaba
   * `avisos` y filtraba `severidad === 'aviso'`: eso calzaba con el
   * especificado original, pero desde que el perfil se edita en la web los
   * bloqueantes son alcanzables —renombrar un pilar deja a sus slots con
   * `pilar_desconocido`— y descartarlos dejaba la pantalla mostrando el
   * síntoma y tirando el diagnóstico.
   */
  problemas: Problema[]
}

/**
 * Lee la grilla del mes tal como quedó persistida y recalcula sus problemas
 * (cadencia, distribución de pilares, pilares desconocidos) sobre los slots
 * que siguen vigentes.
 *
 * Los avisos de `SalidaP2` no se guardan en ninguna tabla: son el resultado
 * de `validarGrilla` en el momento de generar. Un valor persistido quedaría
 * obsoleto en cuanto se descarta un slot, porque eso cambia tanto la cadencia
 * por canal como la distribución entre pilares. Recalcular al leer garantiza
 * que los problemas siempre describan la grilla como está hoy, no como quedó
 * al generarla.
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
    return { contentPlanId: null, estado: null, slots: [], porCanal: {}, problemas: [] }
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

  const problemas = await recalcularProblemas(db, ref.brandId, ref.brandSlug, mes, slots)

  return { contentPlanId: plan.id, estado: plan.status, slots, porCanal, problemas }
}

/**
 * Falta de insumos y corrupción de insumos son cosas distintas y se tratan
 * distinto.
 *
 * Que no haya perfil, o que no haya estrategia para el trimestre del mes
 * pedido, se traga en silencio: una grilla ya generada debe seguir siendo
 * visible aunque la estrategia que la originó se archivara o se borrara
 * después, y no tener con qué recalcular no es motivo para esconderla.
 *
 * Que la estrategia guardada exista pero no valide contra su esquema NO se
 * traga: eso es corrupción de datos y antes se presentaba como "nada que
 * reportar", indistinguible de un mes sano. Ahora sale como un problema
 * bloqueante que dice exactamente eso.
 */
async function recalcularProblemas(
  db: BaseDeDatos,
  brandId: string,
  brandSlug: string | undefined,
  mes: string,
  slots: SlotDeLaGrilla[],
): Promise<Problema[]> {
  let perfil: TipoPerfilDeMarca
  try {
    perfil = (await cargarPerfilVigente(db, brandId, brandSlug)).perfil
  } catch (error) {
    if (error instanceof ErrorDeDominio && error.clase === 'permanente') return []
    throw error
  }

  const lectura = await leerEstrategiaDelTrimestre(db, brandId, mes, { archivadas: 'excluir' })
  if (lectura.tipo === 'ausente') return []
  if (lectura.tipo === 'invalida') {
    return [
      {
        severidad: 'bloqueante',
        regla: 'estrategia_ilegible',
        detalle:
          `La estrategia guardada de ${brandSlug ?? brandId} para ${lectura.periodo} no valida ` +
          `contra su esquema, así que los problemas de esta grilla no se pueden calcular. ` +
          `Regenérala con "pnpm cli estrategia:generar --marca ${brandSlug ?? brandId} ` +
          `--periodo ${lectura.periodo}".`,
      },
    ]
  }

  const vigentes = slots.filter((s) => !s.descartado)
  return validarGrilla(
    // `canal` sale de la columna `channel` de `plan_slots`, restringida por
    // CHECK a `Canal`: el cast solo repone en TypeScript lo que Postgres ya
    // garantiza, porque `SlotDeLaGrilla.canal` se tipa `string` en la interfaz.
    vigentes.map((s) => ({
      fecha: s.fecha, hora: s.hora, canal: s.canal as Canal, formato: s.formato,
      pilar: s.pilar, angulo: s.angulo, brief: s.brief,
    })),
    { mes, perfil, estrategia: lectura.estrategia },
  )
}

/**
 * El slot pedido, de esta organización, y solo si su plan sigue en
 * `borrador`. Es la misma regla que `p2.ts` le aplica a la regeneración, y
 * por el mismo motivo: fuera de borrador la planificación ya fue revisada y,
 * desde la Fase 2, tendrá piezas de contenido colgando de esos slots.
 *
 * El predicado va dentro del `UPDATE`, no en un `SELECT` previo, para que no
 * quede una ventana entre comprobar y escribir.
 */
function slotModificable(db: BaseDeDatos, organizationId: string, slotId: string) {
  return and(
    eq(esquema.planSlots.id, slotId),
    eq(esquema.planSlots.organizationId, organizationId),
    inArray(
      esquema.planSlots.contentPlanId,
      db
        .select({ id: esquema.contentPlans.id })
        .from(esquema.contentPlans)
        .where(
          and(
            eq(esquema.contentPlans.organizationId, organizationId),
            eq(esquema.contentPlans.status, 'borrador'),
          ),
        ),
    ),
  )
}

/**
 * Sin fila devuelta hay dos causas posibles y se distinguen releyendo: o el
 * slot no existe en esta organización, o existe y su grilla ya salió de
 * borrador. El mensaje nombra el estado real, no un genérico.
 */
async function explicarSlotNoModificable(
  db: BaseDeDatos,
  organizationId: string,
  slotId: string,
): Promise<never> {
  const [fila] = await db
    .select({ estado: esquema.contentPlans.status, mes: esquema.contentPlans.month })
    .from(esquema.planSlots)
    .innerJoin(esquema.contentPlans, eq(esquema.planSlots.contentPlanId, esquema.contentPlans.id))
    .where(
      and(
        eq(esquema.planSlots.id, slotId),
        eq(esquema.planSlots.organizationId, organizationId),
      ),
    )

  if (!fila) throw permanente(`No existe el slot ${slotId} en esta organización`)

  throw permanente(
    `La grilla de ${fila.mes.slice(0, 7)} está en estado "${fila.estado}" y solo se ` +
      `modifican los slots de una en borrador. Devuélvela a "borrador" para editarla.`,
  )
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
    .where(slotModificable(db, organizationId, slotId))
    .returning({ id: esquema.planSlots.id })

  if (!fila) await explicarSlotNoModificable(db, organizationId, slotId)
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
    .where(slotModificable(db, organizationId, slotId))
    .returning({ id: esquema.planSlots.id })

  if (!fila) await explicarSlotNoModificable(db, organizationId, slotId)
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
  /**
   * Quién aprobó. Opcional y `null` por omisión: el CLI aprueba sin sesión, y
   * ahí `null` significa "lo hizo el sistema". Va como parámetro explícito y
   * no leído de un contexto porque `@gc/operaciones` no sabe que existe una
   * sesión web — el CLI y el worker llaman a esta misma función.
   */
  usuarioId?: string,
): Promise<void> {
  const [fila] = await db
    .update(esquema.contentPlans)
    .set({ status: 'aprobada', approvedBy: usuarioId ?? null })
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

/**
 * Devuelve una grilla aprobada a `borrador`. Es la puerta de vuelta que
 * faltaba: `p2.ts` viene diciendo «Devuélvela a "borrador" para regenerarla»
 * y hasta ahora ningún comando ni pantalla podía hacerlo, así que aprobar era
 * definitivo salvo por SQL a mano.
 *
 * Solo desde `aprobada`. Desde `en_ejecucion` o `cerrada` no, porque ahí ya
 * hay publicaciones en vuelo o cerradas y reabrir no las deshace; y desde
 * `borrador` tampoco, para que el comando nunca dé por hecho un cambio que
 * no ocurrió. Se identifica por marca y mes, no por id, porque es la clave
 * con la que trabaja la línea de comandos.
 *
 * `approved_by` no se toca acá: conserva a quien aprobó por última vez
 * mientras el estado vuelve a `borrador`. Es un registro histórico de la
 * última aprobación, no una marca de "aprobación vigente" — la grilla ya
 * no está aprobada, lo dice `status`, y quien lea la fila no debería
 * confundir una cosa con la otra.
 */
export async function reabrirGrilla(
  db: BaseDeDatos,
  organizationId: string,
  args: { slug: string; mes: string },
  /**
   * Quién reabrió. Opcional y `null` por omisión, por el mismo motivo que
   * `aprobarGrilla`: el CLI reabre sin sesión, y ahí `null` significa "lo
   * hizo el sistema".
   */
  usuarioId?: string,
): Promise<void> {
  const ref = await resolverMarca(db, organizationId, args.slug)
  validarMes(args.mes)

  const delMes = and(
    eq(esquema.contentPlans.organizationId, organizationId),
    eq(esquema.contentPlans.brandId, ref.brandId),
    eq(esquema.contentPlans.month, `${args.mes}-01`),
  )

  const [fila] = await db
    .update(esquema.contentPlans)
    .set({ status: 'borrador', reopenedBy: usuarioId ?? null })
    .where(and(delMes, eq(esquema.contentPlans.status, 'aprobada')))
    .returning({ id: esquema.contentPlans.id })

  if (fila) return

  const [actual] = await db
    .select({ status: esquema.contentPlans.status })
    .from(esquema.contentPlans)
    .where(delMes)

  if (!actual) {
    throw permanente(
      `La marca ${ref.brandSlug ?? args.slug} no tiene grilla para ${args.mes}`,
    )
  }
  throw permanente(
    `La grilla de ${args.mes} está en estado "${actual.status}" y solo se reabre una aprobada`,
  )
}

export interface FilaDeGrilla {
  fecha: string
  canal: string
  formato: string
  pilar: string
  angulo: string
  derivado: boolean
  /**
   * `grilla:ver` listaba los descartados igual que los vigentes porque ni
   * siquiera seleccionaba la columna, mientras la cabecera de la web sí los
   * excluía de sus conteos. Dos lectores de `plan_slots` en el mismo paquete
   * con nociones distintas de lo que hay en la grilla.
   */
  descartado: boolean
}

export async function verGrilla(
  db: BaseDeDatos,
  organizationId: string,
  args: { slug: string; mes: string },
): Promise<FilaDeGrilla[]> {
  const ref = await resolverMarca(db, organizationId, args.slug)

  // La misma validación que usa `trimestreDe` en `grilla:generar`: dos copias
  // del formato eran dos maneras de que un comando aceptara lo que el otro
  // rechaza.
  validarMes(args.mes)

  const [anio, mes] = args.mes.split('-').map(Number)
  const desde = new Date(Date.UTC(anio!, mes! - 1, 1))
  const hasta = new Date(Date.UTC(anio!, mes!, 1))

  const filas = await db
    .select({
      scheduledFor: esquema.planSlots.scheduledFor,
      channel: esquema.planSlots.channel,
      format: esquema.planSlots.format,
      pillar: esquema.planSlots.pillar,
      angle: esquema.planSlots.angle,
      sourceSlotId: esquema.planSlots.sourceSlotId,
      status: esquema.planSlots.status,
    })
    .from(esquema.planSlots)
    .innerJoin(esquema.contentPlans, eq(esquema.planSlots.contentPlanId, esquema.contentPlans.id))
    .where(
      and(
        eq(esquema.contentPlans.brandId, ref.brandId),
        gte(esquema.planSlots.scheduledFor, desde),
        lt(esquema.planSlots.scheduledFor, hasta),
      ),
    )
    .orderBy(asc(esquema.planSlots.scheduledFor))

  return filas.map((f) => ({
    fecha: f.scheduledFor.toISOString().slice(0, 16).replace('T', ' '),
    canal: f.channel,
    formato: f.format,
    pilar: f.pillar,
    angulo: f.angle,
    derivado: f.sourceSlotId !== null,
    descartado: f.status === 'descartado',
  }))
}
