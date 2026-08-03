// @vitest-environment jsdom
import type { SlotDeLaGrilla } from '@gc/operaciones'
import { cleanup, render, within } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { semanasDelMes } from '../calendario.js'
import { RejillaDelMes } from './RejillaDelMes.js'

// Los componentes de cliente importan las Server Actions. Sustituirlas evita
// arrastrar la base y el 'use server' a una prueba que mide renderizado.
// Solo las dos que el árbol bajo prueba importa: RejillaDelMes monta
// PanelDeDetalle, y ese es todo el consumo de acciones que hay aquí. Declarar
// de más obliga a mantener firmas que esta prueba no ejercita.
vi.mock('../acciones.js', () => ({
  descartarSlotAccion: vi.fn(async () => ({ ok: true, datos: null })),
  editarSlotAccion: vi.fn(async () => ({ ok: true, datos: null })),
}))

afterEach(cleanup)

function slot(id: string, fecha: string, campos: Partial<SlotDeLaGrilla> = {}): SlotDeLaGrilla {
  return {
    id,
    fecha,
    hora: '10:00',
    canal: 'instagram',
    formato: 'carrusel',
    pilar: 'educativo',
    angulo: `Ángulo de ${id}`,
    brief: 'Un brief cualquiera con largo suficiente.',
    descartado: false,
    esDerivado: false,
    idDelPadre: null,
    ...campos,
  }
}

/**
 * La celda del día `fecha`. Se busca por `data-fecha` y no por `screen`
 * entero: preguntarle al documento si un texto está "en alguna parte" deja
 * pasar una rejilla que pinte todas las fichas en la misma celda.
 */
function celda(contenedor: HTMLElement, fecha: string): HTMLElement {
  const elemento = contenedor.querySelector<HTMLElement>(`[data-fecha="${fecha}"]`)
  if (!elemento) throw new Error(`La rejilla no renderizó una celda para ${fecha}`)
  return elemento
}

describe('RejillaDelMes', () => {
  it('cada slot del mes aparece en la celda de su fecha, incluidos los descartados', () => {
    const slots = [
      slot('a', '2026-09-01'),
      slot('b', '2026-09-15'),
      slot('c', '2026-09-30', { descartado: true }),
    ]

    const { container } = render(
      <RejillaDelMes
        marca="parcelas"
        mes="2026-09"
        estado="borrador"
        semanas={semanasDelMes('2026-09')}
        slots={slots}
      />,
    )

    for (const s of slots) {
      expect(within(celda(container, s.fecha)).queryByText(s.angulo)).not.toBeNull()
    }
  })

  it('ningún slot se cuela en una celda que no es la suya', () => {
    const slots = [slot('a', '2026-09-01'), slot('b', '2026-09-15')]

    const { container } = render(
      <RejillaDelMes
        marca="parcelas"
        mes="2026-09"
        estado="borrador"
        semanas={semanasDelMes('2026-09')}
        slots={slots}
      />,
    )

    // `Array.from` y no un spread: el `lib` de este paquete no trae
    // `DOM.Iterable`, así que un `NodeListOf` no es iterable para tsc.
    const celdas = Array.from(container.querySelectorAll<HTMLElement>('[data-fecha]'))
    expect(celdas.length).toBe(semanasDelMes('2026-09').flat().length)

    for (const s of slots) {
      for (const c of celdas) {
        const encontrado = within(c).queryByText(s.angulo)
        if (c.dataset['fecha'] === s.fecha) expect(encontrado).not.toBeNull()
        else expect(encontrado).toBeNull()
      }
    }
  })

  it('un slot en un día de relleno del mes vecino también aparece', () => {
    // 2026-09-01 es martes, así que la primera semana arrastra el lunes 31 de
    // agosto: un slot ahí cae en una celda renderizada y debe verse.
    const semanas = semanasDelMes('2026-09')
    expect(semanas[0]![0]).toBe('2026-08-31')

    const { container } = render(
      <RejillaDelMes
        marca="parcelas"
        mes="2026-09"
        estado="borrador"
        semanas={semanas}
        slots={[slot('vecino', '2026-08-31')]}
      />,
    )

    expect(within(celda(container, '2026-08-31')).queryByText('Ángulo de vecino')).not.toBeNull()
  })

  it('un slot fuera de las semanas renderizadas se muestra aparte y no desaparece', () => {
    const { container } = render(
      <RejillaDelMes
        marca="parcelas"
        mes="2026-09"
        estado="borrador"
        semanas={semanasDelMes('2026-09')}
        slots={[slot('dentro', '2026-09-10'), slot('fuera', '2026-11-15')]}
      />,
    )

    // "No desaparece": el slot cuya fecha no cae en ninguna celda sigue en el
    // documento, y el que sí cae sigue exactamente donde estaba —la sección
    // nueva no puede cobrarse la rejilla.
    expect(within(celda(container, '2026-09-10')).queryByText('Ángulo de dentro')).not.toBeNull()
    expect(within(container).queryByText('Ángulo de fuera')).not.toBeNull()

    // "Aparte": y no en una celda cualquiera. Preguntarle solo al documento si
    // el texto está en alguna parte dejaría pasar una rejilla que lo pintara
    // en el día equivocado, que es la mitad que este nombre promete.
    for (const c of Array.from(container.querySelectorAll<HTMLElement>('[data-fecha]'))) {
      expect(within(c).queryByText('Ángulo de fuera')).toBeNull()
    }

    const encabezado = within(container).getByText(/fuera de 2026-09/i)
    const aviso = encabezado.closest('section')
    if (!aviso) throw new Error('El aviso de slots fuera de la rejilla no vive en una <section>')
    expect(within(aviso).queryByText('Ángulo de fuera')).not.toBeNull()
    // Y dice qué fecha es, que es lo único que explica por qué no está arriba.
    expect(within(aviso).queryByText('2026-11-15')).not.toBeNull()
  })

  it('no muestra la sección de "fuera de la rejilla" cuando todos los slots caen dentro del mes', () => {
    // Guarda el `> 0` del componente: con `>= 0` la sección aparecería
    // siempre, con un aviso ámbar falso de "0 publicaciones caen fuera de
    // 2026-09" en cada mes sano. Sin esta prueba esa mutación pasa las 35
    // pruebas de `apps/web` sin que ninguna se dé cuenta.
    const { container } = render(
      <RejillaDelMes
        marca="parcelas"
        mes="2026-09"
        estado="borrador"
        semanas={semanasDelMes('2026-09')}
        slots={[slot('a', '2026-09-01'), slot('b', '2026-09-15')]}
      />,
    )

    expect(container.querySelector('section')).toBeNull()
    expect(within(container).queryByText(/fuera de 2026-09/i)).toBeNull()
  })

  it('el encabezado de "fuera de la rejilla" usa el plural cuando hay más de un slot', () => {
    // Guarda la rama plural del ternario singular/plural: invertirlo deja
    // pasar "1 publicación cae fuera de" con dos slots fuera, y la prueba
    // del singular (arriba, con un solo slot) no lo detecta porque su regex
    // solo pide que el texto contenga "fuera de 2026-09", cierto en ambas
    // ramas.
    const { container } = render(
      <RejillaDelMes
        marca="parcelas"
        mes="2026-09"
        estado="borrador"
        semanas={semanasDelMes('2026-09')}
        slots={[slot('fuera1', '2026-11-15'), slot('fuera2', '2026-12-01')]}
      />,
    )

    expect(
      within(container).getByText('2 publicaciones caen fuera de 2026-09'),
    ).not.toBeNull()
    expect(within(container).queryByText(/^1 publicación cae fuera de/)).toBeNull()
  })
})
