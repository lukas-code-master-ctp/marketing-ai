import { describe, expect, it } from 'vitest'
import { contextoDeMarca, validarPerfil } from './perfil.js'
import { PERFIL_VALIDO } from './perfil.fixture.js'

describe('validarPerfil', () => {
  it('acepta un perfil completo', () => {
    expect(validarPerfil(PERFIL_VALIDO).pilares).toHaveLength(3)
  })

  it('rechaza pilares cuyas proporciones no suman 1', () => {
    const malo = {
      ...PERFIL_VALIDO,
      pilares: [
        { nombre: 'educacion', descripcion: 'texto válido', proporcion: 0.5 },
        { nombre: 'producto', descripcion: 'texto válido', proporcion: 0.2 },
      ],
    }
    expect(() => validarPerfil(malo)).toThrow(/proporciones/i)
  })

  it('rechaza nombres de pilar repetidos', () => {
    const malo = {
      ...PERFIL_VALIDO,
      pilares: [
        { nombre: 'educacion', descripcion: 'texto válido', proporcion: 0.5 },
        { nombre: 'educacion', descripcion: 'texto válido', proporcion: 0.5 },
      ],
    }
    expect(() => validarPerfil(malo)).toThrow(/repetid/i)
  })

  it('rechaza nombres de pilar que no sean snake_case', () => {
    const malo = {
      ...PERFIL_VALIDO,
      pilares: [
        { nombre: 'Educación Financiera', descripcion: 'Cómo evaluar', proporcion: 0.5 },
        { nombre: 'producto', descripcion: 'Proyectos disponibles', proporcion: 0.5 },
      ],
    }
    expect(() => validarPerfil(malo)).toThrow(/snake_case/)
  })

  it('rechaza un perfil sin públicos', () => {
    expect(() => validarPerfil({ ...PERFIL_VALIDO, publicos: [] })).toThrow()
  })
})

describe('contextoDeMarca', () => {
  it('incluye promesa, pilares con su proporción y léxico prohibido', () => {
    const texto = contextoDeMarca(validarPerfil(PERFIL_VALIDO))

    expect(texto).toContain('Parcelas con factibilidad garantizada')
    expect(texto).toContain('educacion (40%)')
    expect(texto).toContain('Preferido: factibilidad, rol, trazabilidad')
    expect(texto).toContain('PROHIBIDO usar: Rentabilidad garantizada')
  })
})
