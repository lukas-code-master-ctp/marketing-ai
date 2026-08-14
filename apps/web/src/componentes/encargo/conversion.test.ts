import { describe, expect, it } from 'vitest'
import {
  FORMULARIO_VACIO, desdeElEncargo, faltanCamposObligatorios, haciaElEncargo,
} from './conversion.js'

const LLENO = {
  objetivo: 'Vender las doce parcelas que quedan del loteo norte',
  comoSeMide: 'Formularios de contacto recibidos',
  publicacionesPorSemana: '4',
  canalesDisponibles: ['instagram', 'blog'],
  queEstaPasando: 'Empieza la temporada alta',
  queFunciono: '',
  queNoFunciono: '',
  queEvitar: '',
  algoMas: '',
}

describe('haciaElEncargo', () => {
  it('convierte la capacidad de texto a número', () => {
    const s = haciaElEncargo(LLENO) as { publicacionesPorSemana: unknown }
    expect(s.publicacionesPorSemana).toBe(4)
  })

  it('recorta los espacios de los textos', () => {
    const s = haciaElEncargo({ ...LLENO, objetivo: '  Vender las doce parcelas  ' }) as {
      objetivo: string
    }
    expect(s.objetivo).toBe('Vender las doce parcelas')
  })

  it('conserva los campos opcionales vacíos como cadena vacía', () => {
    // El esquema los exige presentes: omitirlos lo haría fallar.
    const s = haciaElEncargo(LLENO) as Record<string, unknown>
    expect(s.queFunciono).toBe('')
    expect(Object.hasOwn(s, 'algoMas')).toBe(true)
  })

  it('una capacidad no numérica no se convierte en NaN silencioso', () => {
    // NaN sobrevive a JSON.stringify como `null`, y el esquema lo rechazaría
    // con un mensaje que no menciona la capacidad. Se manda el texto tal cual
    // para que el rechazo diga lo que pasa.
    const s = haciaElEncargo({ ...LLENO, publicacionesPorSemana: 'cuatro' }) as {
      publicacionesPorSemana: unknown
    }
    expect(Number.isNaN(s.publicacionesPorSemana)).toBe(false)
  })
})

describe('desdeElEncargo', () => {
  it('carga lo que se pueda y nunca lanza', () => {
    expect(() => desdeElEncargo(null)).not.toThrow()
    expect(desdeElEncargo(null)).toEqual(FORMULARIO_VACIO)
    expect(() => desdeElEncargo(5)).not.toThrow()
  })

  it('no comparte el arreglo de canales con la constante del módulo', () => {
    // `{ ...FORMULARIO_VACIO }` copia una sola capa. Sin un arreglo nuevo,
    // marcar una casilla de canal mutándola en el sitio corrompería el
    // «vacío» para todas las llamadas siguientes de la sesión. Las demás
    // pruebas usan `toEqual`, que compara por valor y no ve este aliasing.
    const uno = desdeElEncargo(null)
    const otro = desdeElEncargo(null)
    expect(uno.canalesDisponibles).not.toBe(FORMULARIO_VACIO.canalesDisponibles)
    expect(uno.canalesDisponibles).not.toBe(otro.canalesDisponibles)

    uno.canalesDisponibles.push('instagram')
    expect(FORMULARIO_VACIO.canalesDisponibles).toEqual([])
    expect(desdeElEncargo(null).canalesDisponibles).toEqual([])
  })

  it('la ida y vuelta reconstruye el mismo formulario', () => {
    expect(desdeElEncargo(haciaElEncargo(LLENO))).toEqual(LLENO)
  })
})

describe('faltanCamposObligatorios', () => {
  it('el formulario vacío tiene campos obligatorios sin llenar', () => {
    expect(faltanCamposObligatorios(FORMULARIO_VACIO)).toBe(true)
  })

  it('el formulario con los cuatro obligatorios llenos no', () => {
    expect(faltanCamposObligatorios(LLENO)).toBe(false)
  })

  it('no exige los cinco opcionales', () => {
    // Es la mitad de «obligatorio» que importa: el cuestionario existe, no que
    // los nueve campos estén llenos.
    expect(faltanCamposObligatorios({ ...LLENO, queEstaPasando: '', algoMas: '' })).toBe(false)
  })

  it('sin canales elegidos falta algo obligatorio', () => {
    expect(faltanCamposObligatorios({ ...LLENO, canalesDisponibles: [] })).toBe(true)
  })

  it('un objetivo de solo espacios no cuenta como lleno', () => {
    expect(faltanCamposObligatorios({ ...LLENO, objetivo: '   ' })).toBe(true)
  })
})
