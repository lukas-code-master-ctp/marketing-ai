import { permanente } from '@gc/shared'
import { z } from 'zod'
import type { NivelDeModelo } from './niveles.js'

export interface DefinicionDeTarea<S extends z.ZodTypeAny = z.ZodTypeAny> {
  /** Identificador estable en snake_case; se guarda en `ai_calls.task`. */
  nombre: string
  nivel: NivelDeModelo
  /** Debe ser un ZodObject: los proveedores exigen un objeto en la raíz. */
  esquema: S
  temperatura: number
  maxTokensSalida: number
}

const SNAKE_CASE = /^[a-z][a-z0-9_]*$/

export function definirTarea<S extends z.ZodTypeAny>(
  d: DefinicionDeTarea<S>,
): DefinicionDeTarea<S> {
  if (!SNAKE_CASE.test(d.nombre)) {
    throw permanente(`El nombre de tarea "${d.nombre}" debe estar en snake_case`)
  }
  if (d.temperatura < 0 || d.temperatura > 2) {
    throw permanente(`temperatura fuera de rango en "${d.nombre}": ${d.temperatura}`)
  }
  if (d.maxTokensSalida < 1) {
    throw permanente(`maxTokensSalida inválido en "${d.nombre}"`)
  }
  if (!(d.esquema instanceof z.ZodObject)) {
    throw permanente(`El esquema de "${d.nombre}" debe ser un objeto`)
  }
  return d
}
