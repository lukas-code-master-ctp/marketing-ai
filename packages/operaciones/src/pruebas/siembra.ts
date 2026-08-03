import { PERFIL_VALIDO, guardarPerfil } from '@gc/brand'
import { esquema, type BaseDeDatos } from '@gc/db'

/** Organización, marca `parcelas`, perfil y estrategia de 2026-Q3. */
export async function sembrarConEstrategia(db: BaseDeDatos) {
  const { ref } = await sembrarBase(db)
  return ref
}

async function sembrarBase(db: BaseDeDatos) {
  const [org] = await db
    .insert(esquema.organizations)
    .values({ name: 'Principal', slug: 'principal' })
    .returning()
  const [marca] = await db
    .insert(esquema.brands)
    .values({ organizationId: org!.id, slug: 'parcelas', name: 'CTP' })
    .returning()
  const ref = { organizationId: org!.id, brandId: marca!.id }
  await guardarPerfil(db, ref, PERFIL_VALIDO)

  const [estrategia] = await db
    .insert(esquema.strategies)
    .values({
      organizationId: ref.organizationId,
      brandId: ref.brandId,
      period: '2026-Q3',
      brandProfileVersion: 1,
      data: {
        objetivos: [{ nombre: 'Alcance', metrica: 'alcance', meta: '+10%' }],
        mensajesClave: ['mensaje uno largo', 'mensaje dos largo'],
        mixDeCanales: [
          { canal: 'blog', publicacionesPorSemana: 1 },
          { canal: 'linkedin', publicacionesPorSemana: 1 },
          { canal: 'instagram', publicacionesPorSemana: 1 },
        ],
        reciclaje: [{ desde: 'blog', hacia: ['linkedin', 'instagram'], diasDespues: 2 }],
        temasPrioritarios: ['factibilidad de agua'],
      },
    })
    .returning({ id: esquema.strategies.id })

  return { ref, strategyId: estrategia!.id }
}

const HORA = '13:00'
const ANGULO = 'guía práctica'
const BRIEF = 'Explicar paso a paso cómo verificar la factibilidad antes de comprar.'

/** Los cuatro artículos de blog, uno por semana, con los pilares del perfil. */
const ARTICULOS = [
  { fecha: '2026-09-02', pilar: 'educacion' },
  { fecha: '2026-09-09', pilar: 'educacion' },
  { fecha: '2026-09-16', pilar: 'confianza' },
  { fecha: '2026-09-23', pilar: 'producto' },
] as const

/** Los canales destino y el desfase de la regla de reciclaje de la estrategia
 *  sembrada arriba, en el mismo orden en que la expansión los recorre. */
const CANALES_DERIVADOS = ['linkedin', 'instagram'] as const
const DIAS_DESPUES = 2

function sumarDias(fecha: string, dias: number): string {
  const d = new Date(`${fecha}T00:00:00Z`)
  d.setUTCDate(d.getUTCDate() + dias)
  return d.toISOString().slice(0, 10)
}

/**
 * Lo anterior más la grilla de 2026-09 ya generada: 4 artículos y 8 derivados.
 *
 * Las filas se insertan directamente, sin arrancar el flujo P2. Antes este
 * fixture sembraba ejecutando P2 de verdad con un `ClienteFalso`, y eso
 * obligaba a `@gc/operaciones` a declarar `@gc/ai`, `@gc/pipeline` y
 * `@gc/flujos`. pnpm materializa esas dependencias dentro de
 * `packages/operaciones/node_modules`, así que el modelo volvía a ser
 * resoluble desde cualquier archivo del paquete —incluido `grilla.ts`, que la
 * app web sí carga—, justo la puerta que separar `@gc/flujos` existe para
 * cerrar.
 *
 * Que P2 produzca esta forma —los derivados dos días después de su artículo,
 * con `source_slot_id` apuntando al padre— es lo que verifica `p2.test.ts`,
 * que vive en `@gc/flujos`. Aquí solo se reproduce el resultado: estas pruebas
 * necesitan una grilla realista sobre la que leer, editar y aprobar, no una
 * llamada al modelo.
 *
 * El orden de inserción también se reproduce —primero los cuatro artículos en
 * un insert y después los ocho derivados en otro— porque `grilla.test.ts`
 * comprueba que `grillaDelMes` ordena de forma explícita y no se apoya en el
 * orden en que Postgres devuelve las filas.
 */
export async function sembrarConGrilla(db: BaseDeDatos) {
  const { ref, strategyId } = await sembrarBase(db)

  const [plan] = await db
    .insert(esquema.contentPlans)
    .values({
      organizationId: ref.organizationId,
      brandId: ref.brandId,
      strategyId,
      month: '2026-09-01',
    })
    .returning({ id: esquema.contentPlans.id })

  const padres = await db
    .insert(esquema.planSlots)
    .values(
      ARTICULOS.map((a) => ({
        organizationId: ref.organizationId,
        contentPlanId: plan!.id,
        sourceSlotId: null,
        scheduledFor: new Date(`${a.fecha}T${HORA}:00Z`),
        channel: 'blog' as const,
        format: 'articulo',
        pillar: a.pilar,
        angle: ANGULO,
        brief: BRIEF,
      })),
    )
    .returning({ id: esquema.planSlots.id })

  await db.insert(esquema.planSlots).values(
    ARTICULOS.flatMap((a, i) =>
      CANALES_DERIVADOS.map((canal) => ({
        organizationId: ref.organizationId,
        contentPlanId: plan!.id,
        sourceSlotId: padres[i]!.id,
        scheduledFor: new Date(`${sumarDias(a.fecha, DIAS_DESPUES)}T${HORA}:00Z`),
        channel: canal,
        format: 'derivado',
        pillar: a.pilar,
        angle: `Adaptación para ${canal}: ${ANGULO}`,
        brief: `Adaptar al formato de ${canal} la pieza original.\n\n${BRIEF}`,
      })),
    ),
  )

  return ref
}
