// @vitest-environment jsdom
import type { CorridaEnCurso } from '@gc/operaciones'
import { act, cleanup, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { reanudarCorridaAccion } from '../acciones.js'
import { EstadoDeCorrida } from './EstadoDeCorrida.js'

// Sin implementación: la respuesta por omisión se pone en el `beforeEach`,
// porque en vitest 2.1 `mockReset` deja el mock devolviendo `undefined` en vez
// de restaurar la del factory (eso llegó en vitest 3).
vi.mock('../acciones.js', () => ({ reanudarCorridaAccion: vi.fn() }))

// El enrutador es **el mismo objeto** en todos los renders, como el de Next:
// si `useRouter` devolviera uno nuevo cada vez, el `useEffect` que depende de
// él se reiniciaría en cada render y el intervalo nunca llegaría a cumplirse.
// Además hace falta para poder afirmar sobre `refresh`: con un `vi.fn()` recién
// creado en cada llamada no queda nada que inspeccionar.
// `vi.hoisted` porque `vi.mock` se iza por encima de las declaraciones.
const { enrutador } = vi.hoisted(() => ({ enrutador: { refresh: vi.fn() } }))
vi.mock('next/navigation', () => ({ useRouter: () => enrutador }))

afterEach(cleanup)
beforeEach(() => {
  vi.mocked(reanudarCorridaAccion).mockReset()
  vi.mocked(reanudarCorridaAccion).mockResolvedValue({ ok: true, datos: null })
  enrutador.refresh.mockReset()
})

function corrida(campos: Partial<CorridaEnCurso> = {}): CorridaEnCurso {
  return {
    id: 'run-1',
    flow: 'p2_grilla',
    estado: 'pendiente',
    error: null,
    pasoActual: null,
    encoladaHace: 3,
    ...campos,
  }
}

describe('EstadoDeCorrida', () => {
  it('una corrida recién encolada dice que está en cola', () => {
    render(<EstadoDeCorrida corrida={corrida()} ruta="/parcelas/grilla/2026-10" />)
    expect(screen.queryByText(/en cola/i)).not.toBeNull()
    expect(screen.queryByText(/worker/i)).toBeNull()
  })

  it('una pendiente vieja avisa que nadie la tomó y nombra el worker', () => {
    render(
      <EstadoDeCorrida corrida={corrida({ encoladaHace: 45 })} ruta="/parcelas/grilla/2026-10" />,
    )
    expect(screen.queryByText(/nadie tom/i)).not.toBeNull()
    expect(screen.queryByText(/docker compose up -d/)).not.toBeNull()
  })

  it('traduce el nombre de máquina del paso en curso', () => {
    render(
      <EstadoDeCorrida
        corrida={corrida({ estado: 'en_curso', pasoActual: 'proponer_grilla' })}
        ruta="/parcelas/grilla/2026-10"
      />,
    )
    expect(screen.queryByText(/proponiendo la grilla/i)).not.toBeNull()
    expect(screen.queryByText('proponer_grilla')).toBeNull()
  })

  it('un paso desconocido se muestra tal cual en vez de romper', () => {
    render(
      <EstadoDeCorrida
        corrida={corrida({ estado: 'en_curso', pasoActual: 'paso_del_futuro' })}
        ruta="/parcelas/grilla/2026-10"
      />,
    )
    expect(screen.queryByText(/paso_del_futuro/)).not.toBeNull()
  })

  it('una corrida fallida muestra su error y ofrece reanudar con su id', async () => {
    render(
      <EstadoDeCorrida
        corrida={corrida({ estado: 'fallido', error: 'La base no respondió' })}
        ruta="/parcelas/grilla/2026-10"
      />,
    )
    expect(screen.queryByText('La base no respondió')).not.toBeNull()

    await userEvent.click(screen.getByRole('button', { name: 'Reanudar' }))

    // `toHaveBeenCalledExactlyOnceWith` no existe en vitest 2.1: las dos
    // aserciones juntas son su equivalente.
    expect(vi.mocked(reanudarCorridaAccion)).toHaveBeenCalledTimes(1)
    expect(vi.mocked(reanudarCorridaAccion)).toHaveBeenCalledWith(
      '/parcelas/grilla/2026-10',
      'run-1',
    )
  })

  it('una corrida completada no se muestra', () => {
    const { container } = render(
      <EstadoDeCorrida corrida={corrida({ estado: 'completado' })} ruta="/parcelas/grilla/2026-10" />,
    )
    expect(container.textContent).toBe('')
  })

  // Las dos mitades importan por igual, y la segunda es la que se descubre
  // semanas después: un intervalo que nadie limpia sigue pidiendo renders del
  // servidor para siempre, sobre una corrida que ya terminó.
  it('refresca sola mientras la corrida está viva y deja de hacerlo cuando deja de estarlo', () => {
    vi.useFakeTimers()
    try {
      const { rerender } = render(
        <EstadoDeCorrida
          corrida={corrida({ estado: 'en_curso', pasoActual: 'proponer_grilla' })}
          ruta="/parcelas/grilla/2026-10"
        />,
      )

      expect(enrutador.refresh).not.toHaveBeenCalled()
      act(() => void vi.advanceTimersByTime(6000))
      expect(enrutador.refresh).toHaveBeenCalledTimes(3)

      rerender(
        <EstadoDeCorrida
          corrida={corrida({ estado: 'completado' })}
          ruta="/parcelas/grilla/2026-10"
        />,
      )

      act(() => void vi.advanceTimersByTime(60_000))
      expect(enrutador.refresh).toHaveBeenCalledTimes(3)
    } finally {
      vi.useRealTimers()
    }
  })
})
