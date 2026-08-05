import { describe, expect, it } from 'vitest'
import { correoPermitido, sesionDeDesarrollo } from './permitidos.js'

const LISTA = 'lukas@ejemplo.cl, ana@ejemplo.cl,BEA@Ejemplo.CL'

describe('correoPermitido', () => {
  it('deja entrar a quien está en la lista', () => {
    expect(correoPermitido('lukas@ejemplo.cl', LISTA)).toBe(true)
    expect(correoPermitido('ana@ejemplo.cl', LISTA)).toBe(true)
  })

  it('no deja entrar a quien no está', () => {
    expect(correoPermitido('otro@ejemplo.cl', LISTA)).toBe(false)
  })

  it('ignora mayúsculas y espacios de la lista y del correo', () => {
    expect(correoPermitido('  BEA@ejemplo.cl ', LISTA)).toBe(true)
  })

  it('sin lista configurada no deja entrar a nadie', () => {
    // Cerrado por omisión: una variable que falta en producción no puede
    // significar "que pase cualquiera".
    expect(correoPermitido('lukas@ejemplo.cl', undefined)).toBe(false)
    expect(correoPermitido('lukas@ejemplo.cl', '')).toBe(false)
    expect(correoPermitido('lukas@ejemplo.cl', '   ,  ')).toBe(false)
  })

  it('sin correo no deja entrar', () => {
    expect(correoPermitido(null, LISTA)).toBe(false)
    expect(correoPermitido(undefined, LISTA)).toBe(false)
    expect(correoPermitido('', LISTA)).toBe(false)
  })
})

describe('sesionDeDesarrollo', () => {
  it('en desarrollo y con la variable encendida devuelve una sesión', () => {
    const s = sesionDeDesarrollo({ NODE_ENV: 'development', SESION_DE_DESARROLLO: 'true' })
    expect(s).not.toBeNull()
    expect(s!.email).toContain('@')
  })

  it('en desarrollo sin la variable no devuelve nada', () => {
    expect(sesionDeDesarrollo({ NODE_ENV: 'development' })).toBeNull()
    expect(sesionDeDesarrollo({ NODE_ENV: 'development', SESION_DE_DESARROLLO: 'false' })).toBeNull()
  })

  it('en producción NO se activa aunque la variable esté encendida', () => {
    // Es la prueba que importa de este archivo. Una puerta trasera que depende
    // de recordar apagarla no es una puerta trasera de desarrollo.
    expect(sesionDeDesarrollo({ NODE_ENV: 'production', SESION_DE_DESARROLLO: 'true' })).toBeNull()
  })

  it('sin NODE_ENV tampoco se activa', () => {
    // Vercel define NODE_ENV, pero si algún día llegara vacío el resultado
    // seguro es no abrir la puerta.
    expect(sesionDeDesarrollo({ SESION_DE_DESARROLLO: 'true' })).toBeNull()
  })
})
