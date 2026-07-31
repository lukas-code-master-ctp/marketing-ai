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
})
