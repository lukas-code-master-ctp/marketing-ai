import { describe, expect, it } from 'vitest'
import { FORMULARIO_VACIO } from './conversion.js'
import { promptParaIa } from './prompt.js'

const A_MEDIAS = {
  ...FORMULARIO_VACIO,
  posicionamiento: {
    categoria: 'Venta de autos usados',
    promesa: 'Autos revisados con garantía real',
    diferenciadores: ['Revisión de 120 puntos'],
  },
}

describe('promptParaIa', () => {
  it('nombra la marca', () => {
    expect(promptParaIa('tapcar', FORMULARIO_VACIO)).toContain('tapcar')
  })

  it('lleva el esqueleto con las claves de las filas vacías', () => {
    // Es el punto del bloque: sin esto, quien lea el prompt no puede saber
    // que un público lleva nombre, dolor y objeción.
    const p = promptParaIa('tapcar', FORMULARIO_VACIO)
    expect(p).toContain('"objecion"')
    expect(p).toContain('"proporcion"')
    expect(p).toContain('"disclaimers"')
  })

  it('conserva lo que ya se escribió, para que la IA complete y no reinvente', () => {
    expect(promptParaIa('tapcar', A_MEDIAS)).toContain('Autos revisados con garantía real')
  })

  it('dice las reglas que el esqueleto no puede mostrar', () => {
    const p = promptParaIa('tapcar', FORMULARIO_VACIO)
    expect(p).toMatch(/al menos dos pilares/i)
    expect(p).toMatch(/snake_case/)
    expect(p).toMatch(/suman\s+(exactamente\s+)?1\b/i)
    // Con comillas invertidas, no solo `/noHacer/`: esa clave también vive en
    // el esqueleto JSON (entre comillas dobles), así que un regex suelto no
    // caería si se borrara la viñeta que explica el campo.
    expect(p).toMatch(/`noHacer`/)
  })

  it('pide devolver solo JSON y sin filas vacías', () => {
    // Sin filas vacías porque el mismo archivo puede cargarse por el CLI, que
    // NO las descarta: `cargarPerfilDeArchivo` pasa el archivo directo a
    // validar, y ahí una fila en blanco hace fallar el esquema.
    const p = promptParaIa('tapcar', FORMULARIO_VACIO)
    expect(p).toMatch(/SOLO\s+(el\s+)?JSON/i)
    expect(p).toMatch(/vac[ií]as/i)
  })

  it('el esqueleto es JSON válido por sí solo', () => {
    // Si el esqueleto quedara mal formado, lo que la IA devuelva heredaría el
    // problema. Se extrae el bloque entre la primera llave y la última.
    const p = promptParaIa('tapcar', FORMULARIO_VACIO)
    const desde = p.indexOf('{')
    const hasta = p.lastIndexOf('}')
    expect(() => JSON.parse(p.slice(desde, hasta + 1))).not.toThrow()
  })
})
