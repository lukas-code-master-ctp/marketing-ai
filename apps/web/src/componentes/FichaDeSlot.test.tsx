// @vitest-environment jsdom
import type { SlotDeLaGrilla } from '@gc/operaciones'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup } from '@testing-library/react'
import { FichaDeSlot } from './FichaDeSlot.js'

afterEach(cleanup)

function slot(campos: Partial<SlotDeLaGrilla> = {}): SlotDeLaGrilla {
  return {
    id: 'slot-1',
    fecha: '2026-09-03',
    hora: '10:00',
    canal: 'instagram',
    formato: 'carrusel',
    pilar: 'educativo',
    angulo: 'Cómo elegir una parcela',
    brief: 'Un brief cualquiera con largo suficiente.',
    descartado: false,
    esDerivado: false,
    idDelPadre: null,
    ...campos,
  }
}

describe('FichaDeSlot', () => {
  it('un slot descartado se distingue visualmente de uno vigente', () => {
    const { container: vigente } = render(<FichaDeSlot slot={slot()} onSeleccionar={vi.fn()} />)
    const claseVigente = vigente.querySelector('button')!.className
    cleanup()

    const { container: descartado } = render(
      <FichaDeSlot slot={slot({ descartado: true })} onSeleccionar={vi.fn()} />,
    )
    const claseDescartada = descartado.querySelector('button')!.className

    expect(claseDescartada).not.toBe(claseVigente)
    expect(claseDescartada).toContain('line-through')
  })

  it('un derivado se marca con la flecha y el vigente no', () => {
    render(<FichaDeSlot slot={slot({ esDerivado: true })} onSeleccionar={vi.fn()} />)
    expect(screen.getByRole('button').textContent).toContain('↳')
  })

  it('al pulsarla avisa con su id y con el propio botón', async () => {
    const alSeleccionar = vi.fn()
    render(<FichaDeSlot slot={slot()} onSeleccionar={alSeleccionar} />)

    await userEvent.click(screen.getByRole('button'))

    expect(alSeleccionar).toHaveBeenCalledOnce()
    expect(alSeleccionar.mock.calls[0]![0]).toBe('slot-1')
    expect(alSeleccionar.mock.calls[0]![1]).toBe(screen.getByRole('button'))
  })
})
