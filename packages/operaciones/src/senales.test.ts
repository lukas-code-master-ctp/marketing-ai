import { describe, expect, it } from 'vitest'
import { describirAntiguedad, describirDuracion } from './senales.js'

describe('describirDuracion', () => {
  it('bajo el minuto dice segundos', () => {
    expect(describirDuracion(0)).toBe('0 s')
    expect(describirDuracion(1)).toBe('1 s')
    expect(describirDuracion(42)).toBe('42 s')
    expect(describirDuracion(59)).toBe('59 s')
  })

  it('de un minuto arriba dice minutos y segundos', () => {
    expect(describirDuracion(60)).toBe('1 min 0 s')
    expect(describirDuracion(61)).toBe('1 min 1 s')
    expect(describirDuracion(252)).toBe('4 min 12 s')
    expect(describirDuracion(3600)).toBe('60 min 0 s')
  })

  it('no omite los segundos en el minuto exacto', () => {
    // `1 min` a secas quedaría inmóvil sesenta segundos, que es justo el
    // defecto que este contador existe para arreglar.
    expect(describirDuracion(60)).not.toBe('1 min')
    expect(describirDuracion(120)).toBe('2 min 0 s')
  })

  it('recorta la entrada igual que su vecina', () => {
    // Relojes desfasados entre la base y el proceso pueden dar un negativo.
    expect(describirDuracion(-5)).toBe('0 s')
    expect(describirDuracion(42.9)).toBe('42 s')
    expect(describirDuracion(60.9)).toBe('1 min 0 s')
  })
})

describe('describirAntiguedad', () => {
  // No tenía pruebas propias: se ejercitaba de refilón desde el panel. Se
  // cubre acá porque el punto de tener DOS formateadores es que difieren, y
  // sin esta comparación nada protege esa decisión.
  it('redondea a minutos por encima del minuto, sin segundos', () => {
    expect(describirAntiguedad(60)).toBe('1 minuto')
    expect(describirAntiguedad(252)).toBe('4 minutos')
    expect(describirAntiguedad(899)).toBe('14 minutos')
  })

  it('bajo el minuto dice segundos, en palabras', () => {
    expect(describirAntiguedad(1)).toBe('1 segundo')
    expect(describirAntiguedad(42)).toBe('42 segundos')
  })

  it('difiere de describirDuracion justo donde tiene que diferir', () => {
    // Si alguien las unifica, esta prueba lo dice. Los dos textos existen
    // porque uno habla de un pasado difuso —«sin señal desde hace 4
    // minutos»— y el otro de un contador que se mira avanzar.
    expect(describirAntiguedad(252)).not.toBe(describirDuracion(252))
  })
})
