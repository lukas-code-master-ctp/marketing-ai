// @vitest-environment jsdom
import type { CorridaEnCurso, GrillaDelMes } from '@gc/operaciones'
import type { LecturaDeEstrategia } from '@gc/strategy'
import { cleanup, render, screen } from '@testing-library/react'
import type { ReactNode } from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { corridaDe, estrategiaDelTrimestre, grillaDelMes } from '@gc/operaciones'
import PaginaDeEstrategia from './app/[marca]/estrategia/page.js'
import PaginaDeGrilla from './app/[marca]/grilla/[mes]/page.js'

/**
 * Las dos pantallas son componentes de servidor: se invocan como funciones y
 * se renderiza el árbol que devuelven. Los componentes de cliente que hay
 * dentro se comportan como componentes normales aquí, que es justo lo que hace
 * falta para preguntarle a la pantalla si el botón está o no.
 *
 * Lo único que se sustituye es lo que toca la base. `@gc/operaciones/senales`
 * queda **sin** sustituir a propósito: `corridaViva` es la decisión que estas
 * pruebas afirman, y sustituirla las dejaría sin poder fallar.
 */
vi.mock('@gc/operaciones', () => ({
  corridaDe: vi.fn(),
  grillaDelMes: vi.fn(),
  estrategiaDelTrimestre: vi.fn(),
}))
vi.mock('./datos.js', () => ({
  conexion: () => ({}),
  organizacionPorDefecto: vi.fn(),
}))

// Las Server Actions no se ejercitan aquí: estas pruebas preguntan por lo que
// se renderiza. Sin implementación en el factory por lo de siempre en vitest
// 2.1, pero tampoco hace falta ninguna: nadie las llama.
vi.mock('./acciones.js', () => ({
  encolarGrillaAccion: vi.fn(),
  encolarEstrategiaAccion: vi.fn(),
  reanudarCorridaAccion: vi.fn(),
  aprobarGrillaAccion: vi.fn(),
  reabrirGrillaAccion: vi.fn(),
  descartarSlotAccion: vi.fn(),
  editarSlotAccion: vi.fn(),
}))

vi.mock('next/navigation', () => ({
  useRouter: () => ({ refresh: vi.fn() }),
  notFound: () => {
    throw new Error('notFound')
  },
}))
vi.mock('next/link', () => ({
  default: ({ children, href }: { children: ReactNode; href: string }) => (
    <a href={href}>{children}</a>
  ),
}))

