import {
  crearRegistrador, definirTarea, ejecutarTarea, exigirPresupuesto,
  type MensajeLlm,
} from '@gc/ai'
import { cargarPerfilVigente, contextoDeMarca, type TipoPerfilDeMarca } from '@gc/brand'
import { esquema, type BaseDeDatos } from '@gc/db'
import { definirPaso, type ContextoDePaso, type DefinicionDeFlujo } from '@gc/pipeline'
import { permanente } from '@gc/shared'
import {
  GrillaPropuesta, expandirDerivados, hayBloqueantes, leerEstrategiaDelTrimestre, validarGrilla,
  type Problema, type TipoEstrategia, type TipoSlotPropuesto,
} from '@gc/strategy'
import { and, eq } from 'drizzle-orm'
import { readFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import type { Dependencias } from './tipos.js'

export const TAREA_GRILLA = definirTarea({
  nombre: 'proponer_grilla',
  nivel: 'razonamiento',
  esquema: GrillaPropuesta,
  temperatura: 0.7,
  maxTokensSalida: 8000,
})

// Aviso para quien despliegue esto: `fileURLToPath` corre en tiempo de
// ejecución con la ruta absoluta de la máquina donde vive este checkout —
// funciona en desarrollo local y en cualquier build hecho y ejecutado en la
// misma máquina/imagen, pero si el CLI (o el worker que lo reemplace) corre
// en una máquina distinta a la que generó el build, con una ruta de proyecto
// distinta, la ruta absoluta ya no existe y `readFile(RUTA_PROMPT)` falla
// con ENOENT.
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

/** Lo que el paso del modelo le entrega al de persistencia. El perfil y la
 *  estrategia viajan inline: son JSON de todos modos, y así el segundo paso
 *  no vuelve a consultarlos ni puede leer una versión distinta. */
interface SalidaDeLaPropuesta {
  brandId: string
  mes: string
  strategyId: string
  slots: TipoSlotPropuesto[]
  estrategia: TipoEstrategia
  perfil: TipoPerfilDeMarca
}

export function crearFlujoGrilla(deps: Dependencias): DefinicionDeFlujo {
  const pasoProponer = definirPaso<EntradaP2, SalidaDeLaPropuesta>({
    nombre: 'proponer_grilla',
    ejecutar: async (entrada, ctx) => {
      // Se consulta el estado antes del presupuesto y de cualquier llamada al
      // modelo: si la grilla ya salió de borrador el upsert la va a rechazar
      // igual, y hoy eso se pagaba con hasta cuatro llamadas primero.
      const estadoPrevio = await estadoDeLaGrilla(ctx.db, entrada.brandId, entrada.mes)
      if (estadoPrevio !== null && estadoPrevio !== 'borrador') {
        throw grillaNoRegenerable(entrada, estadoPrevio, ctx.brandSlug)
      }

      await exigirPresupuesto(ctx.db, entrada.brandId, new Date(), ctx.brandSlug)

      const { version, perfil } = await cargarPerfilVigente(ctx.db, entrada.brandId, ctx.brandSlug)
      const { id: strategyId, estrategia } = await cargarEstrategiaVigente(
        ctx.db, entrada.brandId, entrada.mes, ctx.brandSlug,
      )
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

      return {
        brandId: entrada.brandId,
        mes: entrada.mes,
        strategyId,
        slots,
        estrategia,
        perfil,
      }
    },
  })

  const pasoPersistir = definirPaso<SalidaDeLaPropuesta, SalidaP2>({
    nombre: 'persistir_grilla',
    ejecutar: async (entrada, ctx) => {
      const { mes, estrategia, perfil, slots, strategyId } = entrada

      const derivados = expandirDerivados(slots, estrategia, mes)

      // La grilla que se guarda es la expandida, no la que propuso el modelo:
      // se vuelve a validar sobre ella para que los avisos de cadencia y de
      // pilares describan lo que de verdad queda en la base.
      const problemasFinales = validarGrilla([...slots, ...derivados], {
        mes,
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

  return { nombre: 'p2_grilla', pasos: [pasoProponer, pasoPersistir] }
}

/**
 * Envoltorio sobre `leerEstrategiaDelTrimestre` que traduce sus dos casos de
 * fallo a los `permanente` que este flujo lanzaba antes, con los mismos
 * textos: quien genera una grilla no puede continuar sin estrategia, así que
 * distinguir "no hay" de "hay pero no valida" solo cambia el mensaje.
 */
async function cargarEstrategiaVigente(
  db: BaseDeDatos,
  brandId: string,
  mes: string,
  nombreVisible?: string,
): Promise<{ id: string; estrategia: TipoEstrategia }> {
  const lectura = await leerEstrategiaDelTrimestre(db, brandId, mes, { archivadas: 'excluir' })

  if (lectura.tipo === 'ausente') {
    throw permanente(
      `La marca ${nombreVisible ?? brandId} no tiene estrategia vigente para ${lectura.periodo}. ` +
        `Genérala antes de la grilla de ${mes}.`,
    )
  }

  if (lectura.tipo === 'invalida') {
    throw permanente(`La estrategia guardada de ${nombreVisible ?? brandId} no valida`)
  }

  return { id: lectura.id, estrategia: lectura.estrategia }
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
function grillaNoRegenerable(entrada: EntradaP2, estado: string, nombreVisible?: string) {
  return permanente(
    `La grilla de ${entrada.mes} para la marca ${nombreVisible ?? entrada.brandId} está en estado ` +
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
      throw grillaNoRegenerable(entrada, estado ?? 'desconocido', ctx.brandSlug)
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
