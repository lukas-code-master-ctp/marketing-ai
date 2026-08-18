// @vitest-environment jsdom
import { cleanup, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { generarPiezasAccion } from '../acciones.js'
import { BotonGenerarPiezas } from './BotonGenerarPiezas.js'

vi.mock('../acciones.js', () => ({
  generarPiezasAccion: vi.fn(),
}))

afterEach(cleanup)
beforeEach(() => {
  vi.mocked(generarPiezasAccion).mockReset()
  vi.mocked(generarPiezasAccion).mockResolvedValue({ ok: true, datos: { encoladas: 3 } })
})

describe('BotonGenerarPiezas', () => {
  it('encola al hacer clic', async () => {
    render(<BotonGenerarPiezas marca="parcelas" mes="2026-10" />)
    await userEvent.click(screen.getByRole('button', { name: 'Generar las piezas' }))

    expect(vi.mocked(generarPiezasAccion)).toHaveBeenCalledTimes(1)
    expect(vi.mocked(generarPiezasAccion)).toHaveBeenCalledWith('parcelas', '2026-10')
  })

  // Hallazgo Importante 1 de la revisión de la Task 6: el `<form>` con Server
  // Action en línea descartaba el `Resultado`, así que un rechazo de
  // `encolarPiezas` —por ejemplo, la grilla no está aprobada— no dejaba
  // ningún rastro en pantalla. Esta prueba puede fallar: volver a ignorar
  // `resultado` (o no leer `resultado.ok`) la pone roja porque el texto deja
  // de aparecer.
  it('muestra el mensaje cuando la acción rechaza', async () => {
    vi.mocked(generarPiezasAccion).mockResolvedValue({
      ok: false,
      mensaje: 'La grilla no está aprobada.',
      reintentable: false,
    })

    render(<BotonGenerarPiezas marca="parcelas" mes="2026-10" />)
    await userEvent.click(screen.getByRole('button', { name: 'Generar las piezas' }))

    expect(screen.queryByText('La grilla no está aprobada.')).not.toBeNull()
    // Sin reintentar: el rechazo no es transitorio.
    expect(screen.queryByRole('button', { name: 'Reintentar' })).toBeNull()
  })

  it('un fallo transitorio ofrece reintentar, y el reintento vuelve a llamar', async () => {
    vi.mocked(generarPiezasAccion)
      .mockResolvedValueOnce({ ok: false, mensaje: 'La base no respondió', reintentable: true })
      .mockResolvedValueOnce({ ok: true, datos: { encoladas: 3 } })

    render(<BotonGenerarPiezas marca="parcelas" mes="2026-10" />)
    await userEvent.click(screen.getByRole('button', { name: 'Generar las piezas' }))

    expect(screen.queryByText('La base no respondió')).not.toBeNull()

    await userEvent.click(screen.getByRole('button', { name: 'Reintentar' }))
    expect(vi.mocked(generarPiezasAccion)).toHaveBeenCalledTimes(2)
  })

  // Hallazgo Importante 2 de la revisión de la Task 6: el disparador vivía en
  // un `<form>` de servidor, sin `disabled` ni `useFormStatus`, así que nada
  // impedía un segundo clic mientras la primera petición seguía en vuelo.
  // `encolarPiezas` advierte que dos peticiones que lean el mismo conjunto de
  // candidatos antes de escribir pueden duplicar todas las corridas del mes.
  // No hay `jest-dom` en este paquete: `disabled` se lee como propiedad del
  // elemento, no con `toBeDisabled` (ver el resto de `componentes/*.test.tsx`).
  it('el disparador principal queda deshabilitado mientras la operación está en vuelo', async () => {
    let resolver: (valor: { ok: true; datos: { encoladas: number } }) => void = () => {}
    vi.mocked(generarPiezasAccion).mockReturnValue(
      new Promise((resolve) => {
        resolver = resolve
      }),
    )

    render(<BotonGenerarPiezas marca="parcelas" mes="2026-10" />)
    const boton = screen.getByRole('button', { name: 'Generar las piezas' }) as HTMLButtonElement
    await userEvent.click(boton)

    expect(boton.disabled).toBe(true)

    resolver({ ok: true, datos: { encoladas: 3 } })
    await waitFor(() => expect(boton.disabled).toBe(false))
  })

  // El componente limpia `error` en el mismo tick en que marca `ocupado`
  // (igual que `BotonAprobarGrilla` y `BotonReabrirGrilla`, el patrón que
  // este componente copia): React aplica los dos `setState` en un solo
  // render, así que «Reintentar» desaparece del documento en el instante en
  // que se lo pulsa, antes de que el clic pueda repetirse sobre él. Por eso
  // no hay, más abajo, una prueba que capture a «Reintentar» con
  // `disabled=true` en pantalla — ese estado no llega a existir en el DOM.
  // Esta prueba asegura la mitad observable: tras pulsarlo, no queda ningún
  // «Reintentar» duplicado ni visible mientras la segunda llamada está en
  // vuelo, solo el botón principal (ya deshabilitado, ver la prueba de arriba).
  it('al reintentar, «Reintentar» desaparece de inmediato y no puede pulsarse dos veces', async () => {
    vi.mocked(generarPiezasAccion).mockResolvedValueOnce({
      ok: false,
      mensaje: 'La base no respondió',
      reintentable: true,
    })

    render(<BotonGenerarPiezas marca="parcelas" mes="2026-10" />)
    await userEvent.click(screen.getByRole('button', { name: 'Generar las piezas' }))

    let resolver: (valor: { ok: true; datos: { encoladas: number } }) => void = () => {}
    vi.mocked(generarPiezasAccion).mockReturnValue(
      new Promise((resolve) => {
        resolver = resolve
      }),
    )

    await userEvent.click(screen.getByRole('button', { name: 'Reintentar' }))

    // Ya no hay «Reintentar» que volver a pulsar mientras la segunda llamada
    // sigue pendiente: solo una llamada se disparó.
    expect(screen.queryByRole('button', { name: 'Reintentar' })).toBeNull()
    expect(vi.mocked(generarPiezasAccion)).toHaveBeenCalledTimes(2)

    resolver({ ok: true, datos: { encoladas: 3 } })
    await waitFor(() =>
      expect(
        (screen.getByRole('button', { name: 'Generar las piezas' }) as HTMLButtonElement)
          .disabled,
      ).toBe(false),
    )
  })
})
