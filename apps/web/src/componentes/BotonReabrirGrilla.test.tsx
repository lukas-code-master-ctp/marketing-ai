// @vitest-environment jsdom
import { cleanup, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { reabrirGrillaAccion } from '../acciones.js'
import { BotonReabrirGrilla } from './BotonReabrirGrilla.js'

vi.mock('../acciones.js', () => ({
  reabrirGrillaAccion: vi.fn(async () => ({ ok: true, datos: null })),
}))

afterEach(cleanup)
beforeEach(() => vi.mocked(reabrirGrillaAccion).mockClear())

describe('BotonReabrirGrilla', () => {
  it('no reabre hasta que se confirma', async () => {
    render(<BotonReabrirGrilla marca="parcelas" mes="2026-09" piezasEscritas={0} />)

    await userEvent.click(screen.getByRole('button', { name: 'Reabrir grilla' }))
    expect(vi.mocked(reabrirGrillaAccion)).not.toHaveBeenCalled()

    await userEvent.click(screen.getByRole('button', { name: 'Sí, reabrir' }))
    // `toHaveBeenCalledExactlyOnceWith` no existe en vitest 2.1 (llegó en 3.x);
    // las dos aserciones de abajo son su equivalente: exactamente una llamada,
    // y con estos argumentos.
    expect(vi.mocked(reabrirGrillaAccion)).toHaveBeenCalledTimes(1)
    expect(vi.mocked(reabrirGrillaAccion)).toHaveBeenCalledWith('parcelas', '2026-09')
  })

  it('cancelar no reabre', async () => {
    render(<BotonReabrirGrilla marca="parcelas" mes="2026-09" piezasEscritas={0} />)

    await userEvent.click(screen.getByRole('button', { name: 'Reabrir grilla' }))
    await userEvent.click(screen.getByRole('button', { name: 'Cancelar' }))

    expect(vi.mocked(reabrirGrillaAccion)).not.toHaveBeenCalled()
    expect(screen.queryByRole('button', { name: 'Reabrir grilla' })).not.toBeNull()
  })

  it('un fallo transitorio ofrece reintentar y repite la misma llamada', async () => {
    vi.mocked(reabrirGrillaAccion)
      .mockResolvedValueOnce({ ok: false, mensaje: 'La base no respondió', reintentable: true })
      .mockResolvedValueOnce({ ok: true, datos: null })

    render(<BotonReabrirGrilla marca="parcelas" mes="2026-09" piezasEscritas={0} />)
    await userEvent.click(screen.getByRole('button', { name: 'Reabrir grilla' }))
    await userEvent.click(screen.getByRole('button', { name: 'Sí, reabrir' }))

    expect(screen.queryByText('La base no respondió')).not.toBeNull()

    await userEvent.click(screen.getByRole('button', { name: 'Reintentar' }))
    expect(vi.mocked(reabrirGrillaAccion)).toHaveBeenCalledTimes(2)
  })

  // Crítico 2 de la revisión de la rama: reabrir no borra nada, pero deja
  // la puerta abierta a "Regenerar grilla", que sí lo hace — por el
  // `ON DELETE CASCADE` de la migración `0008`. Quien reabre con piezas ya
  // escritas tiene que enterarse de eso antes de confirmar, no después.
  it('sin piezas escritas no promete borrar nada', async () => {
    render(<BotonReabrirGrilla marca="parcelas" mes="2026-09" piezasEscritas={0} />)

    await userEvent.click(screen.getByRole('button', { name: 'Reabrir grilla' }))

    expect(screen.queryByText(/piezas que ya escribiste/)).toBeNull()
    expect(screen.queryByText(/pieza que ya escribiste/)).toBeNull()
  })

  it('con una pieza escrita, avisa en singular que se borra', async () => {
    render(<BotonReabrirGrilla marca="parcelas" mes="2026-09" piezasEscritas={1} />)

    await userEvent.click(screen.getByRole('button', { name: 'Reabrir grilla' }))

    expect(screen.queryByText(/y borra la pieza que ya escribiste/)).not.toBeNull()
    expect(screen.queryByText(/1 piezas/)).toBeNull()
  })

  it('con veinte piezas escritas, avisa cuántas se borran y que se paga otra vez', async () => {
    render(<BotonReabrirGrilla marca="parcelas" mes="2026-09" piezasEscritas={20} />)

    await userEvent.click(screen.getByRole('button', { name: 'Reabrir grilla' }))

    expect(
      screen.queryByText(/y borra las 20 piezas que ya escribiste, que volver a generar paga otra vez/),
    ).not.toBeNull()
  })
})
