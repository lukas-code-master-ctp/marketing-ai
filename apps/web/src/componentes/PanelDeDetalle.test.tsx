// @vitest-environment jsdom
import type { SlotDeLaGrilla } from '@gc/operaciones'
import { cleanup, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { descartarSlotAccion, editarSlotAccion } from '../acciones.js'
import { semanasDelMes } from '../calendario.js'
import { RejillaDelMes } from './RejillaDelMes.js'

// Solo las dos que el árbol bajo prueba importa: RejillaDelMes monta
// PanelDeDetalle, y ese es todo el consumo de acciones que hay aquí. Declarar
// de más obliga a mantener firmas que esta prueba no ejercita.
// Sin implementación: la respuesta por omisión se pone en el `beforeEach`, que
// es el único lugar donde puede vivir (ver abajo).
vi.mock('../acciones.js', () => ({
  descartarSlotAccion: vi.fn(),
  editarSlotAccion: vi.fn(),
}))

afterEach(cleanup)
// `mockReset` y no `mockClear`, y las dos acciones y no solo una: `mockClear`
// borra el registro de llamadas pero deja en pie la cola de
// `mockResolvedValueOnce`. Una respuesta que una prueba encole y no consuma se
// filtraría a la siguiente, y el fallo apuntaría a la prueba equivocada.
//
// El precio es que en vitest 2.1 `mockReset` deja el mock devolviendo
// `undefined` —no la implementación que le dio el factory: eso llegó en
// vitest 3—, así que la respuesta por omisión se vuelve a poner aquí. Por eso
// el factory no la declara: un solo lugar que la defina.
beforeEach(() => {
  for (const accion of [descartarSlotAccion, editarSlotAccion]) {
    vi.mocked(accion).mockReset()
    vi.mocked(accion).mockResolvedValue({ ok: true, datos: null })
  }
})

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

  // Un slot sin derivados no distingue `descartar(false)` de `descartar(true)`:
  // las dos emiten la misma llamada. Por eso esta prueba solo afirma que
  // "Reintentar" repite el intento, y la que sigue —con un derivado vigente—
  // es la que afirma que no lo degrada.
  it('"Reintentar" repite el descarte que falló', async () => {
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

  it('"Reintentar" no degrada el descarte: repite también los derivados', async () => {
    const derivado: SlotDeLaGrilla = {
      ...SLOT,
      id: 'slot-2',
      fecha: '2026-09-10',
      canal: 'linkedin',
      angulo: 'La misma idea, en otro canal',
      esDerivado: true,
      idDelPadre: SLOT.id,
    }

    // Solo el primer intento falla. Los dos descartes de la segunda tanda usan
    // la respuesta por omisión del mock, así que si esta prueba se pone roja
    // por un `resultado` indefinido, el que se rompió es el `beforeEach`.
    vi.mocked(descartarSlotAccion).mockResolvedValueOnce({
      ok: false,
      mensaje: 'La base no respondió',
      reintentable: true,
    })

    montar([SLOT, derivado])
    await userEvent.click(screen.getByText(SLOT.angulo).closest('button')!)
    await userEvent.click(screen.getByRole('button', { name: 'Descartar' }))
    await userEvent.click(screen.getByRole('button', { name: 'Descartar también los 1' }))

    expect(screen.queryByText('La base no respondió')).not.toBeNull()

    await userEvent.click(screen.getByRole('button', { name: 'Reintentar' }))

    // El derivado tiene que estar en la segunda tanda: sin él, "Reintentar"
    // habría degradado el "también los derivados" que el usuario ya pidió.
    expect(vi.mocked(descartarSlotAccion).mock.calls).toEqual([
      ['parcelas', '2026-09', 'slot-1'],
      ['parcelas', '2026-09', 'slot-1'],
      ['parcelas', '2026-09', 'slot-2'],
    ])
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
