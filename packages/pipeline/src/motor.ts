import { esquema, type BaseDeDatos } from '@gc/db'
import { ErrorDeDominio, esTransitorio, permanente } from '@gc/shared'
import { and, eq } from 'drizzle-orm'
import { calcularEspera } from './espera.js'

export interface ContextoDePaso {
  db: BaseDeDatos
  runId: string
  organizationId: string
  brandId?: string
  brandSlug?: string
}

export interface DefinicionDePaso<E, S> {
  nombre: string
  /**
   * Versión de la forma que devuelve este paso. Se sube a mano cuando la forma
   * cambia, y sirve para que reanudar una corrida vieja no le entregue al paso
   * siguiente una salida que ya no sabe leer.
   *
   * Es un contador humano y no un hash a propósito: un hash rechazaría por
   * cambios cosméticos y entrenaría a la gente a ignorarlo.
   */
  versionDeSalida?: number
  ejecutar(entrada: E, ctx: ContextoDePaso): Promise<S>
}

const VERSION_POR_DEFECTO = 1

/** El sobre con que el motor guarda la salida de un paso. Los pasos no lo ven:
 *  el motor lo pone al guardar y lo quita al reutilizar. */
interface SobreDeSalida {
  __v: number
  datos: unknown
}

function esSobre(valor: unknown): valor is SobreDeSalida {
  return typeof valor === 'object' && valor !== null && '__v' in valor && 'datos' in valor
}

export function definirPaso<E, S>(p: DefinicionDePaso<E, S>): DefinicionDePaso<E, S> {
  return p
}

export interface DefinicionDeFlujo {
  nombre: string
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  pasos: DefinicionDePaso<any, any>[]
}

export interface ContextoDeFlujo {
  organizationId: string
  brandId?: string
  brandSlug?: string
  /** Si se indica, se reanuda esa corrida en vez de crear una nueva. */
  runId?: string
}

export interface OpcionesDeEjecucion {
  maxIntentos?: number
  dormir?: (ms: number) => Promise<void>
  aleatorio?: () => number
}

export interface ResultadoDeFlujo {
  runId: string
  estado: 'completado' | 'fallido'
  salida: unknown
}

const MAX_INTENTOS_POR_DEFECTO = 5
const dormirDeVerdad = (ms: number) => new Promise<void>((r) => setTimeout(r, ms))

export async function ejecutarFlujo(
  db: BaseDeDatos,
  flujo: DefinicionDeFlujo,
  entrada: unknown,
  ctx: ContextoDeFlujo,
  opciones: OpcionesDeEjecucion = {},
): Promise<ResultadoDeFlujo> {
  const maxIntentos = opciones.maxIntentos ?? MAX_INTENTOS_POR_DEFECTO
  const dormir = opciones.dormir ?? dormirDeVerdad
  const aleatorio = opciones.aleatorio ?? Math.random

  const runId = ctx.runId
    ? await reanudarCorrida(db, ctx.runId, ctx.organizationId)
    : await crearCorrida(db, flujo, entrada, ctx)
  const ctxPaso: ContextoDePaso = {
    db,
    runId,
    organizationId: ctx.organizationId,
    ...(ctx.brandId !== undefined ? { brandId: ctx.brandId } : {}),
    ...(ctx.brandSlug !== undefined ? { brandSlug: ctx.brandSlug } : {}),
  }

  let valor: unknown = entrada

  for (const paso of flujo.pasos) {
    const clave = `${runId}:${paso.nombre}`

    // Se pregunta por la existencia de la fila, no por su contenido: un paso
    // completado puede haber devuelto null o void y aun así no debe reejecutarse.
    const previo = await pasoCompletado(db, clave)
    if (previo) {
      valor = desenvolver(previo.output, paso, runId)
      continue
    }

    try {
      valor = await ejecutarPaso(db, paso, valor, ctxPaso, clave, {
        maxIntentos, dormir, aleatorio,
      })
    } catch (error) {
      await marcarCorridaFallida(db, runId, error)
      throw error
    }
  }

  await db
    .update(esquema.pipelineRuns)
    .set({ status: 'completado', error: null, finishedAt: new Date() })
    .where(eq(esquema.pipelineRuns.id, runId))

  return { runId, estado: 'completado', salida: valor }
}

