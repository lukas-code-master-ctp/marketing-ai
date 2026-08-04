// @vitest-environment jsdom
import { cleanup, render, screen } from '@testing-library/react'
import type { ReactNode } from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { SelectorDeMarca } from './selector-de-marca.js'

/**
 * Va en su propio archivo y no en `paginas.test.tsx` porque este componente
 * necesita `usePathname` sustituido por ruta, y ahí `next/navigation` está
 * sustituido con `redirect` y `notFound` que lanzan. El nombre del archivo no
 * lleva corchetes, así que el `include` de vitest sí lo encuentra —lo que no
 * pasa con las pruebas de pantalla, que por eso viven todas juntas.
 */
const { rutaActual } = vi.hoisted(() => ({ rutaActual: vi.fn() }))
vi.mock('next/navigation', () => ({ usePathname: () => rutaActual() as string }))
// El resto de las props se propaga: `aria-current` es una de las cosas que
// este componente decide, y un sustituto que la tirara la volvería inafirmable.
vi.mock('next/link', () => ({
  default: ({ children, href, ...resto }: { children: ReactNode; href: string }) => (
    <a href={href} {...resto}>
      {children}
    </a>
  ),
}))

afterEach(() => {
  cleanup()
  vi.useRealTimers()
})
beforeEach(() => {
  rutaActual.mockReset()
})

const MARCAS = [
  { id: 'm-1', slug: 'parcelas', name: 'CTP' },
  { id: 'm-2', slug: 'otra', name: 'Otra' },
]

function hrefDe(nombre: string): string {
  return screen.getByRole('link', { name: nombre }).getAttribute('href')!
}

describe('SelectorDeMarca', () => {
  /**
   * `/{slug}` pelado no existe: no hay `app/[marca]/page.tsx`, así que
   * responde 404. Era inalcanzable hasta que `?nueva` puso la ruta `/` en el
   * camino feliz —es la pantalla desde la que se crea una marca— y dejó todos
   * los enlaces del encabezado apuntando a una página que no existe.
   */
  it('desde / los enlaces apuntan a la grilla del mes actual, no a /{slug}', () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-11-15T00:00:00Z'))
    rutaActual.mockReturnValue('/')

    render(<SelectorDeMarca marcas={MARCAS} />)

    expect(hrefDe('CTP')).toBe('/parcelas/grilla/2026-11')
    expect(hrefDe('Otra')).toBe('/otra/grilla/2026-11')
  })

  it('desde /?nueva pasa lo mismo: la ruta que ve el componente sigue siendo /', () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-11-15T00:00:00Z'))
    // `usePathname` no incluye la query, que es justo por lo que el escape
    // `?nueva` cae en esta rama sin parecerlo.
    rutaActual.mockReturnValue('/')

    render(<SelectorDeMarca marcas={MARCAS} />)

    expect(hrefDe('CTP')).toBe('/parcelas/grilla/2026-11')
  })

  // El control positivo: si el enlace cayera siempre a la grilla del mes de
  // hoy, la prueba de arriba pasaría igual y se perdería lo que este selector
  // hace de verdad, que es conservar la sección y el mes al cambiar de marca.
  it('desde una sección conserva la sección y el mes', () => {
    // El reloj se fija en otro mes a propósito: con el mes de hoy, un enlace
    // que ignorara la ruta y cayera siempre a la grilla del mes actual daría
    // el mismo href y esta prueba pasaría sin afirmar nada.
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-11-15T00:00:00Z'))
    rutaActual.mockReturnValue('/parcelas/grilla/2026-08')

    render(<SelectorDeMarca marcas={MARCAS} />)

    expect(hrefDe('Otra')).toBe('/otra/grilla/2026-08')
  })

  it('desde el perfil conserva el perfil', () => {
    rutaActual.mockReturnValue('/parcelas/perfil')

    render(<SelectorDeMarca marcas={MARCAS} />)

    expect(hrefDe('Otra')).toBe('/otra/perfil')
  })

  it('marca como activa solo la marca de la ruta', () => {
    rutaActual.mockReturnValue('/parcelas/perfil')

    render(<SelectorDeMarca marcas={MARCAS} />)

    expect(screen.getByRole('link', { name: 'CTP' }).getAttribute('aria-current')).toBe('page')
    expect(screen.getByRole('link', { name: 'Otra' }).getAttribute('aria-current')).toBeNull()
  })
})
