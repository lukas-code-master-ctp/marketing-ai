// @vitest-environment jsdom
import { cleanup, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { guardarPerfilAction } from '../acciones.js'
import { EditorDePerfil } from './EditorDePerfil.js'

vi.mock('../acciones.js', () => ({
  guardarPerfilAction: vi.fn(async () => ({ ok: true, datos: { version: 8 } })),
}))

afterEach(cleanup)
beforeEach(() => vi.mocked(guardarPerfilAction).mockClear())

const PROPS = {
  marca: 'parcelas',
  version: 7,
  perfil: { pilares: [] },
  versiones: [{ version: 7, createdAt: new Date('2026-08-01T00:00:00Z') }],
}

describe('EditorDePerfil', () => {
  it('anuncia la versión que devolvió la acción, no la que traía de props', async () => {
    vi.mocked(guardarPerfilAction).mockResolvedValueOnce({ ok: true, datos: { version: 8 } })

    render(<EditorDePerfil {...PROPS} />)
    await userEvent.click(screen.getByRole('button', { name: 'Guardar' }))

    expect(screen.queryByText('Perfil guardado como versión 8.')).not.toBeNull()
    expect(screen.queryByText('Perfil guardado como versión 7.')).toBeNull()
  })

  it('un JSON inválido muestra el mensaje del dominio y no ofrece reintentar', async () => {
    vi.mocked(guardarPerfilAction).mockResolvedValueOnce({
      ok: false,
      mensaje: 'El texto no es JSON válido: Unexpected token',
      reintentable: false,
    })

    render(<EditorDePerfil {...PROPS} />)
    await userEvent.click(screen.getByRole('button', { name: 'Guardar' }))

    expect(screen.getByRole('alert').textContent).toContain('no es JSON válido')
    expect(screen.queryByRole('button', { name: 'Reintentar' })).toBeNull()
  })

  it('"Reintentar" vuelve a llamar con el mismo texto', async () => {
    vi.mocked(guardarPerfilAction)
      .mockResolvedValueOnce({ ok: false, mensaje: 'La base no respondió', reintentable: true })
      .mockResolvedValueOnce({ ok: true, datos: { version: 8 } })

    render(<EditorDePerfil {...PROPS} />)
    await userEvent.click(screen.getByRole('button', { name: 'Guardar' }))
    await userEvent.click(screen.getByRole('button', { name: 'Reintentar' }))

    expect(vi.mocked(guardarPerfilAction)).toHaveBeenCalledTimes(2)
    expect(vi.mocked(guardarPerfilAction).mock.calls[0]).toEqual(
      vi.mocked(guardarPerfilAction).mock.calls[1],
    )
    expect(screen.queryByText('Perfil guardado como versión 8.')).not.toBeNull()
  })
})