async function crearCorrida(
  db: BaseDeDatos,
  flujo: DefinicionDeFlujo,
  entrada: unknown,
  ctx: ContextoDeFlujo,
): Promise<string> {
  const [corrida] = await db
    .insert(esquema.pipelineRuns)
    .values({
      organizationId: ctx.organizationId,
      brandId: ctx.brandId ?? null,
      flow: flujo.nombre,
      input: entrada as object,
    })
    .returning()
  return corrida!.id
}

/** Reanudar exige que la corrida exista y pertenezca a la organización.
 *  Además vuelve a marcarla en curso: dejarla 'fallido' mientras se reejecuta
 *  la mostraría como fallada y corriendo al mismo tiempo. */
async function reanudarCorrida(
  db: BaseDeDatos,
  runId: string,
  organizationId: string,
): Promise<string> {
  const [corrida] = await db
    .select({ id: esquema.pipelineRuns.id })
    .from(esquema.pipelineRuns)
    .where(
      and(
        eq(esquema.pipelineRuns.id, runId),
        eq(esquema.pipelineRuns.organizationId, organizationId),
      ),
    )
  if (!corrida) throw permanente(`No existe la corrida ${runId} en esta organización`)

  await db
    .update(esquema.pipelineRuns)
    .set({ status: 'en_curso', error: null, finishedAt: null })
    .where(eq(esquema.pipelineRuns.id, runId))

  return corrida.id
}

async function marcarCorridaFallida(
  db: BaseDeDatos,
  runId: string,
  error: unknown,
): Promise<void> {
  try {
    await db
      .update(esquema.pipelineRuns)
      .set({ status: 'fallido', error: mensaje(error), finishedAt: new Date() })
      .where(eq(esquema.pipelineRuns.id, runId))
  } catch (fallaSecundaria) {
    // El error del paso se propaga intacto a propósito: es el que le importa a
    // quien llama, y reemplazarlo por uno de la base perdería su clasificación.
    //
    // El console.error es la única excepción deliberada a la convención de no
    // usar console.* en código de librería, y no un descuido: sin él, la
    // corrida se queda en 'en_curso' con `error` NULL —indistinguible de una
    // que sigue ejecutándose— y en ningún lado queda registrado por qué. La
    // alternativa es una falla operativa invisible por construcción.
    console.error(
      `[pipeline] no se pudo marcar como fallida la corrida ${runId}:`,
      fallaSecundaria,
    )
  }
}

/**
 * Una corrida vieja pudo completar este paso con una versión anterior del
 * código, cuya salida el paso siguiente ya no sabe leer. Antes eso llegaba
 * como `undefined` y reventaba lejos del origen; ahora se rechaza aquí, con
 * un mensaje que dice qué hacer.
 *
 * Una salida sin sobre es de antes de que el sobre existiera, así que también
 * es incompatible.
 */
function desenvolver(
  salida: unknown,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  paso: DefinicionDePaso<any, any>,
  runId: string,
): unknown {
  const esperada = paso.versionDeSalida ?? VERSION_POR_DEFECTO

  if (!esSobre(salida) || salida.__v !== esperada) {
    const encontrada = esSobre(salida) ? String(salida.__v) : 'ninguna'
    throw permanente(
      `La corrida ${runId} guardó el paso "${paso.nombre}" con una versión de salida ` +
        `incompatible (esperada ${esperada}, encontrada ${encontrada}). No se puede reanudar: ` +
        `genérala de nuevo.`,
    )
  }

  return salida.datos
}

