// @vitest-environment jsdom
import type {
  CorridaEnCurso,
  GrillaDelMes,
  LecturaDeEncargo,
  ResumenDePiezas,
  SlotDeLaGrilla,
} from '@gc/operaciones'
import type { LecturaDeEstrategia } from '@gc/strategy'
import { cleanup, render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import type { ReactNode } from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  corridaDe,
  estrategiaDelTrimestre,
  grillaDelMes,
  leerEncargo,
  perfilConHistorial,
  piezasDelMes,
  resumenDePiezas,
} from '@gc/operaciones'
import PaginaDeEstrategia from './app/(app)/[marca]/estrategia/page.js'
import PaginaDeGrilla from './app/(app)/[marca]/grilla/[mes]/page.js'
import PaginaDePerfil from './app/(app)/[marca]/perfil/page.js'
import Inicio from './app/(app)/page.js'
import { marcasDeLaOrganizacion } from './datos.js'

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
  perfilConHistorial: vi.fn(),
  leerEncargo: vi.fn(),
  resumenDePiezas: vi.fn(),
  piezasDelMes: vi.fn(),
}))
vi.mock('./datos.js', () => ({
  conexion: () => ({}),
  organizacionPorDefecto: vi.fn(),
  marcasDeLaOrganizacion: vi.fn(),
}))

// Las Server Actions no se ejercitan aquí: estas pruebas preguntan por lo que
// se renderiza. Sin implementación en el factory por lo de siempre en vitest
// 2.1, pero tampoco hace falta ninguna: nadie las llama.
vi.mock('./acciones.js', () => ({
  encolarGrillaAccion: vi.fn(),
  encolarEstrategiaAccion: vi.fn(),
  generarPiezasAccion: vi.fn(),
  reanudarCorridaAccion: vi.fn(),
  aprobarGrillaAccion: vi.fn(),
  reabrirGrillaAccion: vi.fn(),
  descartarSlotAccion: vi.fn(),
  editarSlotAccion: vi.fn(),
  guardarPerfilAction: vi.fn(),
  crearMarcaAccion: vi.fn(),
}))

vi.mock('next/navigation', () => ({
  useRouter: () => ({ refresh: vi.fn(), push: vi.fn() }),
  notFound: () => {
    throw new Error('notFound')
  },
  // Como el de verdad: `redirect` corta la ejecución lanzando. Devolver sin
  // lanzar dejaría a la página siguiendo de largo hasta el `return`, y una
  // prueba que afirma "redirige" pasaría igual si el redirect no existiera.
  redirect: (destino: string) => {
    throw new Error(`redirect:${destino}`)
  },
}))
vi.mock('next/link', () => ({
  default: ({ children, href }: { children: ReactNode; href: string }) => (
    <a href={href}>{children}</a>
  ),
}))

// Un encargo presente por omisión: la mayoría de las pruebas de estrategia no
// hablan del encargo, sino de la puerta de la corrida viva. Sin este valor
// por omisión, `leerEncargo` sin sustituir devolvería `undefined` y la puerta
// del encargo (que sí es real en la página) las pondría rojas a todas por un
// motivo que no es el que están midiendo.
const ENCARGO_ESCRITO: LecturaDeEncargo = {
  tipo: 'presente',
  encargo: {
    objetivo: 'Vender las doce parcelas que quedan del loteo norte',
    comoSeMide: 'Formularios de contacto recibidos',
    publicacionesPorSemana: 4,
    canalesDisponibles: ['instagram', 'blog'],
    queEstaPasando: '',
    queFunciono: '',
    queNoFunciono: '',
    queEvitar: '',
    algoMas: '',
  },
}

