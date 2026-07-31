import { describe, expect, it } from 'vitest'
import { calcularEspera } from './espera.js'

const SIN_JITTER = () => 0

describe('calcularEspera', () => {
  it('duplica la espera en cada intento', () => {
    expect(calcularEspera(1, SIN_JITTER)).toBe(1000)
    expect(calcularEspera(2, SIN_JITTER)).toBe(2000)
    expect(calcularEspera(3, SIN_JITTER)).toBe(4000)
    expect(calcularEspera(4, SIN_JITTER)).toBe(8000)
  })

  it('nunca supera el techo de 30 segundos de base', () => {
    expect(calcularEspera(10, SIN_JITTER)).toBe(30_000)
  })

  it('suma hasta 25% de jitter', () => {
    expect(calcularEspera(1, () => 1)).toBe(1250)
    expect(calcularEspera(1, () => 0.5)).toBe(1125)
  })
})
