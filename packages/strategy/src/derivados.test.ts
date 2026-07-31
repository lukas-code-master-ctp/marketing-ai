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
  mixDeCanales: [
    { canal: 'blog', publicacionesPorSemana: 1 },
    { canal: 'linkedin', publicacionesPorSemana: 1 },
    { canal: 'instagram', publicacionesPorSemana: 1 },
  ],
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
    const sinReglas = { mixDeCanales: [], reciclaje: [] } as unknown as TipoEstrategia
    expect(expandirDerivados([BASE], sinReglas, '2026-09')).toHaveLength(0)
  })

  it('descarta el derivado cuyo canal destino no está en el mix de la estrategia', () => {
    const mixParcial = {
      mixDeCanales: [
        { canal: 'blog', publicacionesPorSemana: 1 },
        { canal: 'linkedin', publicacionesPorSemana: 1 },
      ],
      reciclaje: [{ desde: 'blog', hacia: ['linkedin', 'instagram'], diasDespues: 2 }],
    } as unknown as TipoEstrategia

    const d = expandirDerivados([BASE], mixParcial, '2026-09')
    expect(d.map((x) => x.canal)).toEqual(['linkedin'])
  })

  it('no genera ningún derivado si el canal destino queda fuera del mix', () => {
    const fueraDelMix = {
      mixDeCanales: [{ canal: 'blog', publicacionesPorSemana: 1 }],
      reciclaje: [{ desde: 'blog', hacia: ['linkedin'], diasDespues: 2 }],
    } as unknown as TipoEstrategia

    expect(expandirDerivados([BASE], fueraDelMix, '2026-09')).toHaveLength(0)
  })

  it('descarta el derivado que chocaría con un slot padre en el mismo canal y día', () => {
    // El padre de blog del 10 genera linkedin el 12, pero el modelo ya propuso
    // un linkedin ese mismo día: persistir ambos violaría duplicado_por_dia.
    const yaHayLinkedin = { ...BASE, canal: 'linkedin' as const, fecha: '2026-09-12' }
    const d = expandirDerivados([BASE, yaHayLinkedin], ESTRATEGIA, '2026-09')

    expect(d.map((x) => x.canal)).toEqual(['instagram'])
  })

  it('descarta el derivado que chocaría con otro derivado creado antes', () => {
    // Dos padres de blog en días distintos con reglas que aterrizan el mismo día.
    const estrategia = {
      mixDeCanales: [
        { canal: 'blog', publicacionesPorSemana: 1 },
        { canal: 'linkedin', publicacionesPorSemana: 1 },
      ],
      reciclaje: [
        { desde: 'blog', hacia: ['linkedin'], diasDespues: 2 },
        { desde: 'blog', hacia: ['linkedin'], diasDespues: 1 },
      ],
    } as unknown as TipoEstrategia

    const otro = { ...BASE, fecha: '2026-09-11' }
    const d = expandirDerivados([BASE, otro], estrategia, '2026-09')

    // BASE(10)+2 = 12 y BASE(10)+1 = 11; otro(11)+2 = 13 y otro(11)+1 = 12 (choca).
    expect(d.map((x) => x.fecha)).toEqual(['2026-09-12', '2026-09-11', '2026-09-13'])
  })
})