/** Devuelve la fila completa, no su salida: distinguir "no hay fila" de
 *  "hay fila cuya salida es null" es lo que sostiene la idempotencia. */
async function pasoCompletado(db: BaseDeDatos, clave: string) {
  const [fila] = await db
    .select()
    .from(esquema.pipelineSteps)
    .where(
      and(
        eq(esquema.pipelineSteps.idempotencyKey, clave),
        eq(esquema.pipelineSteps.status, 'completado'),
      ),
    )
  return fila ?? null
}

async function ejecutarPaso(
  db: BaseDeDatos,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  paso: DefinicionDePaso<any, any>,
  entrada: unknown,
  ctx: ContextoDePaso,
  clave: string,
  o: Required<OpcionesDeEjecucion>,
): Promise<unknown> {
  const [fila] = await db
    .insert(esquema.pipelineSteps)
    .values({
      organizationId: ctx.organizationId,
      runId: ctx.runId,
      name: paso.nombre,
      status: 'en_curso',
      idempotencyKey: clave,
      input: entrada as object,
    })
    .onConflictDoUpdate({
      target: esquema.pipelineSteps.idempotencyKey,
      // Se reescribe la fila entera del intento anterior: conservar su `input`
      // o su `finished_at` dejaría un registro que miente sobre qué se ejecutó.
      set: {
        status: 'en_curso',
        attempt: 1,
        error: null,
        input: entrada as object,
        startedAt: new Date(),
        finishedAt: null,
      },
    })
    .returning()

  const idPaso = fila!.id
  let ultimoError: unknown

  for (let intento = 1; intento <= o.maxIntentos; intento++) {
    try {
      const salida = await paso.ejecutar(entrada, ctx)
      // Se guarda envuelto, pero se devuelve pelado: dentro de una misma
      // invocación el paso siguiente recibe exactamente lo mismo que antes.
      const sobre: SobreDeSalida = {
        __v: paso.versionDeSalida ?? VERSION_POR_DEFECTO,
        datos: salida,
      }
      await db
        .update(esquema.pipelineSteps)
        .set({
          status: 'completado',
          attempt: intento,
          output: sobre,
          error: null,
          finishedAt: new Date(),
        })
        .where(eq(esquema.pipelineSteps.id, idPaso))
      return salida
    } catch (error) {
      ultimoError = error
      const puedeReintentar = esTransitorio(error) && intento < o.maxIntentos

      // Misma decisión que en `marcarCorridaFallida`, y por el mismo motivo:
      // esta escritura es contabilidad y no puede reemplazar al error del paso.
      // Aquí además decide el reintento. Si el paso falló con un 08006 porque
      // Postgres se reinició, este UPDATE va contra la misma base caída; sin la
      // guarda su error escapa, el motor lo lee como permanente y el reintento
      // que 08006 existe para provocar no ocurre. El console.error tiene la
      // misma justificación que allá: sin él el paso queda 'en_curso' con
      // `error` NULL y la pérdida es invisible por construcción.
      try {
        await db
          .update(esquema.pipelineSteps)
          .set({
            status: puedeReintentar ? 'en_curso' : 'fallido',
            attempt: intento,
            error: mensaje(error),
            ...(puedeReintentar ? {} : { finishedAt: new Date() }),
          })
          .where(eq(esquema.pipelineSteps.id, idPaso))
      } catch (fallaSecundaria) {
        console.error(
          `[pipeline] no se pudo anotar el intento ${intento} del paso ${idPaso}:`,
          fallaSecundaria,
        )
      }

      if (!puedeReintentar) throw error
      await o.dormir(calcularEspera(intento, o.aleatorio))
    }
  }

  throw ultimoError
}

function mensaje(error: unknown): string {
  if (error instanceof ErrorDeDominio) return `[${error.clase}] ${error.message}`
  if (error instanceof Error) return error.message
  return String(error)
}
