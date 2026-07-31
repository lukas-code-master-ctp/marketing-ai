import { describe, expect, it } from 'vitest'
import { z } from 'zod'
import { definirTarea } from './tarea.js'

const esquema = z.object({ titulo: z.string() })

describe('definirTarea', () => {
  it('devuelve la definición cuando es válida', () => {
    const t = definirTarea({
      nombre: 'generar_copy',
      nivel: 'redaccion',
      esquema,
      temperatura: 0.7,
      maxTokensSalida: 1200,
    })
    expect(t.nombre).toBe('generar_copy')
    expect(t.nivel).toBe('redaccion')
  })

  it('rechaza nombres que no sean snake_case', () => {
    expect(() =>
      definirTarea({
        nombre: 'GenerarCopy',
        nivel: 'redaccion',
        esquema,
        temperatura: 0.7,
        maxTokensSalida: 1200,
      }),
    ).toThrow(/snake_case/)
  })

  it('rechaza temperatura fuera de rango', () => {
    expect(() =>
      definirTarea({
        nombre: 'generar_copy',
        nivel: 'redaccion',
        esquema,
        temperatura: 3,
        maxTokensSalida: 1200,
      }),
    ).toThrow(/temperatura/)
  })

  it('rechaza esquemas que no sean objetos', () => {
    expect(() =>
      definirTarea({
        nombre: 'generar_copy',
        nivel: 'redaccion',
        esquema: z.string() as never,
        temperatura: 0.7,
        maxTokensSalida: 1200,
      }),
    ).toThrow(/objeto/)
  })
})
