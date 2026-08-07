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

  it('documenta las claves de una oferta, que el esqueleto vacío no puede mostrar', () => {
    // El esqueleto de un perfil en blanco trae `"ofertas": []`: no hay ninguna
    // oferta de la que mostrar claves, así que si las reglas no las nombran,
    // nadie las nombra. Una IA que devuelva `{"titulo":…,"detalle":…}` produce
    // tarjetas en blanco y el contenido se pierde sin decir por qué.
    const p = promptParaIa('tapcar', FORMULARIO_VACIO)
    expect(p).toMatch(/cada\s+oferta\s+que\s+incluyas\s+lleva\s+`nombre`\s+y\s+`descripcion`/i)
  })

  it('pide QUITAR la clave url en vez de dejarla vacía', () => {
    // `conservarVacios` deja `"url": ""` en el esqueleto a propósito, para que
    // se vea que la clave existe. Pero el esquema declara `url` como
    // `.url().optional()`: la ausencia se acepta y la cadena vacía se rechaza.
    // Por la web no muerde —`guardar()` la omite—, pero sí por el camino de
    // copiar el JSON a un archivo y cargarlo con `pnpm cli perfil:cargar`,
    // que va directo a validar.
    const p = promptParaIa('tapcar', FORMULARIO_VACIO)
    expect(p).toMatch(/quita\s+la\s+clave\s+`url`/i)
  })

  it('explica qué son `preferido` y `prohibido`', () => {
    // Es lo que una IA que conoce la empresa sí sabría llenar, y sin
    // explicación lo deja vacío. Con comillas invertidas, no sueltos: las dos
    // palabras también viven en el esqueleto JSON, entre comillas dobles.
    const p = promptParaIa('tapcar', FORMULARIO_VACIO)
    expect(p).toMatch(/`preferido`/)
    expect(p).toMatch(/`prohibido`/)
  })

  it('dice que los nombres de pilar no se repiten', () => {
    // `validarPerfil` lanza «Hay nombres de pilar repetidos», y el esqueleto
    // —dos pilares con el nombre vacío— no puede insinuarlo.
    const p = promptParaIa('tapcar', FORMULARIO_VACIO)
    expect(p).toMatch(/nombres\s+de\s+pilar\s+no\s+se\s+repiten/i)
  })

  it('no se contradice sobre los públicos', () => {
    // Las reglas exigen al menos un público. La instrucción de cierre invita a
    // quitar lo que no se sepa llenar; si nombrara al público ahí, las dos
    // afirmaciones no podrían ser ciertas a la vez en el caso límite.
    const p = promptParaIa('tapcar', FORMULARIO_VACIO)
    expect(p).toMatch(/al menos un público/i)
    expect(p).not.toMatch(/informaci[oó]n para un p[úu]blico/i)
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
