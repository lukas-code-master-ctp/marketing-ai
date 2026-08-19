// @vitest-environment jsdom
import type { EleccionDeNivel, ModeloDelCatalogo } from '@gc/operaciones'
import { cleanup, render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { guardarModeloAccion } from '../acciones.js'
import { SelectorDeModelo } from './SelectorDeModelo.js'

vi.mock('../acciones.js', () => ({
  guardarModeloAccion: vi.fn(),
}))

afterEach(cleanup)
beforeEach(() => {
  vi.mocked(guardarModeloAccion).mockReset()
  vi.mocked(guardarModeloAccion).mockResolvedValue({ ok: true, datos: undefined })
})

function modelo(campos: Partial<ModeloDelCatalogo> = {}): ModeloDelCatalogo {
  return {
    id: 'modelo-1',
    nivel: 'razonamiento',
    modelId: 'proveedor/modelo-1',
    etiqueta: 'Modelo Uno',
    descripcion: 'Un modelo cualquiera',
    precioEntradaUsd: 1.5,
    precioSalidaUsd: 4.5,
    ...campos,
  }
}

describe('SelectorDeModelo', () => {
  // Renderiza dos instancias, una por nivel, porque el componente en sí
  // representa un único bloque (`page.tsx` arma uno por nivel presente en el
  // catálogo, ver el brief). Afirmar "un bloque por nivel" acá es afirmar que
  // cada instancia muestra su propio bloque con su propia explicación, y que
  // las dos conviven sin pisarse.
  it('muestra un bloque por nivel, con su explicación en palabras del usuario', () => {
    const candidatos = [
      modelo({ id: 'razonamiento-1', nivel: 'razonamiento', etiqueta: 'Razonador' }),
      modelo({ id: 'redaccion-1', nivel: 'redaccion', etiqueta: 'Redactor' }),
    ]

    render(
      <>
        <SelectorDeModelo
          nivel="razonamiento"
          explicacion="Decide la estrategia del trimestre y arma la grilla del mes."
          candidatos={candidatos}
          eleccion={null}
        />
        <SelectorDeModelo
          nivel="redaccion"
          explicacion="Escribe el texto de cada pieza."
          candidatos={candidatos}
          eleccion={null}
        />
      </>,
    )

    const bloqueDeRazonamiento = screen.getByRole('region', { name: /razonamiento/i })
    const bloqueDeRedaccion = screen.getByRole('region', { name: /redacción|redaccion/i })

    expect(
      within(bloqueDeRazonamiento).queryByText(
        'Decide la estrategia del trimestre y arma la grilla del mes.',
      ),
    ).not.toBeNull()
    expect(
      within(bloqueDeRedaccion).queryByText('Escribe el texto de cada pieza.'),
    ).not.toBeNull()
    // Ninguno de los dos textos se filtra al bloque del otro nivel.
    expect(
      within(bloqueDeRazonamiento).queryByText('Escribe el texto de cada pieza.'),
    ).toBeNull()
    expect(
      within(bloqueDeRedaccion).queryByText(
        'Decide la estrategia del trimestre y arma la grilla del mes.',
      ),
    ).toBeNull()
  })

  // El componente recibe el catálogo completo (de todos los niveles) y filtra
  // por su propio `nivel` prop: es lo que hace observable, en aislamiento, un
  // error de "ofrecer el catálogo entero" sin tener que pasar por `page.tsx`.
  it('el selector de un nivel solo ofrece candidatos de ese nivel', () => {
    const candidatos = [
      modelo({ id: 'razonamiento-1', nivel: 'razonamiento', etiqueta: 'Razonador Uno' }),
      modelo({ id: 'razonamiento-2', nivel: 'razonamiento', etiqueta: 'Razonador Dos' }),
      modelo({ id: 'redaccion-1', nivel: 'redaccion', etiqueta: 'Redactor Uno' }),
    ]

    render(
      <SelectorDeModelo
        nivel="razonamiento"
        explicacion="Decide la estrategia del trimestre y arma la grilla del mes."
        candidatos={candidatos}
        eleccion={null}
      />,
    )

    const bloque = screen.getByRole('region', { name: /razonamiento/i })
    const selectorPrincipal = within(bloque).getByLabelText('Modelo principal')

    expect(within(selectorPrincipal).queryByText(/Razonador Uno/)).not.toBeNull()
    expect(within(selectorPrincipal).queryByText(/Razonador Dos/)).not.toBeNull()
    expect(within(selectorPrincipal).queryByText(/Redactor Uno/)).toBeNull()
  })

  it('cada opción muestra su etiqueta y su precio', () => {
    const candidatos = [
      modelo({
        id: 'razonamiento-1',
        nivel: 'razonamiento',
        etiqueta: 'Razonador Uno',
        precioEntradaUsd: 2.5,
        precioSalidaUsd: 10,
      }),
    ]

    render(
      <SelectorDeModelo
        nivel="razonamiento"
        explicacion="Decide la estrategia del trimestre y arma la grilla del mes."
        candidatos={candidatos}
        eleccion={null}
      />,
    )

    const bloque = screen.getByRole('region', { name: /razonamiento/i })
    // Dos selectores —principal y respaldo— listan los mismos candidatos, así
    // que hay dos opciones con este texto: se acota al principal para que
    // `getByText` no falle por encontrar más de una.
    const selectorPrincipal = within(bloque).getByLabelText('Modelo principal')
    const opcion = within(selectorPrincipal).getByText(/Razonador Uno/)

    expect(opcion.textContent).toMatch(/Razonador Uno/)
    expect(opcion.textContent).toMatch(/2[.,]5/)
    expect(opcion.textContent).toMatch(/10/)
  })

  it('guardar deshabilita el botón mientras la acción viaja', async () => {
    let resolver: (valor: { ok: true; datos: undefined }) => void = () => {}
    vi.mocked(guardarModeloAccion).mockReturnValue(
      new Promise((resolve) => {
        resolver = resolve
      }),
    )

    const candidatos = [modelo({ id: 'razonamiento-1', nivel: 'razonamiento' })]
    const eleccion: EleccionDeNivel = {
      nivel: 'razonamiento',
      principal: candidatos[0]!,
      respaldo: null,
    }

    render(
      <SelectorDeModelo
        nivel="razonamiento"
        explicacion="Decide la estrategia del trimestre y arma la grilla del mes."
        candidatos={candidatos}
        eleccion={eleccion}
      />,
    )

    const bloque = screen.getByRole('region', { name: /razonamiento/i })
    const boton = within(bloque).getByRole('button', { name: 'Guardar' }) as HTMLButtonElement
    await userEvent.click(boton)

    expect(boton.disabled).toBe(true)

    resolver({ ok: true, datos: undefined })
    await vi.waitFor(() => expect(boton.disabled).toBe(false))
  })

  // Nada en las pruebas de arriba afirma sobre los argumentos que
  // `SelectorDeModelo` le manda a `guardarModeloAccion`: cubren filtrado,
  // precios, el botón deshabilitado y el mensaje de error, pero no que el
  // principal y el respaldo elegidos lleguen en el orden correcto.
  // Intercambiarlos en la llamada invertiría en silencio qué modelo se paga
  // primero, y ninguna de las otras cinco pruebas se pondría roja.
  it('guardar manda el nivel, el principal y el respaldo elegidos, en ese orden', async () => {
    const candidatos = [
      modelo({ id: 'razonamiento-1', nivel: 'razonamiento', etiqueta: 'Razonador Uno' }),
      modelo({ id: 'razonamiento-2', nivel: 'razonamiento', etiqueta: 'Razonador Dos' }),
      modelo({ id: 'razonamiento-3', nivel: 'razonamiento', etiqueta: 'Razonador Tres' }),
    ]
    const eleccion: EleccionDeNivel = {
      nivel: 'razonamiento',
      principal: candidatos[0]!,
      respaldo: candidatos[1]!,
    }

    render(
      <SelectorDeModelo
        nivel="razonamiento"
        explicacion="Decide la estrategia del trimestre y arma la grilla del mes."
        candidatos={candidatos}
        eleccion={eleccion}
      />,
    )

    const bloque = screen.getByRole('region', { name: /razonamiento/i })
    const selectorPrincipal = within(bloque).getByLabelText('Modelo principal') as HTMLSelectElement
    const selectorRespaldo = within(bloque).getByLabelText('Modelo de respaldo (opcional)') as HTMLSelectElement

    // Se elige una opción distinta de la inicial en los DOS selectores: con
    // una sola cambiada, un intercambio de argumentos podría pasar por
    // casualidad si el valor que no cambió coincidiera en las dos posiciones.
    await userEvent.selectOptions(selectorPrincipal, 'razonamiento-3')
    await userEvent.selectOptions(selectorRespaldo, 'razonamiento-1')

    await userEvent.click(within(bloque).getByRole('button', { name: 'Guardar' }))

    expect(guardarModeloAccion).toHaveBeenCalledWith('razonamiento', 'razonamiento-3', 'razonamiento-1')
  })

  it('si la acción rechaza, el mensaje se ve', async () => {
    vi.mocked(guardarModeloAccion).mockResolvedValue({
      ok: false,
      mensaje: 'La base no respondió',
      reintentable: true,
    })

    const candidatos = [modelo({ id: 'razonamiento-1', nivel: 'razonamiento' })]
    const eleccion: EleccionDeNivel = {
      nivel: 'razonamiento',
      principal: candidatos[0]!,
      respaldo: null,
    }

    render(
      <SelectorDeModelo
        nivel="razonamiento"
        explicacion="Decide la estrategia del trimestre y arma la grilla del mes."
        candidatos={candidatos}
        eleccion={eleccion}
      />,
    )

    const bloque = screen.getByRole('region', { name: /razonamiento/i })
    await userEvent.click(within(bloque).getByRole('button', { name: 'Guardar' }))

    expect(within(bloque).queryByText('La base no respondió')).not.toBeNull()
  })

  // Menor 11 de la revisión de rama: el botón se rehabilitaba y no pasaba
  // nada más. Con los dos selectores mostrando lo que ya se eligió, no había
  // ninguna señal de que la escritura ocurrió.
  it('guardar con éxito muestra un mensaje de confirmación', async () => {
    const candidatos = [modelo({ id: 'razonamiento-1', nivel: 'razonamiento' })]
    const eleccion: EleccionDeNivel = {
      nivel: 'razonamiento',
      principal: candidatos[0]!,
      respaldo: null,
    }

    render(
      <SelectorDeModelo
        nivel="razonamiento"
        explicacion="Decide la estrategia del trimestre y arma la grilla del mes."
        candidatos={candidatos}
        eleccion={eleccion}
      />,
    )

    const bloque = screen.getByRole('region', { name: /razonamiento/i })
    expect(within(bloque).queryByText('Modelo guardado.')).toBeNull()

    await userEvent.click(within(bloque).getByRole('button', { name: 'Guardar' }))

    expect(within(bloque).queryByText('Modelo guardado.')).not.toBeNull()
  })

  it('cambiar la elección después de guardar oculta el mensaje de confirmación', async () => {
    const candidatos = [
      modelo({ id: 'razonamiento-1', nivel: 'razonamiento', etiqueta: 'Razonador Uno' }),
      modelo({ id: 'razonamiento-2', nivel: 'razonamiento', etiqueta: 'Razonador Dos' }),
    ]
    const eleccion: EleccionDeNivel = {
      nivel: 'razonamiento',
      principal: candidatos[0]!,
      respaldo: null,
    }

    render(
      <SelectorDeModelo
        nivel="razonamiento"
        explicacion="Decide la estrategia del trimestre y arma la grilla del mes."
        candidatos={candidatos}
        eleccion={eleccion}
      />,
    )

    const bloque = screen.getByRole('region', { name: /razonamiento/i })
    await userEvent.click(within(bloque).getByRole('button', { name: 'Guardar' }))
    expect(within(bloque).queryByText('Modelo guardado.')).not.toBeNull()

    const selectorPrincipal = within(bloque).getByLabelText('Modelo principal')
    await userEvent.selectOptions(selectorPrincipal, 'razonamiento-2')

    expect(within(bloque).queryByText('Modelo guardado.')).toBeNull()
  })
})
