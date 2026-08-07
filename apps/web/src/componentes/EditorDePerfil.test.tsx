// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { guardarPerfilAction } from '../acciones.js'
import { EditorDePerfil } from './EditorDePerfil.js'

vi.mock('../acciones.js', () => ({
  guardarPerfilAction: vi.fn(async () => ({ ok: true, datos: { version: 8 } })),
}))

afterEach(cleanup)
// Una prueba reemplaza `navigator.clipboard` con `Object.defineProperty`; sin
// restaurarlo, la propiedad propia queda puesta para las pruebas que siguen
// en este archivo y contamina cualquiera que dependa del comportamiento
// original (ausente en jsdom). Borrarla revela de nuevo lo que hubiera en el
// prototipo, que es el estado con el que arrancó cada prueba.
afterEach(() => {
  Reflect.deleteProperty(navigator, 'clipboard')
})
beforeEach(() => vi.mocked(guardarPerfilAction).mockClear())

const PROPS = {
  marca: 'parcelas',
  version: 7,
  perfil: {
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
  },
  versiones: [{ version: 7, createdAt: new Date('2026-08-01T00:00:00Z') }],
}

describe('EditorDePerfil', () => {
  it('anuncia la versión que devolvió la acción, no la que traía de props', async () => {
    vi.mocked(guardarPerfilAction).mockResolvedValueOnce({ ok: true, datos: { version: 8 } })

    render(<EditorDePerfil {...PROPS} />)
    await userEvent.click(screen.getByRole('button', { name: 'Guardar' }))

    expect(screen.queryByText('Perfil guardado como versión 8.')).not.toBeNull()
    expect(screen.queryByText('Perfil guardado como versión 7.')).toBeNull()
  })

  it('un JSON inválido muestra el mensaje del dominio y no ofrece reintentar', async () => {
    vi.mocked(guardarPerfilAction).mockResolvedValueOnce({
      ok: false,
      mensaje: 'El texto no es JSON válido: Unexpected token',
      reintentable: false,
    })

    render(<EditorDePerfil {...PROPS} />)
    await userEvent.click(screen.getByRole('button', { name: 'Guardar' }))

    expect(screen.getByRole('alert').textContent).toContain('no es JSON válido')
    expect(screen.queryByRole('button', { name: 'Reintentar' })).toBeNull()
  })

  it('"Reintentar" vuelve a llamar con el mismo texto', async () => {
    vi.mocked(guardarPerfilAction)
      .mockResolvedValueOnce({ ok: false, mensaje: 'La base no respondió', reintentable: true })
      .mockResolvedValueOnce({ ok: true, datos: { version: 8 } })

    render(<EditorDePerfil {...PROPS} />)
    await userEvent.click(screen.getByRole('button', { name: 'Guardar' }))
    await userEvent.click(screen.getByRole('button', { name: 'Reintentar' }))

    expect(vi.mocked(guardarPerfilAction)).toHaveBeenCalledTimes(2)
    expect(vi.mocked(guardarPerfilAction).mock.calls[0]).toEqual(
      vi.mocked(guardarPerfilAction).mock.calls[1],
    )
    expect(screen.queryByText('Perfil guardado como versión 8.')).not.toBeNull()
  })

  it('guarda el JSON del esquema, no el estado del formulario', async () => {
    // La garantía que une todo el bloque: lo que viaja a la Server Action
    // tiene la forma que el esquema espera —proporciones, no porcentajes—
    // y no la forma cómoda de editar.
    render(<EditorDePerfil {...PROPS} />)
    await userEvent.click(screen.getByRole('button', { name: 'Guardar' }))

    const [, texto] = vi.mocked(guardarPerfilAction).mock.calls[0]!
    const enviado = JSON.parse(texto)
    expect(enviado.pilares[0].proporcion).toBe(0.6)
    expect(enviado.pilares[0].porcentaje).toBeUndefined()
  })

  it('la sección avanzada muestra el JSON del estado actual', async () => {
    render(<EditorDePerfil {...PROPS} />)
    // `<summary>` no lleva `role="button"`: es un widget de divulgación
    // nativo, y jsdom no le resuelve el rol implícito. Se ubica por su
    // texto, que también es lo que ve la persona que hace clic.
    await userEvent.click(screen.getByText('Avanzado: ver o pegar el JSON'))

    const area = screen.getByLabelText('Perfil de marca en formato JSON')
    expect(JSON.parse((area as HTMLTextAreaElement).value).pilares[0].proporcion).toBe(0.6)
  })

  it('un JSON inválido en la sección avanzada muestra el error y no toca el formulario', async () => {
    render(<EditorDePerfil {...PROPS} />)
    await userEvent.click(screen.getByText('Avanzado: ver o pegar el JSON'))

    const area = screen.getByLabelText('Perfil de marca en formato JSON')
    // `fireEvent.change` en vez de `userEvent.type`: se simula pegar el
    // texto de una vez, y evita que `userEvent.type` interprete las llaves
    // del JSON como teclas especiales (`{` abre un modificador para esa
    // API).
    fireEvent.change(area, { target: { value: '{ esto no es json válido' } })
    await userEvent.click(
      screen.getByRole('button', { name: 'Cargar este JSON en el formulario' }),
    )

    expect(screen.getByRole('alert').textContent).toContain('no es JSON válido')
    expect((screen.getByLabelText('Categoría') as HTMLInputElement).value).toBe(
      PROPS.perfil.posicionamiento.categoria,
    )
  })

  it('un JSON parseable que no describe un perfil muestra el error y no toca el formulario', async () => {
    // IMPORTANTE 1: `JSON.parse('{"otra":"cosa"}')` no lanza, y `desdeElPerfil`
    // "carga lo que se pueda y nunca lanza" —con esta entrada, nada—. Sin la
    // guarda de `pareceUnPerfil`, esto vaciaría el formulario en silencio.
    render(<EditorDePerfil {...PROPS} />)
    await userEvent.click(screen.getByText('Avanzado: ver o pegar el JSON'))

    const area = screen.getByLabelText('Perfil de marca en formato JSON')
    fireEvent.change(area, { target: { value: '{"otra":"cosa"}' } })
    await userEvent.click(
      screen.getByRole('button', { name: 'Cargar este JSON en el formulario' }),
    )

    expect(screen.getByRole('alert').textContent).toMatch(/no parece un perfil/i)
    // La aserción que importa es sobre el VALOR del campo, no sobre el
    // documento entero: si el formulario se hubiera vaciado, este campo
    // quedaría en ''.
    expect((screen.getByLabelText('Categoría') as HTMLInputElement).value).toBe(
      PROPS.perfil.posicionamiento.categoria,
    )
  })

  it('un JSON válido en la sección avanzada sí carga el formulario', async () => {
    render(<EditorDePerfil {...PROPS} />)
    await userEvent.click(screen.getByText('Avanzado: ver o pegar el JSON'))

    const area = screen.getByLabelText('Perfil de marca en formato JSON')
    const nuevo = {
      ...PROPS.perfil,
      posicionamiento: { ...PROPS.perfil.posicionamiento, categoria: 'Categoría reemplazada' },
    }
    fireEvent.change(area, { target: { value: JSON.stringify(nuevo) } })
    await userEvent.click(
      screen.getByRole('button', { name: 'Cargar este JSON en el formulario' }),
    )

    expect(screen.queryByRole('alert')).toBeNull()
    expect((screen.getByLabelText('Categoría') as HTMLInputElement).value).toBe(
      'Categoría reemplazada',
    )
  })

  it('con una edición del JSON sin cargar, "Guardar" queda deshabilitado y no llama a la acción con el perfil viejo', async () => {
    // IMPORTANTE 2: el escenario real es "abrió la sección avanzada para
    // pegar un perfil nuevo, y apretó Guardar sin cargarlo primero". Si
    // alguien revirtiera el arreglo, el botón dejaría de deshabilitarse y
    // este clic SÍ llamaría a la acción con `haciaElPerfil(formulario)"
    // —el perfil viejo—, así que esta aserción se pondría roja.
    render(<EditorDePerfil {...PROPS} />)
    await userEvent.click(screen.getByText('Avanzado: ver o pegar el JSON'))

    const area = screen.getByLabelText('Perfil de marca en formato JSON')
    fireEvent.change(area, {
      target: { value: '{"posicionamiento":{"categoria":"Editado a mano, nunca cargado"}}' },
    })

    // No hay `jest-dom` en este paquete: `disabled` se lee como propiedad
    // del elemento, no con `toBeDisabled`.
    const botonGuardar = screen.getByRole('button', { name: 'Guardar' }) as HTMLButtonElement
    expect(botonGuardar.disabled).toBe(true)

    await userEvent.click(botonGuardar)

    expect(vi.mocked(guardarPerfilAction)).not.toHaveBeenCalled()
    expect(
      screen.queryByText(/edición del JSON sin cargar/),
    ).not.toBeNull()
  })

  it('con el formulario vacío, "Guardar" marca los campos obligatorios y no llama a la acción', async () => {
    // IMPORTANTE 3b: sin perfil, `desdeElPerfil(null)` arranca todos los
    // campos obligatorios vacíos. El primer clic en Guardar no debe mandar
    // eso al esquema —que respondería con seis líneas en inglés—, sino
    // marcar en la pantalla lo que falta.
    render(<EditorDePerfil {...PROPS} perfil={null} version={0} versiones={[]} />)

    await userEvent.click(screen.getByRole('button', { name: 'Guardar' }))

    expect(vi.mocked(guardarPerfilAction)).not.toHaveBeenCalled()
    expect(screen.getByLabelText('Categoría').getAttribute('aria-invalid')).toBe('true')
  })

  it('con los campos obligatorios llenos, "Guardar" no los marca y sí llama a la acción', async () => {
    render(<EditorDePerfil {...PROPS} />)

    await userEvent.click(screen.getByRole('button', { name: 'Guardar' }))

    expect(vi.mocked(guardarPerfilAction)).toHaveBeenCalledTimes(1)
    expect(screen.getByLabelText('Categoría').getAttribute('aria-invalid')).not.toBe('true')
  })

  it('el JSON avanzado muestra el formulario completo, con sus filas vacías', async () => {
    // Antes mostraba lo que se GUARDARÍA, que descarta lo vacío: alguien con
    // una tarjeta «Público 1» delante veía `"publicos": []` y concluía,
    // razonablemente, que algo se había perdido.
    render(<EditorDePerfil {...PROPS} perfil={null} />)
    await userEvent.click(screen.getByText('Avanzado: ver o pegar el JSON'))

    const area = screen.getByLabelText('Perfil de marca en formato JSON') as HTMLTextAreaElement
    const mostrado = JSON.parse(area.value)
    expect(mostrado.publicos).toHaveLength(1)
    expect(mostrado.pilares).toHaveLength(2)
  })

  it('guardar sigue descartando lo vacío', async () => {
    // El cambio de la sección avanzada NO debe filtrarse al guardado: la
    // fixture `PROPS` no trae de por sí ninguna fila vacía en `publicos`, así
    // que sin agregar una acá la aserción de abajo sería trivialmente cierta
    // se descarte o no. Se agrega un público con el botón de "agregar" —nace
    // vacío— para que el guardado tenga algo que descartar de verdad.
    render(<EditorDePerfil {...PROPS} />)
    await userEvent.click(screen.getByRole('button', { name: 'Agregar público' }))
    await userEvent.click(screen.getByRole('button', { name: 'Guardar' }))

    const [, texto] = vi.mocked(guardarPerfilAction).mock.calls[0]!
    const enviado = JSON.parse(texto)
    expect(enviado.publicos.every((p: { nombre: string }) => p.nombre !== '')).toBe(true)
  })

  it('ofrece el prompt, con la marca dentro', async () => {
    render(<EditorDePerfil {...PROPS} />)
    await userEvent.click(screen.getByText('Avanzado: ver o pegar el JSON'))

    const area = screen.getByLabelText('Prompt para una IA') as HTMLTextAreaElement
    // Se afirma sobre la APERTURA completa, no sobre la cadena «parcelas»
    // suelta: la fixture trae `categoria: 'Venta de parcelas de agrado'`, así
    // que esa palabra aparece dentro del esqueleto aunque `marca` nunca llegue
    // a `promptParaIa`. Solo esta forma distingue el cableado correcto del
    // roto.
    expect(area.value).toMatch(/perfil de marca de parcelas\b/)
    expect(area.value).toMatch(/al menos dos pilares/i)
  })

  it('el botón de copiar copia el prompt generado, no el texto avanzado', async () => {
    // Si `copiarPrompt` pasara `textoAvanzado` en vez de
    // `promptParaIa(marca, formulario)`, este espía capturaría el JSON crudo
    // en vez del prompt, y las dos aserciones de abajo caerían.
    const escribir = vi.fn((_texto: string) => Promise.resolve())
    Object.defineProperty(navigator, 'clipboard', {
      value: { writeText: escribir },
      configurable: true,
    })

    render(<EditorDePerfil {...PROPS} />)
    await userEvent.click(screen.getByText('Avanzado: ver o pegar el JSON'))
    await userEvent.click(screen.getByRole('button', { name: /Copiar prompt/ }))

    expect(escribir).toHaveBeenCalledTimes(1)
    const copiado = escribir.mock.calls[0]![0]
    // Sobre la apertura completa, por el mismo motivo que arriba: «parcelas»
    // a secas también vive en la categoría del esqueleto.
    expect(copiado).toMatch(/perfil de marca de parcelas\b/)
    expect(copiado).toMatch(/al menos dos pilares/i)
    expect(screen.getByText('Copiado.')).not.toBeNull()
  })

  it('editar un campo después de copiar limpia el aviso de "Copiado."', async () => {
    // El prompt cambia con el formulario; un aviso de éxito que sigue en
    // pantalla después de una edición ya no describe lo que hay copiado.
    Object.defineProperty(navigator, 'clipboard', {
      value: { writeText: () => Promise.resolve() },
      configurable: true,
    })

    render(<EditorDePerfil {...PROPS} />)
    await userEvent.click(screen.getByText('Avanzado: ver o pegar el JSON'))
    await userEvent.click(screen.getByRole('button', { name: /Copiar prompt/ }))
    expect(screen.getByText('Copiado.')).not.toBeNull()

    await userEvent.type(screen.getByLabelText('Categoría'), '!')

    expect(screen.queryByText('Copiado.')).toBeNull()
  })

  it('si el portapapeles falla lo dice, y el texto sigue disponible', async () => {
    // `navigator.clipboard` exige contexto seguro y puede estar denegado. El
    // botón es una comodidad sobre un texto que ya se puede copiar a mano;
    // que falle no puede dejar a nadie sin salida.
    Object.defineProperty(navigator, 'clipboard', {
      value: { writeText: () => Promise.reject(new Error('denegado')) },
      configurable: true,
    })

    render(<EditorDePerfil {...PROPS} />)
    await userEvent.click(screen.getByText('Avanzado: ver o pegar el JSON'))
    await userEvent.click(screen.getByRole('button', { name: /Copiar prompt/ }))

    // Acotado al bloque del prompt, no al documento entero: ahí es donde
    // vive el aviso de este fallo específico.
    const bloqueDelPrompt = screen.getByLabelText('Prompt para una IA').closest('div')!
    expect(within(bloqueDelPrompt).getByRole('alert').textContent).toMatch(/no se pudo copiar/i)
    const area = screen.getByLabelText('Prompt para una IA') as HTMLTextAreaElement
    // Sobre la apertura completa, por el mismo motivo que arriba.
    expect(area.value).toMatch(/perfil de marca de parcelas\b/)
  })
})
