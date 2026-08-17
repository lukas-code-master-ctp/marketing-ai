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
    segundosSinSenal: 3,
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

  // El comando que esta pantalla manda a correr **no siempre levanta el
  // worker**: sin `OPENROUTER_API_KEY` ni `IA_EN_SECO=true`, el contenedor
  // arranca, falla y queda en `Exited (1)`. El navegador no se entera, así que
  // sin esta segunda línea el panel repite «levántalo con docker compose up -d»
  // para siempre a quien ya lo hizo — y es el único modo de falla nuevo que
  // introduce tener un worker aparte.
  it('dice qué mirar cuando el worker no arranca por falta de credenciales', () => {
    render(
      <EstadoDeCorrida corrida={corrida({ encoladaHace: 45 })} ruta="/parcelas/grilla/2026-10" />,
    )
    expect(screen.queryByText(/docker compose logs worker/)).not.toBeNull()
    expect(screen.queryByText(/sin la clave del modelo/i)).not.toBeNull()
  })

  // El número crudo («en 3600 segundos») es de máquina. `describirAntiguedad`
  // ya resolvía esto en el dominio y no estaba exportada.
  it('dice la espera en palabras y no en segundos crudos', () => {
    render(
      <EstadoDeCorrida corrida={corrida({ encoladaHace: 3600 })} ruta="/parcelas/grilla/2026-10" />,
    )
    expect(screen.queryByText(/nadie tomó esta generación en 60 minutos/i)).not.toBeNull()
    expect(screen.queryByText(/3600/)).toBeNull()
  })

  // Si el worker muere a mitad, la fila queda `en_curso` para siempre:
  // `tomarCorridaPendiente` solo levanta las `pendiente`, así que ni
  // reiniciarlo la rescata. Sin este panel el único remedio es la terminal.
  // El umbral y los segundos son los del dominio, así que el botón aparece
  // exactamente cuando `reanudarCorridaEncolada` lo va a aceptar.
  it('una en_curso sin señal por más del umbral dice que se interrumpió y ofrece reanudar', async () => {
    render(
      <EstadoDeCorrida
        corrida={corrida({
          estado: 'en_curso',
          pasoActual: 'proponer_grilla',
          encoladaHace: 3_600,
          segundosSinSenal: 1_200,
        })}
        ruta="/parcelas/grilla/2026-10"
      />,
    )

    expect(screen.queryByText(/parece haberse interrumpido/i)).not.toBeNull()
    expect(screen.queryByText(/no da señales desde hace 20 minutos/i)).not.toBeNull()
    // No es lo mismo que "falló": la corrida no dio ningún error.
    expect(screen.queryByText(/la generación falló/i)).toBeNull()

    await userEvent.click(screen.getByRole('button', { name: 'Reanudar' }))

    expect(vi.mocked(reanudarCorridaAccion)).toHaveBeenCalledTimes(1)
    expect(vi.mocked(reanudarCorridaAccion)).toHaveBeenCalledWith('/parcelas/grilla/2026-10', 'run-1')
  })

  // El otro lado del umbral, que es el que importa: una corrida que el worker
  // está ejecutando ahora mismo no debe ofrecer reanudar. Reanudarla la
  // devuelve a la cola con el worker todavía adentro, y los dos pagan el paso.
  it('una en_curso que dio señales hace poco sigue anunciando su paso y no ofrece reanudar', () => {
    render(
      <EstadoDeCorrida
        corrida={corrida({
          estado: 'en_curso',
          pasoActual: 'proponer_grilla',
          encoladaHace: 3_600,
          segundosSinSenal: 60,
        })}
        ruta="/parcelas/grilla/2026-10"
      />,
    )

    expect(screen.queryByText(/proponiendo la grilla/i)).not.toBeNull()
    expect(screen.queryByRole('button', { name: 'Reanudar' })).toBeNull()
    expect(screen.queryByText(/parece haberse interrumpido/i)).toBeNull()
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

  it('el panel de generando dice cuánto lleva, con minutos y segundos', () => {
    // 252 segundos son los 4,2 minutos que tardó la primera grilla real. El
    // texto se afirma completo a propósito: `/4/` calzaría con cualquier cosa
    // —incluido un periodo como 2026-Q4— y este repositorio ya pagó cuatro
    // veces una aserción que parecía verificar el lugar correcto.
    render(
      <EstadoDeCorrida
        corrida={corrida({ estado: 'en_curso', pasoActual: 'proponer_grilla', encoladaHace: 252 })}
        ruta="/parcelas/grilla/2026-10"
      />,
    )
    expect(screen.queryByText(/proponiendo la grilla… \(4 min 12 s\)/i)).not.toBeNull()
  })

  it('bajo el minuto dice solo segundos', () => {
    render(
      <EstadoDeCorrida
        corrida={corrida({ estado: 'en_curso', pasoActual: 'generar_estrategia', encoladaHace: 9 })}
        ruta="/parcelas/estrategia"
      />,
    )
    expect(screen.queryByText(/generando la estrategia… \(9 s\)/i)).not.toBeNull()
  })

  it('en cola también dice cuánto lleva', () => {
    render(<EstadoDeCorrida corrida={corrida({ encoladaHace: 12 })} ruta="/parcelas/estrategia" />)
    expect(screen.queryByText(/en cola… \(12 s\)/i)).not.toBeNull()
  })

  it('el panel de interrumpida sigue redondeando a minutos, sin segundos', () => {
    // Los dos formateadores conviven en el mismo componente. Si alguien
    // reemplaza el de allá por el nuevo, este texto pasa a decir
    // «15 min 1 s» y esta prueba lo dice.
    render(
      <EstadoDeCorrida
        corrida={corrida({ estado: 'en_curso', pasoActual: 'proponer_grilla', segundosSinSenal: 901 })}
        ruta="/parcelas/grilla/2026-10"
      />,
    )
    expect(screen.queryByText(/15 minutos/)).not.toBeNull()
    expect(screen.queryByText(/15 min 1 s/)).toBeNull()
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
