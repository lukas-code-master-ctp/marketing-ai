// @vitest-environment jsdom
import { cleanup, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { crearMarcaAccion } from '../acciones.js'
import { FormularioDeMarca } from './FormularioDeMarca.js'

// Sin implementación en el factory: en vitest 2.1 `mockReset` no la restaura
// —eso llegó en vitest 3— así que la respuesta por omisión vive en el
// `beforeEach`, que es el único lugar donde sobrevive al reset.
vi.mock('../acciones.js', () => ({ crearMarcaAccion: vi.fn() }))

const { empujar } = vi.hoisted(() => ({ empujar: vi.fn() }))
vi.mock('next/navigation', () => ({ useRouter: () => ({ push: empujar }) }))

afterEach(cleanup)
beforeEach(() => {
  vi.mocked(crearMarcaAccion).mockReset()
  vi.mocked(crearMarcaAccion).mockResolvedValue({ ok: true, datos: null })
  empujar.mockReset()
})

// No hay `jest-dom` en este paquete, así que `toHaveValue` no existe: el valor
// se lee del elemento.
function valorDe(etiqueta: RegExp): string {
  return (screen.getByLabelText(etiqueta) as HTMLInputElement).value
}

async function llenar({ slug = 'nueva-marca', nombre = 'Marca Nueva', presupuesto = '' } = {}) {
  render(<FormularioDeMarca />)
  await userEvent.type(screen.getByLabelText(/identificador/i), slug)
  await userEvent.type(screen.getByLabelText(/nombre/i), nombre)
  if (presupuesto !== '') {
    await userEvent.type(screen.getByLabelText(/presupuesto/i), presupuesto)
  }
  await userEvent.click(screen.getByRole('button', { name: 'Crear marca' }))
}

describe('FormularioDeMarca', () => {
  it('envía el slug, el nombre y el presupuesto tal como se escribieron', async () => {
    await llenar({ slug: 'tercera', nombre: 'La Tercera', presupuesto: '40.50' })

    expect(vi.mocked(crearMarcaAccion).mock.calls).toEqual([['tercera', 'La Tercera', '40.50']])
  })

  // Perder lo escrito ante un slug repetido es la clase de detalle que
  // enfurece: hay que volver a llenar tres campos para cambiar una letra.
  it('muestra el mensaje del dominio tal cual y conserva lo escrito', async () => {
    vi.mocked(crearMarcaAccion).mockResolvedValue({
      ok: false,
      mensaje: 'Ya existe una marca con el slug "tercera" en esta organización',
      reintentable: false,
    })

    await llenar({ slug: 'tercera', nombre: 'La Tercera', presupuesto: '40.50' })

    expect(screen.getByRole('alert').textContent).toBe(
      'Ya existe una marca con el slug "tercera" en esta organización',
    )
    expect(valorDe(/identificador/i)).toBe('tercera')
    expect(valorDe(/nombre/i)).toBe('La Tercera')
    expect(valorDe(/presupuesto/i)).toBe('40.50')
    expect(empujar).not.toHaveBeenCalled()
  })

  // La acción distingue "no lo llenó" de "escribió algo" comparando con la
  // cadena vacía. Un `undefined` o un `"0"` inventados acá le harían creer que
  // la persona pidió un presupuesto de cero dólares.
  it('con el presupuesto en blanco manda cadena vacía, no undefined ni "0"', async () => {
    await llenar({ slug: 'tercera', nombre: 'La Tercera' })

    expect(vi.mocked(crearMarcaAccion).mock.calls[0]![2]).toBe('')
  })

  it('tras crearla lleva al perfil de la marca nueva', async () => {
    await llenar({ slug: 'tercera', nombre: 'La Tercera' })

    expect(empujar).toHaveBeenCalledWith('/tercera/perfil')
  })

  // El botón volvía a habilitarse antes del `router.push`, y la navegación no
  // es instantánea: durante esos milisegundos un segundo clic pedía crear la
  // misma marca otra vez.
  it('el botón sigue deshabilitado mientras navega', async () => {
    await llenar({ slug: 'tercera', nombre: 'La Tercera' })

    expect(
      (screen.getByRole('button', { name: 'Crear marca' }) as HTMLButtonElement).disabled,
    ).toBe(true)
  })

  // Un error transitorio —la base caída un segundo— es lo único que reintentar
  // arregla, y acá reintentar es seguro porque el intento que falló no
  // escribió nada.
  it('ofrece reintentar cuando el error es transitorio, y el reintento vuelve a llamar', async () => {
    vi.mocked(crearMarcaAccion).mockResolvedValue({
      ok: false,
      mensaje: 'La base no respondió',
      reintentable: true,
    })

    await llenar({ slug: 'tercera', nombre: 'La Tercera' })
    vi.mocked(crearMarcaAccion).mockResolvedValue({ ok: true, datos: null })
    await userEvent.click(screen.getByRole('button', { name: 'Reintentar' }))

    expect(vi.mocked(crearMarcaAccion).mock.calls).toEqual([
      ['tercera', 'La Tercera', ''],
      ['tercera', 'La Tercera', ''],
    ])
    expect(empujar).toHaveBeenCalledWith('/tercera/perfil')
  })

  it('no ofrece reintentar cuando el error es permanente', async () => {
    vi.mocked(crearMarcaAccion).mockResolvedValue({
      ok: false,
      mensaje: 'Ya existe una marca con el slug "tercera" en esta organización',
      reintentable: false,
    })

    await llenar({ slug: 'tercera', nombre: 'La Tercera' })

    expect(screen.queryByRole('button', { name: 'Reintentar' })).toBeNull()
  })
})
