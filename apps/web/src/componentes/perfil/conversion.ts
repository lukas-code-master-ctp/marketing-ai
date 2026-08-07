/**
 * Traduce entre la forma cómoda de editar el perfil de marca —porcentajes
 * enteros, URL como cadena, listas con filas vacías para escribir— y el JSON
 * que espera `PerfilDeMarca` (`packages/brand/src/perfil.ts`).
 *
 * `apps/web` no declara `@gc/brand`: por eso el esquema no se importa acá,
 * y los valores de ejemplo de este archivo están escritos literales.
 *
 * Dos direcciones, dos responsabilidades distintas:
 * - `desdeElPerfil` carga lo que haya —perfil viejo, plantilla, basura desde
 *   la base— para que el formulario tenga algo que mostrar. Nunca lanza:
 *   validar no es asunto suyo, de eso responde el esquema al guardar.
 * - `haciaElPerfil` limpia lo que la persona escribió —recorta espacios,
 *   descarta filas vacías— y lo deja en la forma que el esquema exige.
 */

export interface PublicoEnFormulario {
  nombre: string
  dolor: string
  objecion: string
}

export interface PilarEnFormulario {
  nombre: string
  descripcion: string
  porcentaje: number
}

export interface OfertaEnFormulario {
  nombre: string
  descripcion: string
  url: string
}

export interface PerfilEnFormulario {
  posicionamiento: { categoria: string; promesa: string; diferenciadores: string[] }
  publicos: PublicoEnFormulario[]
  tono: { atributos: string[]; hacer: string[]; noHacer: string[] }
  lexico: { preferido: string[]; prohibido: string[] }
  pilares: PilarEnFormulario[]
  ofertas: OfertaEnFormulario[]
  restricciones: { disclaimers: string[] }
}

/**
 * El formulario arranca con las listas obligatorias del esquema —los
 * públicos y los pilares, que exigen al menos uno y al menos dos
 * respectivamente— con una fila vacía para que haya dónde escribir. Las
 * listas opcionales arrancan vacías: no se le pide a nadie que llene lo que
 * puede omitir.
 */
export const FORMULARIO_VACIO: PerfilEnFormulario = {
  posicionamiento: { categoria: '', promesa: '', diferenciadores: [''] },
  publicos: [{ nombre: '', dolor: '', objecion: '' }],
  tono: { atributos: [''], hacer: [''], noHacer: [''] },
  lexico: { preferido: [], prohibido: [] },
  pilares: [
    { nombre: '', descripcion: '', porcentaje: 50 },
    { nombre: '', descripcion: '', porcentaje: 50 },
  ],
  ofertas: [],
  restricciones: { disclaimers: [] },
}

const SNAKE_CASE = /^[a-z][a-z0-9_]*$/

/**
 * Normaliza un nombre libre al `snake_case` que `PerfilDeMarca` exige para
 * el nombre de un pilar. Si el resultado no puede empezar con una letra
 * —quedó vacío, o el original empezaba con un dígito o solo tenía símbolos—
 * devuelve `''`: no hay nada razonable que adivinar, y el campo vacío es lo
 * que hace visible que hace falta corregirlo a mano.
 */
export function aSnakeCase(texto: string): string {
  const normalizado = texto
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '') // quita los diacríticos (acentos, diéresis)
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/_+/g, '_')
    .replace(/^_+|_+$/g, '')

  return SNAKE_CASE.test(normalizado) ? normalizado : ''
}

/** Devuelve `valor` si es una cadena; si no, la cadena por defecto. */
function comoTexto(valor: unknown, porDefecto = ''): string {
  return typeof valor === 'string' ? valor : porDefecto
}

/** Devuelve `valor` si es un arreglo de cadenas; si no, `undefined`. */
function comoListaDeTextos(valor: unknown): string[] | undefined {
  if (!Array.isArray(valor)) return undefined
  if (!valor.every((v) => typeof v === 'string')) return undefined
  return valor
}

/**
 * Una lista obligatoria del esquema —públicos, pilares— que llega vacía o
 * ausente se rellena con una fila vacía, para que el formulario tenga dónde
 * escribir. Una lista opcional que llega ausente se deja vacía.
 */
function listaOFila<T>(lista: T[] | undefined, filaVacia: T): T[] {
  if (lista === undefined || lista.length === 0) return [filaVacia]
  return lista
}

/**
 * Carga lo que se pueda de `crudo` para mostrarlo en el formulario. No
 * lanza nunca: cada acceso cae a `FORMULARIO_VACIO` si el campo falta o no
 * tiene el tipo esperado. Validar de verdad es trabajo del esquema, al
 * guardar.
 */
