// @vitest-environment jsdom
import type { SlotDeLaGrilla } from '@gc/operaciones'
import { cleanup, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { descartarSlotAccion } from '../acciones.js'
import { semanasDelMes } from '../calendario.js'
import { RejillaDelMes } from './RejillaDelMes.js'

// Solo las dos que el árbol bajo prueba importa: RejillaDelMes monta
// PanelDeDetalle, y ese es todo el consumo de acciones que hay aquí. Declarar
// de más obliga a mantener firmas que esta prueba no ejercita.
vi.mock('../acciones.js', () => ({
  descartarSlotAccion: vi.fn(async () => ({ ok: true, datos: null })),
  editarSlotAccion: vi.fn(async () => ({ ok: true, datos: null })),
}))

afterEach(cleanup)
beforeEach(() => vi.mocked(descartarSlotAccion).mockClear())

const SLOT: SlotDeLaGrilla = {
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
}

function montar(slots: SlotDeLaGrilla[] = [SLOT]) {
  return render(
    <RejillaDelMes
      marca="parcelas"
      mes="2026-09"
      estado="borrador"
      semanas={semanasDelMes('2026-09')}
      slots={slots}
    />,
  )
}

describe('PanelDeDetalle a través de la rejilla', () => {
  it('el foco entra al diálogo al abrirlo y vuelve a la ficha al cerrarlo', async () => {
    montar()
    const ficha = screen.getByText(SLOT.angulo).closest('button')!

    await userEvent.click(ficha)
    const dialogo = screen.getByRole('dialog')
    expect(document.activeElement).toBe(dialogo)

    await userEvent.click(screen.getByLabelText('Cerrar'))
    expect(screen.queryByRole('dialog')).toBeNull()
    expect(document.activeElement).toBe(ficha)
  })

  it('Escape cierra el diálogo y devuelve el foco', async () => {
    montar()
    const ficha = screen.getByText(SLOT.angulo).closest('button')!

    await userEvent.click(ficha)
    await userEvent.keyboard('{Escape}')

    expect(screen.queryByRole('dialog')).toBeNull()
    expect(document.activeElement).toBe(ficha)
  })

  it('"Reintentar" repite el descarte que falló, sin degradarlo', async () => {
    // Primer intento transitorio, segundo exitoso.
    vi.mocked(descartarSlotAccion)
      .mockResolvedValueOnce({ ok: false, mensaje: 'La base no respondió', reintentable: true })
      .mockResolvedValueOnce({ ok: true, datos: null })

    montar()
    await userEvent.click(screen.getByText(SLOT.angulo).closest('button')!)
    await userEvent.click(screen.getByRole('button', { name: 'Descartar' }))

    expect(screen.queryByText('La base no respondió')).not.toBeNull()

    await userEvent.click(screen.getByRole('button', { name: 'Reintentar' }))

    expect(vi.mocked(descartarSlotAccion)).toHaveBeenCalledTimes(2)
    expect(vi.mocked(descartarSlotAccion).mock.calls[1]).toEqual(['parcelas', '2026-09', 'slot-1'])
  })

  it('un error no reintentable no ofrece reintentar', async () => {
    vi.mocked(descartarSlotAccion).mockResolvedValueOnce({
      ok: false,
      mensaje: 'La grilla de 2026-09 está en estado "aprobada"',
      reintentable: false,
    })

    montar()
    await userEvent.click(screen.getByText(SLOT.angulo).closest('button')!)
    await userEvent.click(screen.getByRole('button', { name: 'Descartar' }))

    expect(screen.queryByText(/está en estado "aprobada"/)).not.toBeNull()
    expect(screen.queryByRole('button', { name: 'Reintentar' })).toBeNull()
  })
})
