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

  it('MENOR 7 — asocia la ayuda al control con aria-describedby', () => {
    render(
      <CampoDeTexto
        etiqueta="Categoría"
        ayuda="En qué categoría compite"
        ejemplo="Venta de parcelas de agrado"
        valor=""
        alCambiar={vi.fn()}
      />,
    )

    const campo = screen.getByLabelText('Categoría')
    const idAyuda = campo.getAttribute('aria-describedby')
    expect(idAyuda).not.toBeNull()
    expect(document.getElementById(idAyuda!.split(' ')[0]!)?.textContent).toBe(
      'En qué categoría compite',
    )
  })

  it('con error, lo muestra como alerta, marca aria-invalid y lo suma a aria-describedby', () => {
    render(
      <CampoDeTexto
        etiqueta="Categoría"
        ayuda="En qué categoría compite"
        ejemplo="Venta de parcelas de agrado"
        valor=""
        alCambiar={vi.fn()}
        error="Este campo es obligatorio."
      />,
    )

    const campo = screen.getByLabelText('Categoría')
    expect(campo.getAttribute('aria-invalid')).toBe('true')
    expect(screen.getByRole('alert').textContent).toBe('Este campo es obligatorio.')

    const describedBy = campo.getAttribute('aria-describedby') ?? ''
    const idError = screen.getByRole('alert').id
    expect(describedBy.split(' ')).toContain(idError)
  })

  it('sin error, no marca aria-invalid ni muestra alerta', () => {
    render(
      <CampoDeTexto
        etiqueta="Categoría"
        ayuda="En qué categoría compite"
        ejemplo="Venta de parcelas de agrado"
        valor="Algo"
        alCambiar={vi.fn()}
      />,
    )

    expect(screen.getByLabelText('Categoría').getAttribute('aria-invalid')).toBeNull()
    expect(screen.queryByRole('alert')).toBeNull()
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

  it('MENOR 6 — quitar una fila devuelve el foco al botón de agregar', async () => {
    render(
      <ListaDeTextos
        etiqueta="Diferenciadores"
        ayuda="En qué es distinta"
        ejemplo="Factibilidad verificada"
        valores={['Uno', 'Dos', 'Tres']}
        alCambiar={vi.fn()}
      />,
    )

    await userEvent.click(screen.getAllByRole('button', { name: /^Quitar/ })[1]!)

    expect(document.activeElement).toBe(
      screen.getByRole('button', { name: 'Agregar diferenciadores' }),
    )
  })

  it('con error, lo muestra como alerta asociada a cada fila', () => {
    render(
      <ListaDeTextos
        etiqueta="Atributos"
        ayuda="Cómo suena la marca"
        ejemplo="claro"
        valores={['']}
        alCambiar={vi.fn()}
        minimo={1}
        error="Agrega al menos un atributo."
      />,
    )

    expect(screen.getByRole('alert').textContent).toBe('Agrega al menos un atributo.')
    expect(screen.getByLabelText('Atributos 1').getAttribute('aria-invalid')).toBe('true')
  })
})
