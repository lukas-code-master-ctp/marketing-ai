import { describe, expect, it } from 'vitest'
import { Encargo } from './encargo.js'

/** Un encargo con lo obligatorio lleno y lo opcional vacío. */
const MINIMO = {
  objetivo: 'Vender las doce parcelas que quedan del loteo norte',
  comoSeMide: 'Formularios de contacto recibidos',
  publicacionesPorSemana: 4,
  canalesDisponibles: ['instagram', 'blog'],
  queEstaPasando: '',
  queFunciono: '',
  queNoFunciono: '',
  queEvitar: '',
  algoMas: '',
}

describe('Encargo', () => {
  it('acepta lo obligatorio lleno y lo opcional vacío', () => {
    // Los cinco campos opcionales van SIEMPRE presentes y posiblemente
    // vacíos, no ausentes: es lo que evita la ambigüedad de «opcional» que
    // el prompt del perfil ya se comió una vez.
    expect(Encargo.safeParse(MINIMO).success).toBe(true)
  })

  it('rechaza un objetivo que no dice nada', () => {
    expect(Encargo.safeParse({ ...MINIMO, objetivo: 'vender' }).success).toBe(false)
  })

  it('rechaza quedarse sin canales', () => {
    // Sin canales el mix de la estrategia no tendría de dónde elegir.
    expect(Encargo.safeParse({ ...MINIMO, canalesDisponibles: [] }).success).toBe(false)
  })

  it('rechaza un canal que el sistema no publica', () => {
    expect(Encargo.safeParse({ ...MINIMO, canalesDisponibles: ['podcast'] }).success).toBe(false)
  })

  it('exige que la capacidad sea un entero de al menos uno', () => {
    expect(Encargo.safeParse({ ...MINIMO, publicacionesPorSemana: 0 }).success).toBe(false)
    expect(Encargo.safeParse({ ...MINIMO, publicacionesPorSemana: 2.5 }).success).toBe(false)
  })

  it('rechaza una capacidad que solo puede ser un error de tecleo', () => {
    // El tope no vigila la sensatez del plan: solo ataja un 500 escrito de
    // más, que produciría una grilla imposible.
    expect(Encargo.safeParse({ ...MINIMO, publicacionesPorSemana: 500 }).success).toBe(false)
  })

  it('exige los cinco campos opcionales presentes, aunque vacíos', () => {
    const { algoMas: _, ...sinAlgoMas } = MINIMO
    expect(Encargo.safeParse(sinAlgoMas).success).toBe(false)
  })
})
