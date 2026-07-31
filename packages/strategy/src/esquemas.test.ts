import { describe, expect, it } from 'vitest'
import { GrillaPropuesta } from './esquemas.js'

const slot = (hora: string) => ({
  fecha: '2026-09-30',
  hora,
  canal: 'blog' as const,
  formato: 'articulo',
  pilar: 'educacion',
  angulo: 'guía práctica',
  brief: 'Explicar paso a paso cómo verificar la factibilidad antes de comprar.',
})

const acepta = (hora: string) => GrillaPropuesta.safeParse({ slots: [slot(hora)] }).success

describe('GrillaPropuesta · hora', () => {
  // `\d{2}:\d{2}` dejaba pasar horas que no existen. Una de ellas, 24:00,
  // desbordaba al día siguiente en silencio —el mismo defecto de mes que cierra
  // fecha_invalida, entrando por el campo hermano—; las otras reventaban en el
  // driver con un RangeError sin clasificar.
  it('rechaza 24:00, que desbordaría al día siguiente', () => {
    expect(acepta('24:00')).toBe(false)
  })

  it('rechaza 23:60, que no es una hora válida', () => {
    expect(acepta('23:60')).toBe(false)
  })

  it('rechaza 99:99', () => {
    expect(acepta('99:99')).toBe(false)
  })

  it('acepta el límite inferior 00:00', () => {
    expect(acepta('00:00')).toBe(true)
  })

  it('acepta el límite superior 23:59', () => {
    expect(acepta('23:59')).toBe(true)
  })

  it('acepta una hora corriente del medio del rango', () => {
    expect(acepta('13:45')).toBe(true)
  })

  it('explica el rango esperado cuando rechaza', () => {
    const r = GrillaPropuesta.safeParse({ slots: [slot('24:00')] })
    expect(r.success).toBe(false)
    if (r.success) return
    expect(r.error.issues.map((i) => i.message).join(' ')).toContain('00:00–23:59')
  })
})
