import { describe, expect, it } from 'vitest'
import {
  ErrorDeDominio,
  ambiguo,
  clasificarError,
  clasificarHttp,
  clasificarPostgres,
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

describe('clasificarPostgres', () => {
  it.each([
    ['40001', 'transitorio'],
    ['40P01', 'transitorio'],
    ['08000', 'transitorio'],
    ['08003', 'transitorio'],
    ['08006', 'transitorio'],
    ['08001', 'transitorio'],
    ['08004', 'transitorio'],
    ['53300', 'transitorio'],
    ['55P03', 'transitorio'],
    ['57P01', 'transitorio'],
    ['57014', 'transitorio'],
    ['23505', 'permanente'],
    ['23503', 'permanente'],
    ['23514', 'permanente'],
    ['22007', 'permanente'],
    ['42601', 'permanente'],
    ['', 'permanente'],
  ])('clasifica el código %s como %s', (codigo, esperado) => {
    expect(clasificarPostgres(codigo)).toBe(esperado)
  })

  it('no clasifica por familia: 08999 no es transitorio solo por empezar con 08', () => {
    expect(clasificarPostgres('08999')).toBe('permanente')
  })
})

describe('clasificarError', () => {
  it('respeta la clase de un ErrorDeDominio', () => {
    expect(clasificarError(transitorio('x'))).toBe('transitorio')
    expect(clasificarError(permanente('x'))).toBe('permanente')
    expect(clasificarError(ambiguo('x'))).toBe('ambiguo')
  })

  it('clasifica un error de Postgres por su código', () => {
    const deadlock = Object.assign(new Error('deadlock detected'), { code: '40P01' })
    expect(clasificarError(deadlock)).toBe('transitorio')

    const duplicado = Object.assign(new Error('duplicate key'), { code: '23505' })
    expect(clasificarError(duplicado)).toBe('permanente')
  })

  it('trata como permanente cualquier otra cosa', () => {
    expect(clasificarError(new Error('cualquiera'))).toBe('permanente')
    expect(clasificarError(new TypeError('bug'))).toBe('permanente')
    expect(clasificarError('texto suelto')).toBe('permanente')
    expect(clasificarError(null)).toBe('permanente')
    expect(clasificarError({ code: 42 })).toBe('permanente')
  })

  it('esTransitorio delega en clasificarError', () => {
    const serializacion = Object.assign(new Error('could not serialize'), { code: '40001' })
    expect(esTransitorio(serializacion)).toBe(true)
    expect(esTransitorio(new Error('bug'))).toBe(false)
  })
})
