import type { ClienteLlm } from '@gc/ai'
import { esquema, type BaseDeDatos } from '@gc/db'
import { tomarCorridaPendiente } from '@gc/operaciones'
import { ejecutarFlujo } from '@gc/pipeline'
import { ErrorDeDominio } from '@gc/shared'
import { and, eq, ne } from 'drizzle-orm'
import { flujoDe } from './flujos.js'

export interface DependenciasDelWorker {
  cliente: ClienteLlm
}

export type ResultadoDeTurno = 'nada' | 'completada' | 'fallida'

/**
 * Una unidad de trabajo: toma una corrida pendiente, la ejecuta, devuelve qué
 * pasó. **Todo lo interesante del worker vive aquí y no en el bucle**, porque
 * un bucle no se prueba y esto sí.
 *
 * No lanza por una corrida fallida: un worker que muere porque una corrida
 * falló deja de atender a las demás. Lo único que puede escapar de aquí es un
 * fallo de infraestructura —la base caída mientras se toma o mientras se
 * anota el error— y de eso responde el bucle.
 */
export async function tomarYEjecutarUna(
  db: BaseDeDatos,
  deps: DependenciasDelWorker,
): Promise<ResultadoDeTurno> {
  const corrida = await tomarCorridaPendiente(db)
  if (!corrida) return 'nada'

  try {
    const flujo = flujoDe(corrida.flow, { cliente: deps.cliente })

    // El slug va junto al id porque los pasos lo usan como `nombreVisible` en
    // todo mensaje de error que ve el usuario —sin estrategia vigente, grilla
    // no regenerable, perfil ausente, presupuesto agotado—: sin él la pantalla
    // muestra el UUID de la marca en vez de su nombre.
    await ejecutarFlujo(db, flujo, corrida.input, {
      organizationId: corrida.organizationId,
      runId: corrida.id,
      ...(corrida.brandId !== null ? { brandId: corrida.brandId } : {}),
      ...(corrida.brandSlug !== null ? { brandSlug: corrida.brandSlug } : {}),
    })

    return 'completada'
  } catch (error) {
    await registrarFallo(db, corrida.id, error)
    return 'fallida'
  }
}

/**
 * Anota el fallo **solo si nadie lo anotó antes**.
 *
 * `ejecutarFlujo` ya marca la corrida fallida por su cuenta
 * (`marcarCorridaFallida` en `packages/pipeline/src/motor.ts`) antes de
 * relanzar, así que en el camino que pasa por el motor esta escritura llega
 * segunda. El `ne(status, 'fallido')` la deja sin efecto ahí: el motor es la
 * fuente autoritativa del error de una corrida que él ejecutó, y este worker
 * no tiene por qué pisarle el mensaje ni el `finished_at`.
 *
 * Hoy los dos textos coinciden —`mensaje` de más abajo es el mismo formato
 * `[clase] texto` que usa el motor— así que la guarda no cambia lo que se ve.
 * Lo que compra es no depender de que sigan coincidiendo: si el motor mejora
 * su diagnóstico, este UPDATE no lo degrada de vuelta.
 *
 * Y sigue haciendo falta, porque cubre los fallos que ocurren **fuera** del
 * alcance del motor, donde nadie más la haría: un flujo que este worker no
 * conoce —el mapa revienta antes de que `ejecutarFlujo` se llame siquiera— o
 * un fallo en el preámbulo del motor, que ocurre antes de su primer `try`. En
 * esos casos la corrida quedó `en_curso` por `tomarCorridaPendiente` y sin
 * este UPDATE se quedaría ahí para siempre, indistinguible de una que sigue
 * ejecutándose.
 */
async function registrarFallo(db: BaseDeDatos, runId: string, error: unknown): Promise<void> {
  await db
    .update(esquema.pipelineRuns)
    .set({ status: 'fallido', error: mensaje(error), finishedAt: new Date() })
    .where(and(eq(esquema.pipelineRuns.id, runId), ne(esquema.pipelineRuns.status, 'fallido')))
}

/** Mismo formato que usa el motor, para que las dos fuentes se lean igual. */
function mensaje(error: unknown): string {
  if (error instanceof ErrorDeDominio) return `[${error.clase}] ${error.message}`
  if (error instanceof Error) return error.message
  return String(error)
}