afterEach(cleanup)
beforeEach(() => {
  vi.mocked(corridaDe).mockReset()
  vi.mocked(grillaDelMes).mockReset()
  vi.mocked(estrategiaDelTrimestre).mockReset()
  vi.mocked(perfilConHistorial).mockReset()
  vi.mocked(leerEncargo).mockReset()
  vi.mocked(marcasDeLaOrganizacion).mockReset()
  vi.mocked(resumenDePiezas).mockReset()
  vi.mocked(piezasDelMes).mockReset()
  vi.mocked(corridaDe).mockResolvedValue(null)
  vi.mocked(leerEncargo).mockResolvedValue(ENCARGO_ESCRITO)
  // Por omisión, ningún slot y ninguna pieza: así las pruebas que no hablan de
  // piezas —casi todas las de este archivo— no ven aparecer ni el botón ni
  // ningún texto de avance por un resumen que no fijaron.
  vi.mocked(resumenDePiezas).mockResolvedValue({ total: 0, listas: 0, fallidas: 0, enVuelo: 0 })
  // Por la misma razón: un mapa vacío por omisión, para que ninguna pieza
  // aparezca en el panel de detalle de las pruebas que no la fijan.
  vi.mocked(piezasDelMes).mockResolvedValue(new Map())
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

function resumen(campos: Partial<ResumenDePiezas> = {}): ResumenDePiezas {
  return { total: 0, listas: 0, fallidas: 0, enVuelo: 0, ...campos }
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
  return render(await PaginaDeGrilla({ params: Promise.resolve({ marca: 'parcelas', mes }) }))
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

describe('la puerta del encargo en la estrategia', () => {
  // Hallazgo Importante 1 de la revisión adversarial: la rama de estrategia
  // inválida metía `hayEncargo` dentro del mismo ternario que `regenerable`,
  // así que sin encargo pero con la estrategia en borrador caía al `else` de
  // «no regenerable» e imprimía «Está en estado «Borrador» y el motor solo
  // regenera una que esté en borrador» — una frase que se desmiente sola,
  // porque borrador es justo el estado que sí se regenera, y que esconde la
  // causa real (falta el encargo).
  it('sobre una estrategia inválida en borrador sin encargo pide el encargo y no un motivo que se desmiente solo', async () => {
    vi.mocked(estrategiaDelTrimestre).mockResolvedValue({
      tipo: 'invalida', periodo: '2026-Q4', id: 'estrategia-1', estado: 'borrador',
    })
    vi.mocked(corridaDe).mockResolvedValue(null)
    vi.mocked(leerEncargo).mockResolvedValue({ tipo: 'ausente' })

    await renderEstrategia()

    expect(screen.queryByRole('button', { name: 'Regenerar estrategia' })).toBeNull()
    expect(screen.queryByText(/solo regenera una que esté en borrador/i)).toBeNull()
    expect(screen.queryByText(/para regenerar, escribe primero el encargo/i)).not.toBeNull()
  })

  it('sin encargo no ofrece generar, y dice que falta escribirlo', async () => {
    // La barrera real vive en `encolarEstrategia`; esto evita ofrecer un botón
    // que sabemos que va a fallar un segundo después.
    vi.mocked(estrategiaDelTrimestre).mockResolvedValue({ tipo: 'ausente', periodo: '2026-Q4' })
    vi.mocked(corridaDe).mockResolvedValue(null)
    vi.mocked(leerEncargo).mockResolvedValue({ tipo: 'ausente' })

    await renderEstrategia()

    expect(screen.queryByRole('button', { name: 'Generar estrategia' })).toBeNull()
    expect(screen.queryByText(/escribe primero el encargo/i)).not.toBeNull()
  })

  it('con encargo escrito vuelve a ofrecer generar', async () => {
    vi.mocked(estrategiaDelTrimestre).mockResolvedValue({ tipo: 'ausente', periodo: '2026-Q4' })
    vi.mocked(corridaDe).mockResolvedValue(null)

    await renderEstrategia()

    expect(screen.queryByRole('button', { name: 'Generar estrategia' })).not.toBeNull()
  })

  it('con la estrategia fuera de borrador el encargo queda de solo lectura', async () => {
    // `archivada` y no `aprobada` a propósito: la condición correcta es «el
    // estado no es borrador», y con `aprobada` las dos redacciones coinciden.
    vi.mocked(estrategiaDelTrimestre).mockResolvedValue({
      ...ESTRATEGIA_EN_BORRADOR,
      estado: 'archivada',
    })
    vi.mocked(corridaDe).mockResolvedValue(null)

    await renderEstrategia()

    expect(screen.queryByRole('button', { name: 'Guardar el encargo' })).toBeNull()
  })

  // Hallazgo Menor 2 de la revisión de Task 8: sobre una estrategia válida y
  // regenerable, sin encargo no aparecía ni el botón ni ningún texto — quien
  // mira la pantalla veía su estrategia y nada que apretar, sin saber por qué.
  it('sobre la estrategia válida sin encargo no ofrece regenerar, y dice que hace falta escribirlo', async () => {
    vi.mocked(estrategiaDelTrimestre).mockResolvedValue(ESTRATEGIA_EN_BORRADOR)
    vi.mocked(corridaDe).mockResolvedValue(null)
    vi.mocked(leerEncargo).mockResolvedValue({ tipo: 'ausente' })

    await renderEstrategia()

    expect(screen.queryByRole('button', { name: 'Regenerar estrategia' })).toBeNull()
    expect(screen.queryByText(/para regenerar, escribe primero el encargo/i)).not.toBeNull()
  })

  // Hallazgo Menor 3: con la estrategia congelada (fuera de borrador) y el
  // encargo corrupto a la vez, el aviso de encargo inválido decía «Vuelve a
  // escribirlo» sobre un formulario que ya está en solo lectura — el remedio
  // real, devolver la estrategia a borrador, lo da el otro párrafo, y las dos
  // frases juntas se leían como una contradicción.
  it('con la estrategia congelada y el encargo inválido no manda a reescribirlo', async () => {
    vi.mocked(estrategiaDelTrimestre).mockResolvedValue({
      tipo: 'invalida', periodo: '2026-Q4', id: 'estrategia-1', estado: 'archivada',
    })
    vi.mocked(corridaDe).mockResolvedValue(null)
    vi.mocked(leerEncargo).mockResolvedValue({
      tipo: 'invalido', motivo: 'Falta el objetivo.', datos: null,
    })

    await renderEstrategia()

    expect(screen.queryByText(/no cumple su esquema/i)).not.toBeNull()
    expect(screen.queryByText(/vuelve a escribirlo/i)).toBeNull()
  })

  // Hallazgo Menor 4: la condición del aviso de congelado era solo
  // `encargoCongelado`, así que una estrategia aprobada de antes de este
  // bloque —sin ninguna fila de encargo— mostraba «el encargo quedó congelado
  // con ella» frente a un formulario vacío, que es falso: no hay nada que
  // congelar si nunca hubo encargo.
  it('sobre una estrategia aprobada sin ningún encargo no afirma un congelado que no existe', async () => {
    vi.mocked(estrategiaDelTrimestre).mockResolvedValue({
      ...ESTRATEGIA_EN_BORRADOR,
      estado: 'aprobada',
    })
    vi.mocked(corridaDe).mockResolvedValue(null)
    vi.mocked(leerEncargo).mockResolvedValue({ tipo: 'ausente' })

    await renderEstrategia()

    expect(screen.queryByText(/el encargo quedó congelado/i)).toBeNull()
  })

  // Hallazgo Importante 2: `page.tsx` pasaba `null` a `EditorDeEncargo`
  // siempre que el encargo no fuera `presente`, así que un encargo corrupto
  // —pero parcialmente legible— hacía salir el formulario en blanco: había
  // que reescribir los nueve campos aunque ocho estuvieran bien. La variante
  // `invalido` ahora lleva la fila cruda en `datos`, y `desdeElEncargo` (que
  // nunca lanza) carga lo que se pueda campo por campo.
  it('con un encargo inválido pero parcialmente legible, el formulario llega con lo que sí se pudo leer', async () => {
    vi.mocked(estrategiaDelTrimestre).mockResolvedValue({ tipo: 'ausente', periodo: '2026-Q4' })
    vi.mocked(corridaDe).mockResolvedValue(null)
    vi.mocked(leerEncargo).mockResolvedValue({
      tipo: 'invalido',
      motivo:
        'El encargo tiene campos que corregir antes de guardarlo:\n' +
        '- Cómo sabrás que resultó: falta',
      // Solo `objetivo` es válido; el resto de los campos obligatorios falta,
      // que es justo la clase de fila corrupta que `Encargo.safeParse`
      // rechazaría.
      datos: { objetivo: 'Vender las doce parcelas que quedan del loteo norte' },
    })

    await renderEstrategia()

    const objetivo = screen.getByLabelText('Objetivo del trimestre') as HTMLTextAreaElement
    expect(objetivo.value).toBe('Vender las doce parcelas que quedan del loteo norte')
  })
})

describe('el bloque plegable del encargo', () => {
  // El spec (§«La pantalla») pide que con encargo el bloque nazca plegado,
  // mostrando el objetivo en una línea, y que sin encargo nazca abierto: acá
  // se viene sobre todo a leer y aprobar la estrategia, y pasar nueve campos
  // de formulario en cada visita es la fricción que el plegado evita.
  it('nace plegado cuando ya hay un encargo escrito', async () => {
    vi.mocked(estrategiaDelTrimestre).mockResolvedValue({ tipo: 'ausente', periodo: '2026-Q4' })
    vi.mocked(corridaDe).mockResolvedValue(null)
    // `ENCARGO_ESCRITO`, el valor por omisión de `beforeEach`, ya tiene un
    // encargo `presente`.

    await renderEstrategia()

    const resumen = screen.getByText(
      /Objetivo: Vender las doce parcelas que quedan del loteo norte/,
    )
    expect(resumen.closest('details')?.open).toBe(false)
  })

  it('nace abierto cuando todavía no hay encargo', async () => {
    vi.mocked(estrategiaDelTrimestre).mockResolvedValue({ tipo: 'ausente', periodo: '2026-Q4' })
    vi.mocked(corridaDe).mockResolvedValue(null)
    vi.mocked(leerEncargo).mockResolvedValue({ tipo: 'ausente' })

    await renderEstrategia()

    const resumen = screen.getByText(/Falta escribir el encargo de este trimestre/)
    expect(resumen.closest('details')?.open).toBe(true)
  })
})

function slotDeGrilla(id: string, campos: Partial<SlotDeLaGrilla> = {}): SlotDeLaGrilla {
  return {
    id,
    fecha: '2026-10-05',
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
 * Regenerar borra los slots del mes entero y los reinserta desde la propuesta
 * nueva. Los descartes no se recuentan en las reglas —la propuesta del modelo
 * no los conoce— pero sí se pierden, y son lo único destruido que se puede
 * contar antes de confirmar. La advertencia por eso dice cuántos son.
 */
describe('la advertencia de regenerar la grilla', () => {
  async function abrirLaConfirmacion(slots: SlotDeLaGrilla[]) {
    vi.mocked(grillaDelMes).mockResolvedValue(
      grilla({ estado: 'borrador', contentPlanId: 'plan-1', slots }),
    )
    vi.mocked(corridaDe).mockResolvedValue(null)

    await renderGrilla()
    await userEvent.click(screen.getByRole('button', { name: 'Regenerar grilla' }))
  }

  it('dice cuántos descartes se pierden cuando los hay', async () => {
    await abrirLaConfirmacion([
      slotDeGrilla('a'),
      slotDeGrilla('b', { descartado: true }),
      slotDeGrilla('c', { descartado: true }),
      slotDeGrilla('d'),
    ])

    // El número tiene que ser el de descartados (2) y no el de slots (4): con
    // `grilla.slots.length` la frase sigue siendo gramatical y sigue nombrando
    // un número, así que sin comprobar cuál la prueba no afirmaría nada.
    expect(
      screen.queryByText(/Las 2 que descartaste vuelven a aparecer/),
    ).not.toBeNull()
    expect(screen.queryByText(/Las 4 que descartaste/)).toBeNull()
    expect(screen.queryByText(/Regenerar la grilla de 2026-10/)).not.toBeNull()
  })

  it('concuerda en singular cuando el descarte es uno solo', async () => {
    await abrirLaConfirmacion([slotDeGrilla('a'), slotDeGrilla('b', { descartado: true })])

    // «Las 1 que descartaste vuelven» es gramatical para una expresión regular
    // pero no para una persona, y es el caso alcanzable más común: descartas
    // una publicación que no te convence y regeneras.
    expect(screen.queryByText(/La que descartaste vuelve a aparecer/)).not.toBeNull()
    expect(screen.queryByText(/Las 1 que descartaste/)).toBeNull()
  })

  it('no habla de descartes cuando no hay ninguno', async () => {
    await abrirLaConfirmacion([slotDeGrilla('a'), slotDeGrilla('b')])

    expect(screen.queryByText(/descartaste/)).toBeNull()
    // Y sí dice lo que se pierde igual: sin esta mitad, un texto vacío pasaría.
    expect(
      screen.queryByText(/Las ediciones que hayas hecho a mano se pierden/),
    ).not.toBeNull()
  })
})

/**
 * `within(seccionDePiezas(container))` y no `screen` a secas: el mismo
 * documento tiene otros botones y otros párrafos con números (el resumen por
 * canal, «Regenerar grilla», «Reabrir grilla»), así que preguntarle al
 * documento entero podría pasar aunque el texto saliera pegado a otro botón.
 */
function seccionDePiezas(container: HTMLElement): HTMLElement {
  const seccion = within(container).queryByRole('region', { name: 'Piezas del mes' })
  if (!seccion) throw new Error('La sección "Piezas del mes" no está en el documento')
  return seccion
}

describe('generar las piezas del mes', () => {
  it('con la grilla en borrador no ofrece generar las piezas', async () => {
    vi.mocked(grillaDelMes).mockResolvedValue(grilla({ estado: 'borrador', contentPlanId: 'plan-1' }))
    vi.mocked(resumenDePiezas).mockResolvedValue(resumen({ total: 20 }))

    const { container } = await renderGrilla()

    expect(screen.queryByRole('button', { name: 'Generar las piezas' })).toBeNull()
    // La sección entera, no solo el botón: en borrador no hay nada que
    // anunciar sobre piezas todavía.
    expect(within(container).queryByRole('region', { name: 'Piezas del mes' })).toBeNull()
  })

  // Hallazgo menor de la revisión de la Task 6: el resumen de avance vivía
  // anidado dentro de `grilla.estado === 'aprobada'`, así que reabrir la
  // grilla —cosa que hoy nada impide mientras las corridas de piezas siguen
  // vivas— hacía desaparecer el aviso de pantalla aunque el worker las
  // siguiera escribiendo. El brief ataba la regla del *botón* a `aprobada`,
  // no la del *resumen*: con la grilla en borrador el botón sigue sin
  // ofrecerse, pero el texto de avance tiene que seguir viéndose.
  it('con la grilla reabierta pero corridas de piezas en vuelo, sigue mostrando el avance sin ofrecer el botón', async () => {
    vi.mocked(grillaDelMes).mockResolvedValue(grilla({ estado: 'borrador', contentPlanId: 'plan-1' }))
    vi.mocked(resumenDePiezas).mockResolvedValue(resumen({ total: 20, listas: 8, enVuelo: 5 }))

    const { container } = await renderGrilla()

    expect(
      within(seccionDePiezas(container)).queryByText('Escribiendo las piezas: 8 de 20 listas'),
    ).not.toBeNull()
    expect(
      within(seccionDePiezas(container)).queryByRole('button', { name: 'Generar las piezas' }),
    ).toBeNull()
  })

  it('con la grilla aprobada y ninguna pieza, ofrece generar', async () => {
    vi.mocked(grillaDelMes).mockResolvedValue(grilla({ estado: 'aprobada', contentPlanId: 'plan-1' }))
    vi.mocked(resumenDePiezas).mockResolvedValue(resumen({ total: 20 }))

    const { container } = await renderGrilla()

    expect(
      within(seccionDePiezas(container)).queryByRole('button', { name: 'Generar las piezas' }),
    ).not.toBeNull()
  })

  it('mientras hay corridas en vuelo dice cuántas van', async () => {
    vi.mocked(grillaDelMes).mockResolvedValue(grilla({ estado: 'aprobada', contentPlanId: 'plan-1' }))
    vi.mocked(resumenDePiezas).mockResolvedValue(resumen({ total: 20, listas: 8, enVuelo: 5 }))

    const { container } = await renderGrilla()

    // El texto lleva «de» y los dos números: cuántas están listas y cuántas
    // en total, no solo un conteo suelto.
    expect(
      within(seccionDePiezas(container)).queryByText('Escribiendo las piezas: 8 de 20 listas'),
    ).not.toBeNull()
    // Con corridas vivas sigue habiendo candidatas por encolar (8 + 5 < 20),
    // así que el botón sigue ofreciéndose.
    expect(
      within(seccionDePiezas(container)).queryByRole('button', { name: 'Generar las piezas' }),
    ).not.toBeNull()
  })

  it('el avance suma las fallidas cuando las hay', async () => {
    vi.mocked(grillaDelMes).mockResolvedValue(grilla({ estado: 'aprobada', contentPlanId: 'plan-1' }))
    vi.mocked(resumenDePiezas).mockResolvedValue(resumen({ total: 20, listas: 8, enVuelo: 5, fallidas: 3 }))

    const { container } = await renderGrilla()

    expect(
      within(seccionDePiezas(container)).queryByText(
        'Escribiendo las piezas: 8 de 20 listas, 3 fallaron',
      ),
    ).not.toBeNull()
  })

  it('con todas las piezas listas no ofrece generar y lo dice', async () => {
    vi.mocked(grillaDelMes).mockResolvedValue(grilla({ estado: 'aprobada', contentPlanId: 'plan-1' }))
    vi.mocked(resumenDePiezas).mockResolvedValue(resumen({ total: 20, listas: 20 }))

    const { container } = await renderGrilla()

    expect(
      within(seccionDePiezas(container)).queryByRole('button', { name: 'Generar las piezas' }),
    ).toBeNull()
    expect(
      within(seccionDePiezas(container)).queryByText('Las 20 piezas están escritas'),
    ).not.toBeNull()
  })

  // El caso que el spec marcó como el más fácil de arruinar: sin nada
  // encolado todavía la sección no dice nada más que el botón, y con todo
  // listo dice que está completo y no ofrece el botón. Confundirlos —por
  // ejemplo mostrando «Las 20 piezas están escritas» también cuando
  // `listas` es 0— sería peor que no tener el resumen.
  it('distingue «ninguna encolada» de «todas listas»', async () => {
    vi.mocked(grillaDelMes).mockResolvedValue(grilla({ estado: 'aprobada', contentPlanId: 'plan-1' }))
    vi.mocked(resumenDePiezas).mockResolvedValue(resumen({ total: 20 }))

    const { container: ningunaEncolada } = await renderGrilla()
    expect(
      within(seccionDePiezas(ningunaEncolada)).queryByText('Las 20 piezas están escritas'),
    ).toBeNull()
    expect(
      within(seccionDePiezas(ningunaEncolada)).queryByRole('button', {
        name: 'Generar las piezas',
      }),
    ).not.toBeNull()

    cleanup()

    vi.mocked(resumenDePiezas).mockResolvedValue(resumen({ total: 20, listas: 20 }))
    const { container: todasListas } = await renderGrilla()
    expect(
      within(seccionDePiezas(todasListas)).queryByText('Las 20 piezas están escritas'),
    ).not.toBeNull()
    expect(
      within(seccionDePiezas(todasListas)).queryByRole('button', { name: 'Generar las piezas' }),
    ).toBeNull()
  })
})

async function renderPerfil(marca: string) {
  render(await PaginaDePerfil({ params: Promise.resolve({ marca }) }))
}

function editor(): HTMLTextAreaElement {
  return screen.getByLabelText('Perfil de marca en formato JSON') as HTMLTextAreaElement
}

/**
 * Una marca creada desde la web no tiene perfil, y sin perfil no se genera ni
 * estrategia ni grilla. La pantalla mandaba a la terminal justo ahí, que es
 * de donde esta rama viene sacando a la gente.
 */
describe('la pantalla de perfil', () => {
  it('sin perfil abre el editor con el formulario vacío y no manda al CLI', async () => {
    vi.mocked(perfilConHistorial).mockResolvedValue(null)

    await renderPerfil('nueva')

    // Sin perfil, `EditorDePerfil` arranca de `desdeElPerfil(null)`: un
    // formulario vacío, ya no la plantilla. La sección avanzada muestra ese
    // formulario COMPLETO —con sus filas y textos vacíos, `conservarVacios:
    // true`—, no lo que se guardaría: eso es lo que descarta las listas
    // obligatorias sin filas escritas.
    expect(JSON.parse(editor().value)).toEqual({
      posicionamiento: { categoria: '', promesa: '', diferenciadores: [''] },
      publicos: [{ nombre: '', dolor: '', objecion: '' }],
      tono: { atributos: [''], hacer: [''], noHacer: [''] },
      lexico: { preferido: [], prohibido: [] },
      pilares: [
        { nombre: '', descripcion: '', proporcion: 0.5 },
        { nombre: '', descripcion: '', proporcion: 0.5 },
      ],
      ofertas: [],
      restricciones: { disclaimers: [] },
    })
    expect(screen.queryByText(/pnpm cli/)).toBeNull()
    expect(screen.queryByText(/todavía no tiene perfil/)).not.toBeNull()
  })

  it('con perfil abre el editor con ese perfil y sin el aviso de marca nueva', async () => {
    // Perfil ya canónico —la forma que también produciría guardar el
    // formulario— para que sobreviva `desdeElPerfil` y `haciaElPerfil` sin
    // cambios; que esa ida y vuelta no pierda nada lo prueba
    // `conversion.test.ts` en general, y acá solo que la pantalla pasa el
    // perfil recibido al editor.
    const perfilGuardado = {
      posicionamiento: {
        categoria: 'Venta de parcelas de agrado',
        promesa: 'Parcelas con factibilidad garantizada y trazabilidad legal completa',
        diferenciadores: ['Factibilidad verificada'],
      },
      publicos: [
        {
          nombre: 'Inversionista primerizo',
          dolor: 'Teme comprar un terreno sin agua ni acceso legal',
          objecion: 'No sabe distinguir una parcela regularizada de una que no lo está',
        },
      ],
      tono: {
        atributos: ['claro'],
        hacer: ['Explicar con datos concretos'],
        noHacer: ['Prometer retornos'],
      },
      lexico: { preferido: ['factibilidad'], prohibido: ['oportunidad única'] },
      pilares: [
        { nombre: 'educacion', descripcion: 'Sobre qué enseña la marca', proporcion: 0.6 },
        { nombre: 'producto', descripcion: 'Qué vende la marca', proporcion: 0.4 },
      ],
      ofertas: [
        { nombre: 'Tour guiado', descripcion: 'Visita al terreno', url: 'https://ejemplo.cl/tour' },
      ],
      restricciones: { disclaimers: ['Imágenes referenciales'] },
    }
    vi.mocked(perfilConHistorial).mockResolvedValue({
      version: 3,
      perfil: perfilGuardado,
      versiones: [{ version: 3, createdAt: new Date('2026-08-01T00:00:00Z') }],
    })

    await renderPerfil('parcelas')

    expect(JSON.parse(editor().value)).toEqual(perfilGuardado)
    expect(screen.queryByText(/todavía no tiene perfil/)).toBeNull()
  })
})

async function renderInicio(searchParams: { nueva?: string } = {}) {
  render(await Inicio({ searchParams: Promise.resolve(searchParams) }))
}

const UNA_MARCA = [{ id: 'm-1', slug: 'parcelas', name: 'CTP' }]

describe('la pantalla de inicio', () => {
  it('sin ninguna marca muestra el formulario en vez de redirigir', async () => {
    vi.mocked(marcasDeLaOrganizacion).mockResolvedValue([])

    await renderInicio()

    expect(screen.queryByRole('button', { name: 'Crear marca' })).not.toBeNull()
  })

  it('con marcas redirige a la grilla del mes actual de la primera', async () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-11-15T00:00:00Z'))
    try {
      vi.mocked(marcasDeLaOrganizacion).mockResolvedValue(UNA_MARCA)

      const error = await renderInicio().catch((e: unknown) => e)

      expect((error as Error).message).toBe('redirect:/parcelas/grilla/2026-11')
    } finally {
      vi.useRealTimers()
    }
  })

  // El redirect de arriba deja el formulario inalcanzable en cuanto existe una
  // marca, que es siempre a partir de la primera. Sin este parámetro, crear la
  // segunda marca seguiría siendo cosa del CLI.
  it('con marcas y ?nueva muestra el formulario en vez de redirigir', async () => {
    vi.mocked(marcasDeLaOrganizacion).mockResolvedValue(UNA_MARCA)

    await renderInicio({ nueva: '1' })

    expect(screen.queryByRole('button', { name: 'Crear marca' })).not.toBeNull()
  })
})

describe('la pantalla de entrada', () => {
  it('la pantalla de entrada explica el rechazo cuando la cuenta no está autorizada', async () => {
    const { default: PaginaDeEntrada } = await import('./app/entrar/page.js')

    render(await PaginaDeEntrada({ searchParams: Promise.resolve({ error: 'AccessDenied' }) }))

    expect(screen.queryByText(/no está en la lista de personas autorizadas/i)).not.toBeNull()
    expect(screen.queryByRole('button', { name: /entrar con google/i })).not.toBeNull()
  })

  it('sin error la pantalla de entrada no acusa a nadie de nada', async () => {
    const { default: PaginaDeEntrada } = await import('./app/entrar/page.js')

    render(await PaginaDeEntrada({ searchParams: Promise.resolve({}) }))

    // Sin esta mitad, una pantalla que mostrara siempre el aviso pasaría.
    expect(screen.queryByText(/no está en la lista/i)).toBeNull()
    // Y tampoco el banner rojo de falla del sistema: sin esta aserción, una
    // pantalla que mostrara siempre ese banner también pasaba esta prueba.
    expect(screen.queryByRole('alert')).toBeNull()
    expect(screen.queryByRole('button', { name: /entrar con google/i })).not.toBeNull()
  })

  // Hallazgo 4: `Configuration` llega cuando `registrarPersona` falla (una
  // caída de la base, por ejemplo). No es un rechazo por lista, así que no
  // puede mostrar el mismo texto ni pasar en silencio: sin esta rama la
  // pantalla queda muda y la persona reintenta sin saber que el problema es
  // del sistema.
  it('la pantalla de entrada avisa de una falla del sistema y no acusa a la cuenta', async () => {
    const { default: PaginaDeEntrada } = await import('./app/entrar/page.js')

    render(await PaginaDeEntrada({ searchParams: Promise.resolve({ error: 'Configuration' }) }))

    expect(screen.queryByText(/problema del sistema/i)).not.toBeNull()
    // No es el mismo aviso que el rechazo por lista: confundirlos manda a
    // pedir un permiso que ya se tiene.
    expect(screen.queryByText(/no está en la lista de personas autorizadas/i)).toBeNull()
    expect(screen.queryByRole('button', { name: /entrar con google/i })).not.toBeNull()
  })

  // Menor B de la revisión de rama: Auth.js manda otros códigos de error
  // —`MissingCSRF` con un formulario expirado o cookies bloqueadas,
  // `OAuthCallbackError`, `Verification`— que antes dejaban la pantalla
  // muda: ni el aviso de rechazo ni el de falla del sistema, ni ninguna
  // pista de que algo salió mal.
  it.each(['MissingCSRF', 'OAuthCallbackError', 'Verification'])(
    'la pantalla de entrada avisa de un error genérico (%s) sin acusar a la cuenta ni a un sistema en particular',
    async (codigo) => {
      const { default: PaginaDeEntrada } = await import('./app/entrar/page.js')

      render(await PaginaDeEntrada({ searchParams: Promise.resolve({ error: codigo }) }))

      expect(screen.queryByRole('alert')).not.toBeNull()
      expect(screen.queryByText(/no pudimos completar el inicio de sesión/i)).not.toBeNull()
      expect(screen.queryByText(/no está en la lista de personas autorizadas/i)).toBeNull()
      expect(screen.queryByText(/problema del sistema/i)).toBeNull()
      expect(screen.queryByRole('button', { name: /entrar con google/i })).not.toBeNull()
    },
  )
})

describe('la pantalla de entrada dentro de su layout real', () => {
  // Hallazgo Crítico de la revisión de rama: el layout raíz (`app/layout.tsx`)
  // envuelve también a `/entrar`, que el middleware excluye a propósito para
  // que sea alcanzable sin sesión. Antes ese layout armaba el selector de
  // marcas consultando la base, así que un `GET /entrar` sin cookie exponía
  // el nombre de todas las marcas de la organización. El encabezado se movió
  // al layout del grupo `(app)`, que `/entrar` no hereda. Esta prueba renderiza
  // la pantalla de entrada dentro de su layout de verdad —no aislada, como el
  // resto de este archivo— para afirmar que ningún nombre de marca se filtra.
  it('no expone el catálogo de marcas de la organización', async () => {
    vi.mocked(marcasDeLaOrganizacion).mockResolvedValue([
      { id: 'm-1', slug: 'parcelas', name: 'CTP' },
      { id: 'm-2', slug: 'otra-startup', name: 'Otra Startup' },
    ])
    const { default: RaizLayout } = await import('./app/layout.js')
    const { default: PaginaDeEntrada } = await import('./app/entrar/page.js')

    const contenido = await PaginaDeEntrada({ searchParams: Promise.resolve({}) })
    render(await RaizLayout({ children: contenido }))

    expect(screen.queryByText('CTP')).toBeNull()
    expect(screen.queryByText('Otra Startup')).toBeNull()
    expect(screen.queryByRole('link', { name: '+ Nueva marca' })).toBeNull()
    // La ausencia de texto no distingue "no se armó el selector" de "se armó
    // y no se ve por CSS": lo que hay que afirmar es que el layout raíz ni
    // siquiera consultó el catálogo.
    expect(marcasDeLaOrganizacion).not.toHaveBeenCalled()
    expect(screen.queryByRole('button', { name: /entrar con google/i })).not.toBeNull()
  })
})
