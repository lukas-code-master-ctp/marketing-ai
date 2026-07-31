import {
  crearRegistrador, definirTarea, ejecutarTarea, exigirPresupuesto,
  type MensajeLlm,
} from '@gc/ai'
import { cargarPerfilVigente, contextoDeMarca } from '@gc/brand'
import { esquema, type BaseDeDatos } from '@gc/db'
import { definirPaso, type ContextoDePaso, type DefinicionDeFlujo } from '@gc/pipeline'
import { permanente } from '@gc/shared'
import { and, desc, eq } from 'drizzle-orm'
import { readFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import { expandirDerivados } from './derivados.js'
import { Estrategia, GrillaPropuesta, type TipoEstrategia, type TipoSlotPropuesto } from './esquemas.js'
import type { Dependencias } from './tipos.js'
import { hayBloqueantes, validarGrilla, type Problema } from './validacion.js'

export const TAREA_GRILLA = definirTarea({
  nombre: 'proponer_grilla',
  nivel: 'razonamiento',
  esquema: GrillaPropuesta,
  temperatura: 0.7,
  maxTokensSalida: 8000,
})

const RUTA_PROMPT = fileURLToPath(new URL('./prompts/proponer-grilla.md', import.meta.url))

export interface EntradaP2 {
  brandId: string
  mes: string
}

export interface SalidaP2 {
  contentPlanId: string
  totalSlots: number
  avisos: Problema[]
}

export function crearFlujoGrilla(deps: Dependencias): DefinicionDeFlujo {
  const paso = definirPaso<EntradaP2, SalidaP2>({
    nombre: 'proponer_grilla',
    ejecutar: async (entrada, ctx) => {
      // Se consulta el estado antes del presupuesto y de cualquier llamada al
      // modelo: si la grilla ya salió de borrador el upsert la va a rechazar
      // igual, y hoy eso se pagaba con hasta cuatro llamadas primero.
      const estadoPrevio = await estadoDeLaGrilla(ctx.db, entrada.brandId, entrada.mes)
      if (estadoPrevio !== null && estadoPrevio !== 'borrador') {
        throw grillaNoRegenerable(entrada, estadoPrevio)
      }

      await exigirPresupuesto(ctx.db, entrada.brandId, new Date())

      const { version, perfil } = await cargarPerfilVigente(ctx.db, entrada.brandId)
      const { id: strategyId, estrategia } = await cargarEstrategiaVigente(ctx.db, entrada.brandId)
      const instrucciones = await readFile(RUTA_PROMPT, 'utf8')

      const registrarUso = crearRegistrador(ctx.db, {
        organizationId: ctx.organizationId,
        brandId: entrada.brandId,
        runId: ctx.runId,
        brandProfileVersion: version,
      })

      let mensajes: MensajeLlm[] = [
        { rol: 'sistema', texto: instrucciones },
        {
          rol: 'usuario',
          texto: [
            contextoDeMarca(perfil),
            '',
            '## Estrategia vigente',
            JSON.stringify(estrategia, null, 2),
            '',
            '## Encargo',
            `Planifica la grilla del mes ${entrada.mes}.`,
          ].join('\n'),
        },
      ]

      let slots: TipoSlotPropuesto[] = []
      let problemas: Problema[] = []

      // Un solo intento de reparación, alimentado con los problemas detectados.
      for (let intento = 1; intento <= 2; intento++) {
        const { datos } = await ejecutarTarea(TAREA_GRILLA, mensajes, {
          cliente: deps.cliente,
          ...(deps.env !== undefined ? { env: deps.env } : {}),
          registrarUso,
        })

        slots = datos.slots
        problemas = validarGrilla(slots, { mes: entrada.mes, perfil, estrategia })
        if (!hayBloqueantes(problemas)) break

        if (intento === 2) {
          throw permanente(
            `La grilla propuesta sigue teniendo problemas bloqueantes:\n` +
              problemas.map((p) => `- [${p.regla}] ${p.detalle}`).join('\n'),
          )
        }

        mensajes = [
          ...mensajes,
          { rol: 'asistente', texto: JSON.stringify(datos) },
          {
            rol: 'usuario',
            texto:
              'La grilla anterior incumple estas reglas:\n' +
              problemas
                .filter((p) => p.severidad === 'bloqueante')
                .map((p) => `- ${p.regla}: ${p.detalle}`)
                .join('\n') +
              '\nDevuelve la grilla corregida completa, sin explicaciones.',
          },
        ]
      }

      const derivados = expandirDerivados(slots, estrategia, entrada.mes)

      // La grilla que se guarda es la expandida, no la que propuso el modelo:
      // se vuelve a validar sobre ella para que los avisos de cadencia y de
      // pilares describan lo que de verdad queda en la base.
      const problemasFinales = validarGrilla([...slots, ...derivados], {
        mes: entrada.mes,
        perfil,
        estrategia,
      })

      // Un bloqueante aquí no es algo que el modelo pueda reparar: `slots` ya
      // pasó la validación y `expandirDerivados` es determinístico. Si aparece,
      // las dos mitades dejaron de estar de acuerdo y es un defecto del código.
      if (hayBloqueantes(problemasFinales)) {
        throw permanente(
          `La grilla expandida incumple reglas que la expansión debía respetar:\n` +
            problemasFinales
              .filter((p) => p.severidad === 'bloqueante')
              .map((p) => `- [${p.regla}] ${p.detalle}`)
              .join('\n'),
        )
      }

      const contentPlanId = await persistir(ctx, entrada, strategyId, slots, derivados)

      return {
        contentPlanId,
        totalSlots: slots.length + derivados.length,
        avisos: problemasFinales.filter((p) => p.severidad === 'aviso'),
      }
    },
  })

  return { nombre: 'p2_grilla', pasos: [paso] }
}

async function cargarEstrategiaVigente(
  db: BaseDeDatos,
  brandId: string,
): Promise<{ id: string; estrategia: TipoEstrategia }> {
  const [fila] = await db
    .select()
    .from(esquema.strategies)
    .where(eq(esquema.strategies.brandId, brandId))
    .orderBy(desc(esquema.strategies.createdAt))
    .limit(1)

  if (!fila) throw permanente(`La marca ${brandId} no tiene estrategia generada`)

  const r = Estrategia.safeParse(fila.data)
  if (!r.success) throw permanente(`La estrategia guardada de ${brandId} no valida`)

  return { id: fila.id, estrategia: r.data }
}

/** Acepta tanto la conexión como una transacción abierta. */
type Consultable = Pick<BaseDeDatos, 'select'>

async function estadoDeLaGrilla(
  db: Consultable,
  brandId: string,
  mes: string,
): Promise<string | null> {
  const [fila] = await db
    .select({ status: esquema.contentPlans.status })
    .from(esquema.contentPlans)
    .where(
      and(
        eq(esquema.contentPlans.brandId, brandId),
        eq(esquema.contentPlans.month, `${mes}-01`),
      ),
    )
  return fila?.status ?? null
}

/**
 * El remedio que se indica es el único que existe: `content_plans` no tiene
 * estado "archivada" —sus estados son borrador, aprobada, en_ejecucion y
 * cerrada— así que pedir archivar la grilla llevaba a violar el CHECK.
 */
function grillaNoRegenerable(entrada: EntradaP2, estado: string) {
  return permanente(
    `La grilla de ${entrada.mes} para la marca ${entrada.brandId} está en estado ` +
      `"${estado}" y solo se regenera una que esté en borrador. ` +
      `Devuélvela a "borrador" para regenerarla.`,
  )
}

/**
 * Todo en una transacción: el upsert del plan, el borrado de los slots
 * anteriores y las dos inserciones. Sueltos, una falla al insertar los padres
 * dejaba el mes con su content_plan y sin un solo slot —el borrador anterior
 * destruido y nada en su lugar.
 */
async function persistir(
  ctx: ContextoDePaso,
  entrada: EntradaP2,
  strategyId: string,
  slots: TipoSlotPropuesto[],
  derivados: ReturnType<typeof expandirDerivados>,
): Promise<string> {
  const mes = `${entrada.mes}-01`

  return ctx.db.transaction(async (tx) => {
    const [plan] = await tx
      .insert(esquema.contentPlans)
      .values({
        organizationId: ctx.organizationId,
        brandId: entrada.brandId,
        strategyId,
        month: mes,
      })
      .onConflictDoUpdate({
        target: [esquema.contentPlans.brandId, esquema.contentPlans.month],
        // `status` queda fuera del set: un borrador sigue siendo borrador, y el
        // setWhere impide tocar una grilla aprobada, en ejecución o cerrada.
        set: { strategyId },
        setWhere: eq(esquema.contentPlans.status, 'borrador'),
      })
      .returning()

    // Sin fila devuelta, la grilla dejó de estar en borrador entre la
    // comprobación previa y este upsert. Se escala antes de borrar nada:
    // regenerar destruiría planificación ya revisada y, desde la Fase 2, las
    // piezas de contenido colgadas de esos slots.
    if (!plan) {
      const estado = await estadoDeLaGrilla(tx, entrada.brandId, entrada.mes)
      throw grillaNoRegenerable(entrada, estado ?? 'desconocido')
    }

    const contentPlanId = plan.id

    // Solo se llega aquí con un borrador: regenerar lo reemplaza por completo,
    // para que un mes nunca mezcle planificación vieja con nueva.
    await tx
      .delete(esquema.planSlots)
      .where(eq(esquema.planSlots.contentPlanId, contentPlanId))

    const aFila = (s: TipoSlotPropuesto, sourceSlotId: string | null) => ({
      organizationId: ctx.organizationId,
      contentPlanId,
      sourceSlotId,
      scheduledFor: new Date(`${s.fecha}T${s.hora}:00Z`),
      channel: s.canal,
      format: s.formato,
      pillar: s.pilar,
      angle: s.angulo,
      brief: s.brief,
    })

    const padres = await tx
      .insert(esquema.planSlots)
      .values(slots.map((s) => aFila(s, null)))
      .returning({ id: esquema.planSlots.id })

    if (derivados.length > 0) {
      await tx
        .insert(esquema.planSlots)
        .values(derivados.map((d) => aFila(d, padres[d.indiceDelPadre]!.id)))
    }

    return contentPlanId
  })
}
