import { describe, expect, it } from 'vitest'
import {
  aSnakeCase,
  desdeElPerfil,
  haciaElPerfil,
  FORMULARIO_VACIO,
} from './conversion.js'

/** Un perfil completo y válido, con todos los campos poblados. */
const PERFIL = {
  posicionamiento: {
    categoria: 'Venta de parcelas de agrado',
    promesa: 'Parcelas con factibilidad garantizada y trazabilidad legal completa',
    diferenciadores: ['Factibilidad verificada', 'Financiamiento directo'],
  },
  publicos: [
    {
      nombre: 'Inversionista primerizo',
      dolor: 'Teme comprar un terreno sin agua ni acceso legal',
      objecion: 'No sabe distinguir una parcela regularizada de una que no lo está',
    },
  ],
  tono: {
    atributos: ['claro', 'didáctico'],
    hacer: ['Explicar con datos concretos'],
    noHacer: ['Prometer retornos'],
  },
  lexico: { preferido: ['factibilidad'], prohibido: ['oportunidad única'] },
  pilares: [
    { nombre: 'educacion', descripcion: 'Sobre qué enseña la marca', proporcion: 0.6 },
    { nombre: 'producto', descripcion: 'Qué vende la marca', proporcion: 0.4 },
  ],
  ofertas: [
    { nombre: 'Tour guiado', descripcion: 'Visita al terreno', url: 'https://ejemplo.cl/tour' },
  ],
  restricciones: { disclaimers: ['Imágenes referenciales'] },
}

describe('ida y vuelta', () => {
  it('un perfil completo sobrevive la conversión sin perder nada', () => {
    // LA PRUEBA CENTRAL DE TODO EL BLOQUE. Si el formulario no sabe
    // representar un campo, se pierde acá y no en producción.
    expect(haciaElPerfil(desdeElPerfil(PERFIL))).toEqual(PERFIL)
  })
})

describe('desdeElPerfil', () => {
  it('convierte las proporciones a porcentajes enteros', () => {
    expect(desdeElPerfil(PERFIL).pilares.map((p) => p.porcentaje)).toEqual([60, 40])
  })

  it('una oferta sin url llega como cadena vacía', () => {
    const sinUrl = { ...PERFIL, ofertas: [{ nombre: 'Tour', descripcion: 'Visita al terreno' }] }
    expect(desdeElPerfil(sinUrl).ofertas[0]!.url).toBe('')
  })

  it('no revienta con un perfil incompleto ni con basura', () => {
    // Recibe `unknown` desde el servidor: un perfil viejo, la plantilla, o
    // algo corrupto. Su trabajo es cargar lo que se pueda, no validar — de
    // eso responde el esquema al guardar.
    expect(() => desdeElPerfil({})).not.toThrow()
    expect(() => desdeElPerfil(null)).not.toThrow()
    expect(desdeElPerfil({}).pilares).toHaveLength(2)
    expect(desdeElPerfil({ posicionamiento: { categoria: 'Algo' } }).posicionamiento.categoria)
      .toBe('Algo')
  })
})

describe('haciaElPerfil', () => {
  it('convierte los porcentajes a proporciones', () => {
    const f = { ...FORMULARIO_VACIO, pilares: [
      { nombre: 'educacion', descripcion: 'Enseña', porcentaje: 33 },
      { nombre: 'producto', descripcion: 'Vende', porcentaje: 33 },
      { nombre: 'prueba', descripcion: 'Prueba', porcentaje: 34 },
    ] }
    const salida = haciaElPerfil(f) as { pilares: { proporcion: number }[] }
    expect(salida.pilares.map((p) => p.proporcion)).toEqual([0.33, 0.33, 0.34])
    // Y suman exactamente 1, que es lo que el esquema exige.
    expect(salida.pilares.reduce((t, p) => t + p.proporcion, 0)).toBeCloseTo(1, 10)
  })

  it('una url vacía OMITE la clave, no manda cadena vacía', () => {
    // El esquema declara `url` opcional pero con forma de URL: una cadena
    // vacía se rechaza, la ausencia se acepta. Es el borde más probable de
    // todo el bloque.
    const f = { ...FORMULARIO_VACIO, ofertas: [{ nombre: 'Tour', descripcion: 'Visita', url: '' }] }
    const salida = haciaElPerfil(f) as { ofertas: Record<string, unknown>[] }
    expect(Object.hasOwn(salida.ofertas[0]!, 'url')).toBe(false)
  })

  it('convierte el nombre del pilar a snake_case', () => {
    const f = { ...FORMULARIO_VACIO, pilares: [
      { nombre: 'Prueba de manejo', descripcion: 'Algo', porcentaje: 50 },
      { nombre: 'Postventa', descripcion: 'Algo', porcentaje: 50 },
    ] }
    const salida = haciaElPerfil(f) as { pilares: { nombre: string }[] }
    expect(salida.pilares.map((p) => p.nombre)).toEqual(['prueba_de_manejo', 'postventa'])
  })

  it('descarta los elementos de lista que quedaron vacíos', () => {
    // El formulario arranca listas con una fila vacía. Mandarla produciría
    // un error del esquema sobre un elemento que la persona nunca llenó.
    const f = {
      ...FORMULARIO_VACIO,
      posicionamiento: { categoria: 'Algo', promesa: 'Una promesa larga', diferenciadores: ['Uno', '', '  '] },
    }
    const salida = haciaElPerfil(f) as { posicionamiento: { diferenciadores: string[] } }
    expect(salida.posicionamiento.diferenciadores).toEqual(['Uno'])
  })
})