export function desdeElPerfil(crudo: unknown): PerfilEnFormulario {
  const c = typeof crudo === 'object' && crudo !== null ? (crudo as Record<string, unknown>) : {}

  const posicionamientoCrudo =
    typeof c.posicionamiento === 'object' && c.posicionamiento !== null
      ? (c.posicionamiento as Record<string, unknown>)
      : {}
  const posicionamiento = {
    categoria: comoTexto(posicionamientoCrudo.categoria, FORMULARIO_VACIO.posicionamiento.categoria),
    promesa: comoTexto(posicionamientoCrudo.promesa, FORMULARIO_VACIO.posicionamiento.promesa),
    diferenciadores: listaOFila(comoListaDeTextos(posicionamientoCrudo.diferenciadores), ''),
  }

  const publicosCrudo = Array.isArray(c.publicos) ? c.publicos : []
  const publicos: PublicoEnFormulario[] = listaOFila(
    publicosCrudo.map((p): PublicoEnFormulario => {
      const o = typeof p === 'object' && p !== null ? (p as Record<string, unknown>) : {}
      return {
        nombre: comoTexto(o.nombre),
        dolor: comoTexto(o.dolor),
        objecion: comoTexto(o.objecion),
      }
    }),
    { nombre: '', dolor: '', objecion: '' },
  )

  const tonoCrudo =
    typeof c.tono === 'object' && c.tono !== null ? (c.tono as Record<string, unknown>) : {}
  const tono = {
    atributos: listaOFila(comoListaDeTextos(tonoCrudo.atributos), ''),
    hacer: listaOFila(comoListaDeTextos(tonoCrudo.hacer), ''),
    noHacer: listaOFila(comoListaDeTextos(tonoCrudo.noHacer), ''),
  }

  const lexicoCrudo =
    typeof c.lexico === 'object' && c.lexico !== null ? (c.lexico as Record<string, unknown>) : {}
  const lexico = {
    preferido: comoListaDeTextos(lexicoCrudo.preferido) ?? [],
    prohibido: comoListaDeTextos(lexicoCrudo.prohibido) ?? [],
  }

  const pilaresCrudo = Array.isArray(c.pilares) ? c.pilares : []
  const pilares: PilarEnFormulario[] = listaOFila(
    pilaresCrudo.map((p): PilarEnFormulario => {
      const o = typeof p === 'object' && p !== null ? (p as Record<string, unknown>) : {}
      const proporcion = typeof o.proporcion === 'number' ? o.proporcion : 0.5
      return {
        nombre: comoTexto(o.nombre),
        descripcion: comoTexto(o.descripcion),
        porcentaje: Math.round(proporcion * 100),
      }
    }),
    { nombre: '', descripcion: '', porcentaje: 50 },
  )
  // Un pilar solo, obligado a completar el mínimo de dos que exige el
  // esquema, se rellena con una fila vacía adicional.
  while (pilares.length < 2) pilares.push({ nombre: '', descripcion: '', porcentaje: 50 })

  const ofertasCrudo = Array.isArray(c.ofertas) ? c.ofertas : []
  const ofertas: OfertaEnFormulario[] = ofertasCrudo.map((o): OfertaEnFormulario => {
    const r = typeof o === 'object' && o !== null ? (o as Record<string, unknown>) : {}
    return {
      nombre: comoTexto(r.nombre),
      descripcion: comoTexto(r.descripcion),
      url: comoTexto(r.url, ''),
    }
  })

  const restriccionesCrudo =
    typeof c.restricciones === 'object' && c.restricciones !== null
      ? (c.restricciones as Record<string, unknown>)
      : {}
  const restricciones = {
    disclaimers: comoListaDeTextos(restriccionesCrudo.disclaimers) ?? [],
  }

  return { posicionamiento, publicos, tono, lexico, pilares, ofertas, restricciones }
}

/** `true` si el texto queda vacío tras recortar espacios. */
export function estaVacio(texto: string): boolean {
  return texto.trim() === ''
}

/** Recorta una lista de textos y, salvo que se pida conservarlos, descarta los que quedan vacíos. */
function limpiarLista(lista: string[], conservarVacios: boolean): string[] {
  const recortada = lista.map((t) => t.trim())
  return conservarVacios ? recortada : recortada.filter((t) => t !== '')
}

