import { describe, expect, it } from 'vitest'
import { trimestreDe, validarPeriodo } from './periodos.js'

describe('trimestreDe', () => {
  it.each([
    ['2026-01', '2026-Q1'], ['2026-02', '2026-Q1'], ['2026-03', '2026-Q1'],
    ['2026-04', '2026-Q2'], ['2026-05', '2026-Q2'], ['2026-06', '2026-Q2'],
    ['2026-07', '2026-Q3'], ['2026-08', '2026-Q3'], ['2026-09', '2026-Q3'],
    ['2026-10', '2026-Q4'], ['2026-11', '2026-Q4'], ['2026-12', '2026-Q4'],
  ])('%s pertenece a %s', (mes, esperado) => {
    expect(trimestreDe(mes)).toBe(esperado)
  })

  it('no cruza el año', () => {
    expect(trimestreDe('2027-01')).toBe('2027-Q1')
  })

  it.each(['2026', '2026-13', '2026-00', 'septiembre', '2026-9'])(
    'rechaza el mes inválido %s',
    (mes) => {
      expect(() => trimestreDe(mes)).toThrow(/mes inválido/i)
    },
  )
})

describe('validarPeriodo', () => {
  it.each(['2026-Q1', '2026-Q4', '2030-Q2'])('acepta %s', (p) => {
    expect(validarPeriodo(p)).toBe(p)
  })

  it.each(['2026-Q0', '2026-Q5', '2026-q1', '2026-3', 'Q1-2026', '2026'])(
    'rechaza %s',
    (p) => {
      expect(() => validarPeriodo(p)).toThrow(/periodo inválido/i)
    },
  )
})
