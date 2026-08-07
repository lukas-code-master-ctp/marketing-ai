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

  it('quitar un público devuelve el foco al botón de agregar', async () => {
    render(
      <SeccionPublicos
        valor={[
          { nombre: 'Uno', dolor: 'Dolor uno largo', objecion: 'Objeción uno larga' },
          { nombre: 'Dos', dolor: 'Dolor dos largo', objecion: 'Objeción dos larga' },
        ]}
        alCambiar={vi.fn()}
      />,
    )

    await userEvent.click(screen.getAllByRole('button', { name: /^Quitar público/ })[0]!)

    expect(document.activeElement).toBe(screen.getByRole('button', { name: /^Agregar público/ }))
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

  it('quitar una oferta devuelve el foco al botón de agregar', async () => {
    render(
      <SeccionOfertas
        valor={[
          { nombre: 'Uno', descripcion: 'Desc uno', url: '' },
          { nombre: 'Dos', descripcion: 'Desc dos', url: '' },
        ]}
        alCambiar={vi.fn()}
      />,
    )

    await userEvent.click(screen.getAllByRole('button', { name: /^Quitar oferta/ })[0]!)

    expect(document.activeElement).toBe(screen.getByRole('button', { name: /^Agregar oferta/ }))
  })
})

describe('MENOR 5 — nombre accesible por fila', () => {
  it('cada público queda agrupado en un fieldset con su propio nombre', () => {
    // Sin `fieldset`/`legend`, un lector de pantalla anuncia "Nombre, Dolor,
    // Objeción, Nombre, Dolor, Objeción…" sin decir a cuál público
    // pertenece cada campo.
    render(
      <SeccionPublicos
        valor={[
          { nombre: 'Uno', dolor: 'Dolor uno largo', objecion: 'Objeción uno larga' },
          { nombre: 'Dos', dolor: 'Dolor dos largo', objecion: 'Objeción dos larga' },
        ]}
        alCambiar={vi.fn()}
      />,
    )

    expect(screen.getByRole('group', { name: 'Público 1' })).not.toBeNull()
    expect(screen.getByRole('group', { name: 'Público 2' })).not.toBeNull()
  })

  it('cada oferta queda agrupada en un fieldset con su propio nombre', () => {
    render(
      <SeccionOfertas
        valor={[{ nombre: 'Tour', descripcion: 'Visita al terreno', url: '' }]}
        alCambiar={vi.fn()}
      />,
    )

    expect(screen.getByRole('group', { name: 'Oferta 1' })).not.toBeNull()
  })
})

describe('IMPORTANTE 3b — marcar los campos obligatorios vacíos al intentar guardar', () => {
  it('sin mostrarObligatorios, el formulario vacío no marca nada', () => {
    render(
      <SeccionPosicionamiento
        valor={{ categoria: '', promesa: '', diferenciadores: [''] }}
        alCambiar={vi.fn()}
      />,
    )
    expect(screen.queryAllByRole('alert')).toHaveLength(0)
  })

  it('con mostrarObligatorios y campos vacíos, marca categoría y promesa', () => {
    render(
      <SeccionPosicionamiento
        valor={{ categoria: '', promesa: '', diferenciadores: [''] }}
        alCambiar={vi.fn()}
        mostrarObligatorios
      />,
    )
    expect(screen.getByLabelText('Categoría').getAttribute('aria-invalid')).toBe('true')
    expect(screen.getByLabelText('Promesa').getAttribute('aria-invalid')).toBe('true')
  })

  it('con mostrarObligatorios y campos llenos, no marca nada', () => {
    render(
      <SeccionPosicionamiento
        valor={{ categoria: 'Algo', promesa: 'Una promesa larga', diferenciadores: ['Uno'] }}
        alCambiar={vi.fn()}
        mostrarObligatorios
      />,
    )
    expect(screen.queryAllByRole('alert')).toHaveLength(0)
  })

  it('con mostrarObligatorios, un público completo evita marcar los demás campos', () => {
    // Solo se exige AL MENOS un público completo, no todos.
    render(
      <SeccionPublicos
        valor={[
          { nombre: 'Uno', dolor: 'Dolor uno largo', objecion: 'Objeción uno larga' },
          { nombre: '', dolor: '', objecion: '' },
        ]}
        alCambiar={vi.fn()}
        mostrarObligatorios
      />,
    )
    expect(screen.queryAllByRole('alert')).toHaveLength(0)
  })

  it('con mostrarObligatorios y ningún público completo, marca los campos vacíos', () => {
    render(
      <SeccionPublicos
        valor={[{ nombre: '', dolor: '', objecion: '' }]}
        alCambiar={vi.fn()}
        mostrarObligatorios
      />,
    )
    expect(screen.getByLabelText('Nombre').getAttribute('aria-invalid')).toBe('true')
    expect(screen.getByLabelText('Dolor').getAttribute('aria-invalid')).toBe('true')
    expect(screen.getByLabelText('Objeción').getAttribute('aria-invalid')).toBe('true')
  })
})
