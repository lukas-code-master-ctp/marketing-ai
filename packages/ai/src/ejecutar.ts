import { permanente } from '@gc/shared'
import { createHash } from 'node:crypto'
import type { z } from 'zod'
import { zodToJsonSchema } from 'zod-to-json-schema'
import type { ClienteLlm, MensajeLlm } from './cliente.js'
import type { DefinicionDeTarea } from './tarea.js'

export interface UsoDeLlamada {
  tarea: string
  modelo: string
  tokensEntrada: number
  tokensSalida: number
  costoUsd: number
  latenciaMs: number
  hashDePrompt: string
}

export interface ResultadoDeTarea<T> {
  datos: T
  uso: UsoDeLlamada
}

export interface ContextoDeEjecucion {
  cliente: ClienteLlm
  /** Los modelos a intentar, en orden. Los resuelve quien llama. */
  modelos: { principal: string; respaldo: string }
  registrarUso?: (uso: UsoDeLlamada) => Promise<void>
}

function hashDePrompt(mensajes: MensajeLlm[]): string {
  return createHash('sha256')
    .update(mensajes.map((m) => `${m.rol}:${m.texto}`).join('\n'))
    .digest('hex')
    .slice(0, 16)
}

/**
 * Única puerta de entrada a un modelo. Valida contra el esquema de la tarea y
 * concede exactamente un intento de reparación antes de rendirse.
 */
export async function ejecutarTarea<S extends z.ZodTypeAny>(
  tarea: DefinicionDeTarea<S>,
  mensajes: MensajeLlm[],
  ctx: ContextoDeEjecucion,
): Promise<ResultadoDeTarea<z.infer<S>>> {
  const { principal, respaldo } = ctx.modelos
  const modelos = principal === respaldo ? [principal] : [principal, respaldo]
  const esquemaJson = zodToJsonSchema(tarea.esquema, {
    name: tarea.nombre,
    $refStrategy: 'none',
  })

  let conversacion = [...mensajes]
  let ultimoProblema = ''

  for (let intento = 1; intento <= 2; intento++) {
    const inicio = Date.now()
    const respuesta = await ctx.cliente.completar({
      modelos,
      mensajes: conversacion,
      esquemaJson,
      nombreEsquema: tarea.nombre,
      temperatura: tarea.temperatura,
      maxTokens: tarea.maxTokensSalida,
    })

    // Se registra antes de validar y en todos los caminos: una respuesta que
    // no cumple el esquema costó tokens igual que una que sí, y el control de
    // presupuesto es la única barrera con dinero detrás. La latencia es la de
    // esta llamada, no la acumulada, para que cada fila describa su llamada.
    const uso: UsoDeLlamada = {
      tarea: tarea.nombre,
      modelo: respuesta.modelo,
      tokensEntrada: respuesta.tokensEntrada,
      tokensSalida: respuesta.tokensSalida,
      costoUsd: respuesta.costoUsd,
      latenciaMs: Date.now() - inicio,
      hashDePrompt: hashDePrompt(mensajes),
    }
    await ctx.registrarUso?.(uso)

    const analisis = analizar(tarea.esquema, respuesta.texto)
    if (analisis.ok) return { datos: analisis.datos, uso }

    ultimoProblema = analisis.problema
    conversacion = [
      ...conversacion,
      { rol: 'asistente', texto: respuesta.texto },
      {
        rol: 'usuario',
        texto:
          `Tu respuesta anterior no cumple el esquema requerido:\n${analisis.problema}\n` +
          'Devuelve únicamente el JSON corregido, sin explicaciones.',
      },
    ]
  }

  throw permanente(
    `La tarea "${tarea.nombre}" no produjo una salida válida tras la reparación: ${ultimoProblema}`,
  )
}

type Analisis<T> = { ok: true; datos: T } | { ok: false; problema: string }

function analizar<S extends z.ZodTypeAny>(esquema: S, texto: string): Analisis<z.infer<S>> {
  let crudo: unknown
  try {
    crudo = JSON.parse(texto)
  } catch {
    return { ok: false, problema: 'La respuesta no es JSON válido.' }
  }
  const r = esquema.safeParse(crudo)
  if (!r.success) {
    const problema = r.error.issues
      .map((i) => `- ${i.path.join('.') || '(raíz)'}: ${i.message}`)
      .join('\n')
    return { ok: false, problema }
  }
  return { ok: true, datos: r.data }
}
