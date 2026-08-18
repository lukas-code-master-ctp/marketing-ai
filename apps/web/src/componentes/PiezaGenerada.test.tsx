// @vitest-environment jsdom
import type { TipoPieza } from '@gc/strategy'
import { cleanup, render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { PiezaGenerada } from './PiezaGenerada.js'

afterEach(cleanup)
// La misma limpieza que usa EditorDePerfil.test.tsx: una prueba reemplaza
// `navigator.clipboard` con `Object.defineProperty`, y sin restaurarlo la
// propiedad propia queda puesta para las pruebas que siguen en este archivo.
afterEach(() => {
  Reflect.deleteProperty(navigator, 'clipboard')
})

const PIEZA_LINKEDIN: TipoPieza = {
  canal: 'linkedin',
  gancho: 'El error que más cuesta en una compra de parcela',
  cuerpo:
    'Muchos compradores primerizos no revisan la factibilidad antes de firmar, y ese descuido ' +
    'termina costando meses de trámites.',
  hashtags: ['parcelas', 'inversion'],
}

const PIEZA_BLOG: TipoPieza = {
  canal: 'blog',
  titulo: 'Cómo verificar la factibilidad de una parcela antes de comprar',
  bajada: 'Los tres documentos que hay que pedir antes de firmar cualquier promesa.',
  cuerpo:
    'La factibilidad sanitaria y eléctrica es el primer filtro: sin ella, ni el financiamiento ' +
    'ni la construcción son posibles.',
}

const PIEZA_INSTAGRAM_SIN_DIAPOSITIVAS: TipoPieza = {
  canal: 'instagram',
  caption: 'Tres señales de que una parcela no tiene factibilidad.',
  hashtags: ['parcelas', 'terrenos'],
  diapositivas: [],
}

describe('PiezaGenerada', () => {
  it('muestra los campos de LinkedIn, con el gancho aparte', () => {
    render(<PiezaGenerada pieza={PIEZA_LINKEDIN} />)

    // El gancho tiene su propia etiqueta, separada de la del cuerpo: son dos
    // campos distintos y no una sola masa de texto.
    const bloqueDelGancho = screen.getByText('Gancho').closest('div')!
    expect(within(bloqueDelGancho).getByText(PIEZA_LINKEDIN.gancho)).not.toBeNull()

    const bloqueDelCuerpo = screen.getByText('Cuerpo').closest('div')!
    expect(within(bloqueDelCuerpo).getByText(PIEZA_LINKEDIN.cuerpo)).not.toBeNull()

    const bloqueDeHashtags = screen.getByText('Hashtags').closest('div')!
    expect(within(bloqueDeHashtags).getByText(/parcelas/)).not.toBeNull()
    expect(within(bloqueDeHashtags).getByText(/inversion/)).not.toBeNull()
  })

  it('muestra los campos del blog', () => {
    render(<PiezaGenerada pieza={PIEZA_BLOG} />)

    const bloqueDelTitulo = screen.getByText('Título').closest('div')!
    expect(within(bloqueDelTitulo).getByText(PIEZA_BLOG.titulo)).not.toBeNull()

    const bloqueDeLaBajada = screen.getByText('Bajada').closest('div')!
    expect(within(bloqueDeLaBajada).getByText(PIEZA_BLOG.bajada)).not.toBeNull()

    const bloqueDelCuerpo = screen.getByText('Cuerpo').closest('div')!
    expect(within(bloqueDelCuerpo).getByText(PIEZA_BLOG.cuerpo)).not.toBeNull()
  })

  it('no muestra las diapositivas cuando van vacías', () => {
    render(<PiezaGenerada pieza={PIEZA_INSTAGRAM_SIN_DIAPOSITIVAS} />)

    expect(screen.queryByText('Diapositivas')).toBeNull()
  })

  it('copiar pone el texto completo en el portapapeles', async () => {
    const escribir = vi.fn((_texto: string) => Promise.resolve())
    Object.defineProperty(navigator, 'clipboard', {
      value: { writeText: escribir },
      configurable: true,
    })

    render(<PiezaGenerada pieza={PIEZA_LINKEDIN} />)
    await userEvent.click(screen.getByRole('button', { name: /Copiar/ }))

    expect(escribir).toHaveBeenCalledTimes(1)
    const copiado = escribir.mock.calls[0]![0]
    expect(copiado).toContain(PIEZA_LINKEDIN.gancho)
    expect(copiado).toContain(PIEZA_LINKEDIN.cuerpo)
  })

  it('si el portapapeles falla lo dice y el texto sigue en pantalla', async () => {
    Object.defineProperty(navigator, 'clipboard', {
      value: { writeText: () => Promise.reject(new Error('denegado')) },
      configurable: true,
    })

    render(<PiezaGenerada pieza={PIEZA_LINKEDIN} />)
    await userEvent.click(screen.getByRole('button', { name: /Copiar/ }))

    expect(screen.getByRole('alert').textContent).toMatch(/no se pudo copiar/i)
    const bloqueDelCuerpo = screen.getByText('Cuerpo').closest('div')!
    expect(within(bloqueDelCuerpo).getByText(PIEZA_LINKEDIN.cuerpo)).not.toBeNull()
  })
})
