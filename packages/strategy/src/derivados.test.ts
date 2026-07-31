import { describe, expect, it } from 'vitest'
import { expandirDerivados } from './derivados.js'
import type { TipoEstrategia, TipoSlotPropuesto } from './esquemas.js'

const BASE: TipoSlotPropuesto = {
  fecha: '2026-09-10',
  hora: '12:00',
  canal: 'blog',
  formato: 'articulo',
  pilar: 'educacion',
  angulo: 'guía práctica',
  brief: 'Guía completa para verificar la factibilidad de agua antes de comprar.',
}

const ESTRATEGIA = {
  reciclaje: [{ desde: 'blog', hacia: ['linkedin', 'instagram'], diasDespues: 2 }],
} as unknown as TipoEstrategia

describe('expandirDerivados', () => {
  it('crea un derivado por canal destino, desplazado en el tiempo', () => {
    const d = expandirDerivados([BASE], ESTRATEGIA, '2026-09')

    expect(d).toHaveLength(2)
    expect(d.map((x) => x.canal).sort()).toEqual(['instagram', 'linkedin'])
    expect(d.every((x) => x.fecha === '2026-09-12')).toBe(true)
    expect(d.every((x) => x.indiceDelPadre === 0)).toBe(true)
    expect(d[0]!.pilar).toBe('educacion')
    expect(d[0]!.brief).toContain('Guía completa')
  })

  it('descarta los derivados que caerían fuera del mes', () => {
    const alFinal = { ...BASE, fecha: '2026-09-30' }
    expect(expandirDerivados([alFinal], ESTRATEGIA, '2026-09')).toHaveLength(0)
  })

  it('ignora los slots cuyo canal no tiene regla de reciclaje', () => {
    const post = { ...BASE, canal: 'linkedin' as const, formato: 'post' }
    expect(expandirDerivados([post], ESTRATEGIA, '2026-09')).toHaveLength(0)
  })

  it('no genera derivados si la estrategia no define reciclaje', () => {
    const sinReglas = { reciclaje: [] } as unknown as TipoEstrategia
    expect(expandirDerivados([BASE], sinReglas, '2026-09')).toHaveLength(0)
  })
})
