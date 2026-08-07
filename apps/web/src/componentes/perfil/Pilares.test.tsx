// @vitest-environment jsdom
import { useState } from 'react'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { SeccionPilares } from './Pilares.js'
import type { PilarEnFormulario } from './conversion.js'

afterEach(cleanup)

/**
 * Envoltorio con estado real: a diferencia de `alCambiar={vi.fn()}`, acá el
 * cambio sí vuelve a `SeccionPilares` como prop nueva. Es lo único que puede
 * reproducir el defecto de la fila que no se remonta al quitar una del medio
 * —con un mock, el padre nunca vuelve a renderizar con datos distintos.
 */
function EnvoltorioConEstado({ inicial }: { inicial: PilarEnFormulario[] }) {
  const [pilares, setPilares] = useState(inicial)
  return <SeccionPilares valor={pilares} alCambiar={setPilares} />
}

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

  it('al quitar el pilar del medio, la fila que queda en su lugar muestra su propio nombre', async () => {
    const tres = [
      { nombre: 'primero', descripcion: 'Uno', porcentaje: 34 },
      { nombre: 'segundo', descripcion: 'Dos', porcentaje: 33 },
      { nombre: 'tercero', descripcion: 'Tres', porcentaje: 33 },
    ]
    render(<EnvoltorioConEstado inicial={tres} />)

    await userEvent.click(screen.getAllByRole('button', { name: /^Quitar pilar/ })[1]!)

    // Quitar el "segundo" (índice 1) corre al "tercero" a esa posición. Con
    // `key={indice}` y sin sincronizar el eco local, esa fila quedaría
    // mostrando "segundo" en el campo de nombre en vez de "tercero".
    const nombresRestantes = screen.getAllByLabelText<HTMLInputElement>('Nombre del pilar')
    expect(nombresRestantes).toHaveLength(2)
    expect(nombresRestantes[0]!.value).toBe('primero')
    expect(nombresRestantes[1]!.value).toBe('tercero')
  })

  it('quitar un pilar devuelve el foco al botón de agregar', async () => {
    const tres = [
      { nombre: 'primero', descripcion: 'Uno', porcentaje: 34 },
      { nombre: 'segundo', descripcion: 'Dos', porcentaje: 33 },
      { nombre: 'tercero', descripcion: 'Tres', porcentaje: 33 },
    ]
    render(<EnvoltorioConEstado inicial={tres} />)

    await userEvent.click(screen.getAllByRole('button', { name: /^Quitar pilar/ })[1]!)

    expect(document.activeElement).toBe(screen.getByRole('button', { name: 'Agregar pilar' }))
  })

  describe('IMPORTANTE 3a — el formulario vacío no saluda con errores', () => {
    const DOS_VACIOS = [
      { nombre: '', descripcion: '', porcentaje: 50 },
      { nombre: '', descripcion: '', porcentaje: 50 },
    ]

    it('sin mostrarObligatorios, dos pilares vacíos no muestran ninguna alerta', () => {
      render(<SeccionPilares valor={DOS_VACIOS} alCambiar={vi.fn()} />)
      expect(screen.queryAllByRole('alert')).toHaveLength(0)
    })

    it('con mostrarObligatorios, un pilar vacío nunca avisa que el nombre "no puede empezar con letra"', () => {
      // Distingue el aviso de 3a (nombre ESCRITO pero inconvertible) del de
      // 3b (campo vacío, otro mensaje): un campo vacío jamás debe mostrar
      // "El nombre tiene que empezar con una letra.", aunque sí puede
      // mostrar "Este campo es obligatorio." una vez que se intentó guardar.
      render(<SeccionPilares valor={DOS_VACIOS} alCambiar={vi.fn()} mostrarObligatorios />)
      const alertas = screen.getAllByRole('alert').map((a) => a.textContent ?? '')
      expect(alertas.some((t) => /empezar con una letra/i.test(t))).toBe(false)
    })
  })

  describe('IMPORTANTE 4 — el porcentaje se redondea a un entero entre 0 y 100', () => {
    it('el input declara min, max y step de entero', () => {
      render(<SeccionPilares valor={DOS} alCambiar={vi.fn()} />)
      const campo = screen.getAllByLabelText('Porcentaje')[0]!
      expect(campo.getAttribute('min')).toBe('0')
      expect(campo.getAttribute('max')).toBe('100')
      expect(campo.getAttribute('step')).toBe('1')
    })

    it('escribir un decimal deja guardado un entero redondeado', () => {
      const alCambiar = vi.fn()
      render(<SeccionPilares valor={DOS} alCambiar={alCambiar} />)
      const campo = screen.getAllByLabelText('Porcentaje')[0]!

      fireEvent.change(campo, { target: { value: '33.7' } })

      expect(alCambiar).toHaveBeenCalledWith([{ ...DOS[0]!, porcentaje: 34 }, DOS[1]])
    })

    it('tres pilares con decimales nunca dejan el total en notación científica', () => {
      // Antes del arreglo, 33.3 + 33.3 + 33.4 en coma flotante da
      // 100.00000000000001 y el total se muestra así. Con el redondeo en
      // `onChange`, los decimales nunca entran al estado, así que el total
      // siempre es una suma de enteros.
      const tres = [
        { nombre: 'a', descripcion: 'x', porcentaje: 33 },
        { nombre: 'b', descripcion: 'y', porcentaje: 33 },
        { nombre: 'c', descripcion: 'z', porcentaje: 33 },
      ]
      render(<EnvoltorioConEstado inicial={tres} />)

      const campos = screen.getAllByLabelText<HTMLInputElement>('Porcentaje')
      fireEvent.change(campos[2]!, { target: { value: '33.4' } })

      expect(campos[2]!.value).toBe('33')
      const total = screen.getByTestId('total-de-pilares')
      expect(total.textContent).not.toMatch(/e[-+]?\d/i)
      expect(total.textContent).toContain('99')
    })
  })
})
