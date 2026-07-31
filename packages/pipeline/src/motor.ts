import { esquema, type BaseDeDatos } from '@gc/db'
import { ErrorDeDominio, esTransitorio } from '@gc/shared'
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

  const runId = ctx.runId ?? (await crearCorrida(db, flujo, entrada, ctx))
  const ctxPaso: ContextoDePaso = {
    db,
    runId,
    organizationId: ctx.organizationId,
    ...(ctx.brandId !== undefined ? { brandId: ctx.brandId } : {}),
  }

  let valor: unknown = entrada

  for (const paso of flujo.pasos) {
    const clave = `${runId}:${paso.nombre}`

    const previo = await pasoCompletado(db, clave)
    if (previo) {
      valor = previo
      continue
    }

    valor = await ejecutarPaso(db, paso, valor, ctxPaso, clave, {
      maxIntentos, dormir, aleatorio,
    }).catch(async (error: unknown) => {
      await db
        .update(esquema.pipelineRuns)
        .set({ status: 'fallido', error: mensaje(error), finishedAt: new Date() })
        .where(eq(esquema.pipelineRuns.id, runId))
      throw error
    })
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

async function pasoCompletado(db: BaseDeDatos, clave: string): Promise<unknown | null> {
  const [fila] = await db
    .select()
    .from(esquema.pipelineSteps)
    .where(
      and(
        eq(esquema.pipelineSteps.idempotencyKey, clave),
        eq(esquema.pipelineSteps.status, 'completado'),
      ),
    )
  return fila ? fila.output : null
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
      set: { status: 'en_curso', attempt: 1, error: null },
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
