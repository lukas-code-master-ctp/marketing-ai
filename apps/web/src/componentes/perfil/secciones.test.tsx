// @vitest-environment jsdom
import { cleanup, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { SeccionPublicos, SeccionOfertas, SeccionPosicionamiento } from './secciones.js'

afterEach(cleanup)

describe('SeccionPosicionamiento', () => {
  it('cambiar la categoría no borra la promesa', async () => {
    // Cada sección devuelve su rebanada ENTERA. Una que reconstruya el
    // objeto olvidando un campo lo borraría en silencio, y eso no lo vería
    // ninguna prueba de las primitivas.
    const alCambiar = vi.fn()
    render(
      <SeccionPosicionamiento
        valor={{ categoria: 'Vieja', promesa: 'Una promesa larga', diferenciadores: ['Uno'] }}
        alCambiar={alCambiar}
      />,
    )

    await userEvent.type(screen.getByLabelText('Categoría'), 'X')
    expect(alCambiar).toHaveBeenCalledWith({
      categoria: 'ViejaX',
      promesa: 'Una promesa larga',
      diferenciadores: ['Uno'],
    })
  })
})

describe('SeccionPublicos', () => {
  it('editar un público no toca a los demás', async () => {
    const alCambiar = vi.fn()
    render(
      <SeccionPublicos
        valor={[
          { nombre: 'Uno', dolor: 'Dolor uno largo', objecion: 'Objeción uno larga' },
          { nombre: 'Dos', dolor: 'Dolor dos largo', objecion: 'Objeción dos larga' },
        ]}
        alCambiar={alCambiar}
      />,
    )

    await userEvent.type(screen.getAllByLabelText('Nombre')[1]!, 'X')
    expect(alCambiar).toHaveBeenCalledWith([
      { nombre: 'Uno', dolor: 'Dolor uno largo', objecion: 'Objeción uno larga' },
      { nombre: 'DosX', dolor: 'Dolor dos largo', objecion: 'Objeción dos larga' },
    ])
  })

  it('con un solo público no se puede quitar', () => {
    // El esquema exige al menos uno.
    render(
      <SeccionPublicos
        valor={[{ nombre: 'Uno', dolor: 'Dolor largo', objecion: 'Objeción larga' }]}
        alCambiar={vi.fn()}
      />,
    )
    expect(screen.queryAllByRole('button', { name: /^Quitar público/ })).toHaveLength(0)
  })
})

describe('SeccionOfertas', () => {
  it('arranca vacía y se puede agregar', async () => {
    // Las ofertas son opcionales: no se le pide a nadie llenar una fila que
    // puede omitir.
    const alCambiar = vi.fn()
    render(<SeccionOfertas valor={[]} alCambiar={alCambiar} />)

    expect(screen.queryAllByLabelText('Nombre')).toHaveLength(0)
    await userEvent.click(screen.getByRole('button', { name: /^Agregar oferta/ }))
    expect(alCambiar).toHaveBeenCalledWith([{ nombre: '', descripcion: '', url: '' }])
  })
})
