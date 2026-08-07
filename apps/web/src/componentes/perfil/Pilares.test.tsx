// @vitest-environment jsdom
import { cleanup, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { SeccionPilares } from './Pilares.js'

afterEach(cleanup)

const DOS = [
  { nombre: 'educacion', descripcion: 'Sobre qué enseña', porcentaje: 60 },
  { nombre: 'producto', descripcion: 'Qué vende', porcentaje: 40 },
]

describe('SeccionPilares', () => {
  it('cuando suma 100 lo dice sin alarma', () => {
    render(<SeccionPilares valor={DOS} alCambiar={vi.fn()} />)
    const total = screen.getByTestId('total-de-pilares')
    expect(total.textContent).toContain('100')
    expect(total.getAttribute('data-completo')).toBe('true')
  })

  it('cuando no suma 100 dice cuánto falta', () => {
    const corto = [{ ...DOS[0]!, porcentaje: 30 }, DOS[1]!]
    render(<SeccionPilares valor={corto} alCambiar={vi.fn()} />)
    const total = screen.getByTestId('total-de-pilares')
    expect(total.getAttribute('data-completo')).toBe('false')
    // No basta con avisar que está mal: hay que decir cuánto falta, o la
    // persona tiene que hacer la resta a mano.
    expect(total.textContent).toContain('30')
  })

  it('muestra cómo va a quedar guardado el nombre', async () => {
    const alCambiar = vi.fn()
    render(<SeccionPilares valor={DOS} alCambiar={alCambiar} />)

    const nombre = screen.getAllByLabelText('Nombre del pilar')[0]!
    await userEvent.clear(nombre)
    await userEvent.type(nombre, 'Prueba de manejo')

    expect(screen.queryByText(/prueba_de_manejo/)).not.toBeNull()
  })

  it('marca un nombre que no se puede convertir', async () => {
    render(
      <SeccionPilares
        valor={[{ nombre: '123', descripcion: 'Algo', porcentaje: 50 }, DOS[1]!]}
        alCambiar={vi.fn()}
      />,
    )
    expect(screen.getByRole('alert').textContent).toMatch(/empezar con una letra/i)
  })

  it('marca los nombres repetidos', () => {
    render(
      <SeccionPilares
        valor={[
          { nombre: 'educacion', descripcion: 'Uno', porcentaje: 50 },
          { nombre: 'Educación', descripcion: 'Dos', porcentaje: 50 },
        ]}
        alCambiar={vi.fn()}
      />,
    )
    // Los dos se convierten a `educacion`: el choque no es visible en lo que
    // la persona escribió, solo en lo que se va a guardar.
    expect(screen.getByRole('alert').textContent).toMatch(/repetido/i)
  })

  it('con dos pilares no se puede quitar ninguno', () => {
    render(<SeccionPilares valor={DOS} alCambiar={vi.fn()} />)
    expect(screen.queryAllByRole('button', { name: /^Quitar pilar/ })).toHaveLength(0)
  })

  it('con tres sí se puede, y quita el que corresponde', async () => {
    const alCambiar = vi.fn()
    const tres = [...DOS, { nombre: 'postventa', descripcion: 'Después', porcentaje: 0 }]
    render(<SeccionPilares valor={tres} alCambiar={alCambiar} />)

    await userEvent.click(screen.getAllByRole('button', { name: /^Quitar pilar/ })[1]!)
    expect(alCambiar).toHaveBeenCalledWith([DOS[0], tres[2]])
  })
})
