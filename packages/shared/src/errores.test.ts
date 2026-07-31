import { describe, expect, it } from 'vitest'
import {
  ErrorDeDominio,
  ambiguo,
  clasificarHttp,
  esTransitorio,
  permanente,
  transitorio,
} from './errores.js'

describe('taxonomía de errores', () => {
  it('conserva clase y causa original', () => {
    const causa = new Error('socket colgado')
    const e = transitorio('la red falló', causa)
    expect(e).toBeInstanceOf(ErrorDeDominio)
    expect(e.clase).toBe('transitorio')
    expect(e.causa).toBe(causa)
    expect(e.message).toBe('la red falló')
  })

  it('marca los errores permanentes y ambiguos', () => {
    expect(permanente('esquema inválido').clase).toBe('permanente')
    expect(ambiguo('timeout al publicar').clase).toBe('ambiguo')
  })

  it.each([
    [408, 'transitorio'],
    [429, 'transitorio'],
    [500, 'transitorio'],
    [503, 'transitorio'],
    [400, 'permanente'],
    [401, 'permanente'],
    [404, 'permanente'],
  ])('clasifica el estado HTTP %i como %s', (status, esperado) => {
    expect(clasificarHttp(status)).toBe(esperado)
  })

  it('esTransitorio solo acepta ErrorDeDominio transitorios', () => {
    expect(esTransitorio(transitorio('x'))).toBe(true)
    expect(esTransitorio(permanente('x'))).toBe(false)
    expect(esTransitorio(new Error('x'))).toBe(false)
    expect(esTransitorio('x')).toBe(false)
  })
})
