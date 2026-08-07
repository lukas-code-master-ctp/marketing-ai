import { describe, expect, it } from 'vitest'
import { resolverNivel } from './niveles.js'

const ENTORNO = {
  MODELO_RAZONAMIENTO: 'proveedor/modelo-fuerte',
  MODELO_RAZONAMIENTO_RESPALDO: 'proveedor/modelo-fuerte-alt',
  MODELO_REDACCION: 'proveedor/modelo-medio',
  MODELO_REDACCION_RESPALDO: 'proveedor/modelo-medio-alt',
  MODELO_UTILITARIO: 'proveedor/modelo-barato',
  MODELO_UTILITARIO_RESPALDO: 'proveedor/modelo-barato-alt',
}

describe('resolverNivel', () => {
  it('resuelve principal y respaldo de cada nivel', () => {
    expect(resolverNivel('razonamiento', ENTORNO)).toEqual({
      principal: 'proveedor/modelo-fuerte',
      respaldo: 'proveedor/modelo-fuerte-alt',
    })
    expect(resolverNivel('utilitario', ENTORNO).principal).toBe('proveedor/modelo-barato')
  })

  it('falla de inmediato si falta la variable de entorno', () => {
    expect(() => resolverNivel('redaccion', {})).toThrow(/MODELO_REDACCION/)
  })

  it('usa el principal como respaldo si no hay respaldo configurado', () => {
    const parcial = { MODELO_REDACCION: 'proveedor/uno' }
    expect(resolverNivel('redaccion', parcial)).toEqual({
      principal: 'proveedor/uno',
      respaldo: 'proveedor/uno',
    })
  })

  it('usa el principal como respaldo si la variable de respaldo está vacía', () => {
    const parcial = { MODELO_REDACCION: 'proveedor/uno', MODELO_REDACCION_RESPALDO: '' }
    expect(resolverNivel('redaccion', parcial)).toEqual({
      principal: 'proveedor/uno',
      respaldo: 'proveedor/uno',
    })
  })

  it('usa el principal como respaldo si la variable de respaldo tiene solo espacios', () => {
    const parcial = { MODELO_REDACCION: 'proveedor/uno', MODELO_REDACCION_RESPALDO: '   ' }
    expect(resolverNivel('redaccion', parcial)).toEqual({
      principal: 'proveedor/uno',
      respaldo: 'proveedor/uno',
    })
  })

  it('falla si el principal tiene solo espacios, nombrando la variable', () => {
    expect(() => resolverNivel('redaccion', { MODELO_REDACCION: '   ' })).toThrow(
      /MODELO_REDACCION/,
    )
  })

  it('devuelve los valores recortados de espacios sobrantes', () => {
    const parcial = {
      MODELO_REDACCION: '  proveedor/uno  ',
      MODELO_REDACCION_RESPALDO: '  proveedor/dos  ',
    }
    expect(resolverNivel('redaccion', parcial)).toEqual({
      principal: 'proveedor/uno',
      respaldo: 'proveedor/dos',
    })
  })
})
