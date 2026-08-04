// @vitest-environment jsdom
import { cleanup, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { encolarEstrategiaAccion, encolarGrillaAccion } from '../acciones.js'
import { BotonGenerar } from './BotonGenerar.js'

// Solo las dos que el componente importa. Sin implementación en el factory: en
// vitest 2.1 `mockReset` la borraría y dejaría el mock devolviendo `undefined`,
// así que la respuesta por omisión vive en el `beforeEach` y en un solo lugar.
vi.mock('../acciones.js', () => ({
  encolarGrillaAccion: vi.fn(),
  encolarEstrategiaAccion: vi.fn(),
}))

afterEach(cleanup)
beforeEach(() => {
  for (const accion of [encolarGrillaAccion, encolarEstrategiaAccion]) {
    vi.mocked(accion).mockReset()
    vi.mocked(accion).mockResolvedValue({ ok: true, datos: null })
  }
})

describe('BotonGenerar', () => {
  it('sin advertencia encola al primer clic', async () => {
    render(
      <BotonGenerar marca="parcelas" periodo="2026-10" que="grilla" etiqueta="Generar grilla" />,
    )
    await userEvent.click(screen.getByRole('button', { name: 'Generar grilla' }))

    expect(vi.mocked(encolarGrillaAccion)).toHaveBeenCalledTimes(1)
    expect(vi.mocked(encolarGrillaAccion)).toHaveBeenCalledWith('parcelas', '2026-10')
  })

  it('con advertencia no encola hasta que se confirma, y la muestra', async () => {
    render(
      <BotonGenerar
        marca="parcelas"
        periodo="2026-10"
        que="grilla"
        etiqueta="Regenerar grilla"
        advertencia="Regenerar reemplaza los slots y pierdes los descartes."
      />,
    )

    await userEvent.click(screen.getByRole('button', { name: 'Regenerar grilla' }))
    expect(vi.mocked(encolarGrillaAccion)).not.toHaveBeenCalled()
    expect(screen.queryByText(/pierdes los descartes/)).not.toBeNull()

    await userEvent.click(screen.getByRole('button', { name: 'Sí, generar' }))
    expect(vi.mocked(encolarGrillaAccion)).toHaveBeenCalledTimes(1)
  })

  it('cancelar no encola', async () => {
    render(
      <BotonGenerar
        marca="parcelas"
        periodo="2026-10"
        que="grilla"
        etiqueta="Regenerar grilla"
        advertencia="Regenerar reemplaza los slots."
      />,
    )
    await userEvent.click(screen.getByRole('button', { name: 'Regenerar grilla' }))
    await userEvent.click(screen.getByRole('button', { name: 'Cancelar' }))

    expect(vi.mocked(encolarGrillaAccion)).not.toHaveBeenCalled()
    expect(screen.queryByRole('button', { name: 'Regenerar grilla' })).not.toBeNull()
  })

  it('el flujo de estrategia llama a la acción de estrategia y no a la de grilla', async () => {
    render(
      <BotonGenerar
        marca="parcelas"
        periodo="2026-Q4"
        que="estrategia"
        etiqueta="Generar estrategia"
      />,
    )
    await userEvent.click(screen.getByRole('button', { name: 'Generar estrategia' }))

    expect(vi.mocked(encolarEstrategiaAccion)).toHaveBeenCalledWith('parcelas', '2026-Q4')
    expect(vi.mocked(encolarGrillaAccion)).not.toHaveBeenCalled()
  })
})
