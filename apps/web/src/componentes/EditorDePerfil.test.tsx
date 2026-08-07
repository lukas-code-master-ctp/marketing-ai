// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { guardarPerfilAction } from '../acciones.js'
import { EditorDePerfil } from './EditorDePerfil.js'

vi.mock('../acciones.js', () => ({
  guardarPerfilAction: vi.fn(async () => ({ ok: true, datos: { version: 8 } })),
}))

afterEach(cleanup)
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
})
