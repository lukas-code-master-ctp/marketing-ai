import { describe, expect, it } from 'vitest'
import { mesAnterior, mesSiguiente, semanasDelMes } from './calendario.js'

describe('semanasDelMes', () => {
  it('siempre devuelve semanas completas de siete días', () => {
    for (const mes of ['2026-01', '2026-02', '2026-09', '2026-12', '2028-02']) {
      for (const semana of semanasDelMes(mes)) {
        expect(semana).toHaveLength(7)
      }
    }
  })

  it('empieza en lunes y cubre el mes entero', () => {
    // Septiembre de 2026 empieza en martes.
    const semanas = semanasDelMes('2026-09')
    expect(semanas[0]![0]).toBe('2026-08-31') // lunes de relleno
    expect(semanas[0]![1]).toBe('2026-09-01')
    expect(semanas.flat()).toContain('2026-09-30')
  })

  it('no agrega semanas de relleno de más', () => {
    // Junio de 2026 empieza lunes: la primera semana no necesita relleno.
    const semanas = semanasDelMes('2026-06')
    expect(semanas[0]![0]).toBe('2026-06-01')
  })

  it('cubre febrero bisiesto', () => {
    expect(semanasDelMes('2028-02').flat()).toContain('2028-02-29')
  })

  it('rechaza un mes mal formado', () => {
    expect(() => semanasDelMes('2026-13')).toThrow(/mes inválido/i)
  })
})

describe('navegación', () => {
  it.each([
    ['2026-09', '2026-08', '2026-10'],
    ['2026-01', '2025-12', '2026-02'],
    ['2026-12', '2026-11', '2027-01'],
  ])('%s ← y →', (mes, anterior, siguiente) => {
    expect(mesAnterior(mes)).toBe(anterior)
    expect(mesSiguiente(mes)).toBe(siguiente)
  })
})