export interface OpcionesDeConversion {
  /**
   * Con `true`, conserva las filas y los textos vacíos, y la clave `url`
   * aunque esté vacía.
   *
   * Es para **mostrar y copiar**, no para guardar. Al guardar, lo vacío se
   * descarta a propósito: el formulario arranca las listas obligatorias con
   * una fila en blanco para que haya dónde escribir, y mandarla haría que el
   * esquema se queje de un elemento que nadie llenó.
   *
   * Al copiar pasa lo contrario: una lista vacía —`"publicos": []`— no le
   * dice a quien la lea que cada público lleva nombre, dolor y objeción. La
   * fila vacía **es** la documentación de la forma.
   */
  conservarVacios?: boolean
}

/**
 * Convierte el formulario a la forma que `PerfilDeMarca` valida. Recorta
 * espacios, convierte porcentaje a proporción y normaliza el nombre del
 * pilar a `snake_case`. Sin opciones, además descarta filas y elementos que
 * la persona nunca llenó — lo correcto al guardar. Con `conservarVacios:
 * true`, los conserva — para mostrar el formulario completo y para armar un
 * prompt que una IA externa pueda rellenar.
 */
export function haciaElPerfil(f: PerfilEnFormulario, opciones?: OpcionesDeConversion): unknown {
  const conservar = opciones?.conservarVacios === true
  return {
    posicionamiento: {
      categoria: f.posicionamiento.categoria.trim(),
      promesa: f.posicionamiento.promesa.trim(),
      diferenciadores: limpiarLista(f.posicionamiento.diferenciadores, conservar),
    },
    publicos: f.publicos
      .filter(
        (p) => conservar || !(estaVacio(p.nombre) && estaVacio(p.dolor) && estaVacio(p.objecion)),
      )
      .map((p) => ({
        nombre: p.nombre.trim(),
        dolor: p.dolor.trim(),
        objecion: p.objecion.trim(),
      })),
    tono: {
      atributos: limpiarLista(f.tono.atributos, conservar),
      hacer: limpiarLista(f.tono.hacer, conservar),
      noHacer: limpiarLista(f.tono.noHacer, conservar),
    },
    lexico: {
      preferido: limpiarLista(f.lexico.preferido, conservar),
      prohibido: limpiarLista(f.lexico.prohibido, conservar),
    },
    pilares: f.pilares
      .filter((p) => conservar || !(estaVacio(p.nombre) && estaVacio(p.descripcion)))
      .map((p) => ({
        nombre: aSnakeCase(p.nombre.trim()),
        descripcion: p.descripcion.trim(),
        proporcion: p.porcentaje / 100,
      })),
    ofertas: f.ofertas
      .filter(
        (o) =>
          conservar || !(estaVacio(o.nombre) && estaVacio(o.descripcion) && estaVacio(o.url)),
      )
      .map((o) => {
        const url = o.url.trim()
        const base = { nombre: o.nombre.trim(), descripcion: o.descripcion.trim() }
        // El esquema declara `url` opcional pero con forma de URL: la
        // ausencia de la clave se acepta, una cadena vacía se rechaza. Por
        // eso se omite la clave en vez de mandarla vacía, salvo que se pida
        // conservarla para mostrar o copiar.
        return url === '' && !conservar ? base : { ...base, url }
      }),
    restricciones: {
      disclaimers: limpiarLista(f.restricciones.disclaimers, conservar),
    },
  }
}

/**
 * `true` si al formulario le falta alguno de los campos que el esquema exige
 * como mínimo para poder guardar: categoría, promesa, al menos un
 * diferenciador, al menos un público completo, al menos un atributo de tono,
 * y al menos dos pilares con nombre y descripción.
 *
 * No repite los mínimos de longitud que valida `PerfilDeMarca`
 * (`packages/brand/src/perfil.ts`) —esa sigue siendo su única autoridad—,
 * solo distingue "vacío" de "algo escrito", que es lo único que el
 * formulario puede juzgar sin conocer ese esquema. Se usa para decidir si
 * `EditorDePerfil` deja intentar guardar o marca los campos que faltan.
 */
export function faltanCamposObligatorios(f: PerfilEnFormulario): boolean {
  if (estaVacio(f.posicionamiento.categoria)) return true
  if (estaVacio(f.posicionamiento.promesa)) return true
  if (f.posicionamiento.diferenciadores.every(estaVacio)) return true

  const algunPublicoCompleto = f.publicos.some(
    (p) => !estaVacio(p.nombre) && !estaVacio(p.dolor) && !estaVacio(p.objecion),
  )
  if (!algunPublicoCompleto) return true

  if (f.tono.atributos.every(estaVacio)) return true

  const pilaresCompletos = f.pilares.filter(
    (p) => !estaVacio(p.nombre) && !estaVacio(p.descripcion),
  ).length
  if (pilaresCompletos < 2) return true

  return false
}