afterEach(cleanup)
beforeEach(() => {
  vi.mocked(corridaDe).mockReset()
  vi.mocked(grillaDelMes).mockReset()
  vi.mocked(estrategiaDelTrimestre).mockReset()
  vi.mocked(corridaDe).mockResolvedValue(null)
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

function grilla(campos: Partial<GrillaDelMes> = {}): GrillaDelMes {
  return { contentPlanId: null, estado: null, slots: [], porCanal: {}, problemas: [], ...campos }
}

const ESTRATEGIA_EN_BORRADOR: LecturaDeEstrategia = {
  tipo: 'ok',
  periodo: '2026-Q4',
  id: 'estrategia-1',
  estado: 'borrador',
  estrategia: {
    objetivos: [{ nombre: 'Alcance', metrica: 'impresiones', meta: '10k' }],
    mensajesClave: ['Un mensaje suficientemente largo', 'Otro mensaje igual de largo'],
    mixDeCanales: [{ canal: 'instagram', publicacionesPorSemana: 3 }],
    reciclaje: [],
    temasPrioritarios: ['parcelas'],
  },
}

async function renderGrilla(mes = '2026-10') {
  render(await PaginaDeGrilla({ params: Promise.resolve({ marca: 'parcelas', mes }) }))
}

async function renderEstrategia() {
  render(await PaginaDeEstrategia({ params: Promise.resolve({ marca: 'parcelas' }) }))
}

// Encolar dos veces cuesta dos llamadas al modelo. El `disabled` local del
// botón dura los milisegundos de la Server Action, y después vuelve a estar
// disponible porque el estado de la grilla o de la estrategia no cambia hasta
// que el worker persiste: la única guarda posible es no renderizarlo.
describe('el botón de generar mientras hay una corrida viva', () => {
  it('no aparece en la grilla de un mes sin grilla', async () => {
    vi.mocked(grillaDelMes).mockResolvedValue(grilla())
    vi.mocked(corridaDe).mockResolvedValue(corrida({ estado: 'pendiente' }))

    await renderGrilla()

    expect(screen.queryByRole('button', { name: 'Generar grilla' })).toBeNull()
    // El control positivo va en la prueba de al lado, pero además se afirma
    // aquí que la pantalla sí se renderizó: sin esto, un `render` que devuelve
    // vacío por cualquier motivo pasaría igual.
    expect(screen.queryByText(/todavía no tiene grilla/i)).not.toBeNull()
  })

  it('sí aparece en la grilla de un mes sin grilla cuando no hay corrida', async () => {
    vi.mocked(grillaDelMes).mockResolvedValue(grilla())
    vi.mocked(corridaDe).mockResolvedValue(null)

    await renderGrilla()

    expect(screen.queryByRole('button', { name: 'Generar grilla' })).not.toBeNull()
  })

  it('no aparece el de regenerar sobre una grilla en borrador con una corrida en curso', async () => {
    vi.mocked(grillaDelMes).mockResolvedValue(grilla({ estado: 'borrador', contentPlanId: 'plan-1' }))
    vi.mocked(corridaDe).mockResolvedValue(corrida({ estado: 'en_curso' }))

    await renderGrilla()

    expect(screen.queryByRole('button', { name: 'Regenerar grilla' })).toBeNull()
    // Aprobar no depende de que haya una corrida en vuelo y sigue ahí: es lo
    // que distingue "se ocultó el botón correcto" de "se ocultó el bloque".
    expect(screen.queryByRole('button', { name: /aprobar/i })).not.toBeNull()
  })

  it('sí aparece el de regenerar sobre una grilla en borrador sin corrida', async () => {
    vi.mocked(grillaDelMes).mockResolvedValue(grilla({ estado: 'borrador', contentPlanId: 'plan-1' }))
    vi.mocked(corridaDe).mockResolvedValue(null)

    await renderGrilla()

    expect(screen.queryByRole('button', { name: 'Regenerar grilla' })).not.toBeNull()
  })

  // Una corrida que ya terminó no bloquea nada: si bloqueara, la pantalla
  // quedaría sin botón para siempre después de la primera generación.
  it('vuelve a aparecer cuando la corrida terminó', async () => {
    vi.mocked(grillaDelMes).mockResolvedValue(grilla())
    vi.mocked(corridaDe).mockResolvedValue(corrida({ estado: 'completado' }))

    await renderGrilla()

    expect(screen.queryByRole('button', { name: 'Generar grilla' })).not.toBeNull()
  })

  it('no aparece en la estrategia ausente de un trimestre', async () => {
    vi.mocked(estrategiaDelTrimestre).mockResolvedValue({ tipo: 'ausente', periodo: '2026-Q4' })
    vi.mocked(corridaDe).mockResolvedValue(corrida({ flow: 'p1_estrategia', estado: 'pendiente' }))

    await renderEstrategia()

    expect(screen.queryByRole('button', { name: 'Generar estrategia' })).toBeNull()
    expect(screen.queryByText(/no tiene estrategia cargada/i)).not.toBeNull()
  })

  it('sí aparece en la estrategia ausente cuando no hay corrida', async () => {
    vi.mocked(estrategiaDelTrimestre).mockResolvedValue({ tipo: 'ausente', periodo: '2026-Q4' })
    vi.mocked(corridaDe).mockResolvedValue(null)

    await renderEstrategia()

    expect(screen.queryByRole('button', { name: 'Generar estrategia' })).not.toBeNull()
  })

  it('no aparece el de regenerar sobre una estrategia en borrador con una corrida en curso', async () => {
    vi.mocked(estrategiaDelTrimestre).mockResolvedValue(ESTRATEGIA_EN_BORRADOR)
    vi.mocked(corridaDe).mockResolvedValue(corrida({ flow: 'p1_estrategia', estado: 'en_curso' }))

    await renderEstrategia()

    expect(screen.queryByRole('button', { name: 'Regenerar estrategia' })).toBeNull()
    expect(screen.queryByText(/mensajes clave/i)).not.toBeNull()
  })

  it('sí aparece el de regenerar sobre una estrategia en borrador sin corrida', async () => {
    vi.mocked(estrategiaDelTrimestre).mockResolvedValue(ESTRATEGIA_EN_BORRADOR)
    vi.mocked(corridaDe).mockResolvedValue(null)

    await renderEstrategia()

    expect(screen.queryByRole('button', { name: 'Regenerar estrategia' })).not.toBeNull()
  })

  // La rama de estrategia inválida explica por qué no se puede regenerar. Con
  // una corrida en vuelo ese motivo sería el equivocado —el estado sí es
  // borrador— así que no se muestra ni el botón ni la explicación.
  it('sobre una estrategia inválida en borrador no muestra el botón ni el motivo equivocado', async () => {
    vi.mocked(estrategiaDelTrimestre).mockResolvedValue({
      tipo: 'invalida', periodo: '2026-Q4', id: 'estrategia-1', estado: 'borrador',
    })
    vi.mocked(corridaDe).mockResolvedValue(corrida({ flow: 'p1_estrategia', estado: 'en_curso' }))

    await renderEstrategia()

    expect(screen.queryByRole('button', { name: 'Regenerar estrategia' })).toBeNull()
    expect(screen.queryByText(/solo regenera una que esté en borrador/i)).toBeNull()
    expect(screen.queryByText(/no valida contra su esquema/i)).not.toBeNull()
  })
})
