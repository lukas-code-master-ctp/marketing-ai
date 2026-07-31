import { esquema, type BaseDeDatos } from '@gc/db'
import { ErrorDeDominio, esTransitorio, permanente } from '@gc/shared'
import { and, eq } from 'drizzle-orm'
import { calcularEspera } from './espera.js'

export interface ContextoDePaso {
  db: BaseDeDatos
  runId: string
  organizationId: string
  brandId?: string
}

export interface DefinicionDePaso<E, S> {
  nombre: string
  ejecutar(entrada: E, ctx: ContextoDePaso): Promise<S>
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
  }

  let valor: unknown = entrada

  for (const paso of flujo.pasos) {
    const clave = `${runId}:${paso.nombre}`

    // Se pregunta por la existencia de la fila, no por su contenido: un paso
    // completado puede haber devuelto null o void y aun así no debe reejecutarse.
    const previo = await pasoCompletado(db, clave)
    if (previo) {
      valor = previo.output
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
  } catch {
    // Se descarta a propósito: el error del paso es el que le importa a quien
    // llama, y reemplazarlo por uno de la base perdería su clasificación.
  }
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
      await db
        .update(esquema.pipelineSteps)
        .set({
          status: 'completado',
          attempt: intento,
          output: salida as object,
          error: null,
          finishedAt: new Date(),
        })
        .where(eq(esquema.pipelineSteps.id, idPaso))
      return salida
    } catch (error) {
      ultimoError = error
      const puedeReintentar = esTransitorio(error) && intento < o.maxIntentos
      await db
        .update(esquema.pipelineSteps)
        .set({
          status: puedeReintentar ? 'en_curso' : 'fallido',
          attempt: intento,
          error: mensaje(error),
          ...(puedeReintentar ? {} : { finishedAt: new Date() }),
        })
        .where(eq(esquema.pipelineSteps.id, idPaso))

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