describe('haciaElPerfil con conservarVacios', () => {
  /** Un formulario con una fila vacía de cada clase. */
  const CON_VACIOS = {
    ...FORMULARIO_VACIO,
    posicionamiento: { categoria: 'Algo', promesa: 'Una promesa larga', diferenciadores: ['Uno', ''] },
    publicos: [{ nombre: '', dolor: '', objecion: '' }],
    pilares: [
      { nombre: 'educacion', descripcion: 'Enseña', porcentaje: 30 },
      { nombre: '', descripcion: '', porcentaje: 70 },
    ],
    ofertas: [{ nombre: 'Tour', descripcion: 'Visita al terreno', url: '' }],
  }

  it('conserva las filas vacías en vez de descartarlas', () => {
    // El caso que motivó el bloque: una IA que recibe `"publicos": []` no
    // tiene forma de saber que cada público lleva nombre, dolor y objeción.
    const s = haciaElPerfil(CON_VACIOS, { conservarVacios: true }) as {
      publicos: unknown[]
      pilares: unknown[]
      posicionamiento: { diferenciadores: string[] }
    }
    expect(s.publicos).toHaveLength(1)
    expect(s.publicos[0]).toEqual({ nombre: '', dolor: '', objecion: '' })
    expect(s.pilares).toHaveLength(2)
    expect(s.posicionamiento.diferenciadores).toEqual(['Uno', ''])
  })

  it('conserva la clave url aunque esté vacía', () => {
    // Al guardar se omite, porque el esquema la rechaza vacía. Al copiar se
    // conserva, porque es la única forma de que la IA sepa que existe.
    const s = haciaElPerfil(CON_VACIOS, { conservarVacios: true }) as {
      ofertas: Record<string, unknown>[]
    }
    expect(Object.hasOwn(s.ofertas[0]!, 'url')).toBe(true)
    expect(s.ofertas[0]!.url).toBe('')
  })

  it('sigue en la forma del ESQUEMA, no en la del formulario', () => {
    // La trampa que rompería el pegado de vuelta: el formulario tiene
    // `porcentaje: 50`, el esquema tiene `proporcion: 0.5`, y
    // `desdeElPerfil` lee `proporcion`.
    const s = haciaElPerfil(CON_VACIOS, { conservarVacios: true }) as {
      pilares: Record<string, unknown>[]
    }
    expect(s.pilares[0]!.proporcion).toBe(0.3)
    expect(Object.hasOwn(s.pilares[0]!, 'porcentaje')).toBe(false)
  })

  it('sin la opción se comporta exactamente como antes', () => {
    // La garantía de que el camino de guardado no cambió.
    const s = haciaElPerfil(CON_VACIOS) as {
      publicos: unknown[]
      pilares: unknown[]
      posicionamiento: { diferenciadores: string[] }
      ofertas: Record<string, unknown>[]
    }
    expect(s.publicos).toHaveLength(0)
    expect(s.pilares).toHaveLength(1)
    expect(s.posicionamiento.diferenciadores).toEqual(['Uno'])
    expect(Object.hasOwn(s.ofertas[0]!, 'url')).toBe(false)
  })

  it('lo que se conserva se puede volver a leer con desdeElPerfil', () => {
    // La garantía del pegado: copiar y volver a cargar reconstruye el mismo
    // formulario, filas vacías incluidas.
    const s = haciaElPerfil(CON_VACIOS, { conservarVacios: true })
    const vuelta = desdeElPerfil(s)
    expect(vuelta.publicos).toHaveLength(1)
    expect(vuelta.pilares).toHaveLength(2)
    expect(vuelta.pilares[1]!.porcentaje).toBe(70)
  })
})

describe('aSnakeCase', () => {
  it('minúsculas, sin acentos, con guiones bajos', () => {
    expect(aSnakeCase('Prueba de Manejo')).toBe('prueba_de_manejo')
    expect(aSnakeCase('Educación')).toBe('educacion')
    expect(aSnakeCase('  postventa  ')).toBe('postventa')
    expect(aSnakeCase('A/B testing')).toBe('a_b_testing')
  })

  it('lo que no se puede convertir devuelve cadena vacía', () => {
    // El esquema exige que empiece con una letra. Un nombre que empieza con
    // dígito o que queda vacío no se puede adivinar: el campo lo marca.
    expect(aSnakeCase('123')).toBe('')
    expect(aSnakeCase('!!!')).toBe('')
    expect(aSnakeCase('')).toBe('')
  })
})
