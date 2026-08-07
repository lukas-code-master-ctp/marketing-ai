// @vitest-environment jsdom
import { cleanup, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { CampoDeTexto, ListaDeTextos } from './campos.js'

afterEach(cleanup)

describe('CampoDeTexto', () => {
  it('muestra la etiqueta, la ayuda y el ejemplo, y avisa cada cambio', async () => {
    const alCambiar = vi.fn()
    render(
      <CampoDeTexto
        etiqueta="Categoría"
        ayuda="En qué categoría compite"
        ejemplo="Venta de parcelas de agrado"
        valor=""
        alCambiar={alCambiar}
      />,
    )

    expect(screen.queryByText('En qué categoría compite')).not.toBeNull()
    expect(screen.queryByText(/Venta de parcelas de agrado/)).not.toBeNull()

    await userEvent.type(screen.getByLabelText('Categoría'), 'A')
    expect(alCambiar).toHaveBeenCalledWith('A')
  })
})

describe('ListaDeTextos', () => {
  it('agregar suma una fila vacía', async () => {
    const alCambiar = vi.fn()
    render(
      <ListaDeTextos
        etiqueta="Diferenciadores"
        ayuda="En qué es distinta"
        ejemplo="Factibilidad verificada"
        valores={['Uno']}
        alCambiar={alCambiar}
      />,
    )

    await userEvent.click(screen.getByRole('button', { name: 'Agregar diferenciadores' }))
    expect(alCambiar).toHaveBeenCalledWith(['Uno', ''])
  })

  it('quitar saca la fila que corresponde y no otra', async () => {
    // La aserción importa: con `toHaveBeenCalled` a secas, un botón que
    // siempre quitara el primero pasaría igual.
    const alCambiar = vi.fn()
    render(
      <ListaDeTextos
        etiqueta="Diferenciadores"
        ayuda="En qué es distinta"
        ejemplo="Factibilidad verificada"
        valores={['Uno', 'Dos', 'Tres']}
        alCambiar={alCambiar}
      />,
    )

    await userEvent.click(screen.getAllByRole('button', { name: /^Quitar/ })[1]!)
    expect(alCambiar).toHaveBeenCalledWith(['Uno', 'Tres'])
  })

  it('con el mínimo alcanzado no se puede quitar', () => {
    // Es propiedad del control, no una copia de una regla del esquema:
    // borrar el último dejaría un formulario que no se puede guardar.
    render(
      <ListaDeTextos
        etiqueta="Atributos"
        ayuda="Cómo suena la marca"
        ejemplo="claro"
        valores={['claro']}
        alCambiar={vi.fn()}
        minimo={1}
      />,
    )

    expect(screen.queryAllByRole('button', { name: /^Quitar/ })).toHaveLength(0)
  })
})
