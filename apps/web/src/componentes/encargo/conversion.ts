import type { TipoEncargo } from '@gc/strategy'

/**
 * El encargo tal como vive en el formulario.
 *
 * Difiere del esquema en un campo: `publicacionesPorSemana` es texto acá y
 * número allá. Un `<input>` vacío da `''`, y guardarlo como `0` en el estado
 * haría aparecer un cero que nadie escribió. La conversión ocurre al
 * serializar, igual que el porcentaje de los pilares en el editor de perfil.
 */
export interface EncargoEnFormulario {
  objetivo: string
  comoSeMide: string
  publicacionesPorSemana: string
  canalesDisponibles: string[]
  queEstaPasando: string
  queFunciono: string
  queNoFunciono: string
  queEvitar: string
  algoMas: string
}

export const FORMULARIO_VACIO: EncargoEnFormulario = {
  objetivo: '',
  comoSeMide: '',
  publicacionesPorSemana: '',
  canalesDisponibles: [],
  queEstaPasando: '',
  queFunciono: '',
  queNoFunciono: '',
  queEvitar: '',
  algoMas: '',
}

const texto = (v: unknown): string => (typeof v === 'string' ? v : '')

/** Carga lo que se pueda y nunca lanza: es su contrato, para poder mostrar un
 *  encargo viejo o parcialmente roto en vez de una pantalla en blanco. */
export function desdeElEncargo(valor: unknown): EncargoEnFormulario {
  if (typeof valor !== 'object' || valor === null || Array.isArray(valor)) {
    // El arreglo va nuevo, no el de `FORMULARIO_VACIO`: `{ ...obj }` copia una
    // sola capa, así que devolver el spread dejaría a quien reciba esto
    // compartiendo el arreglo con la constante del módulo. Una casilla de
    // canal que se marque mutándolo en el sitio corrompería el «vacío» para
    // todas las llamadas siguientes de la sesión.
    return { ...FORMULARIO_VACIO, canalesDisponibles: [] }
  }
  const o = valor as Record<string, unknown>
  return {
    objetivo: texto(o.objetivo),
    comoSeMide: texto(o.comoSeMide),
    publicacionesPorSemana:
      typeof o.publicacionesPorSemana === 'number' ? String(o.publicacionesPorSemana) : '',
    canalesDisponibles: Array.isArray(o.canalesDisponibles)
      ? o.canalesDisponibles.filter((c): c is string => typeof c === 'string')
      : [],
    queEstaPasando: texto(o.queEstaPasando),
    queFunciono: texto(o.queFunciono),
    queNoFunciono: texto(o.queNoFunciono),
    queEvitar: texto(o.queEvitar),
    algoMas: texto(o.algoMas),
  }
}

export function haciaElEncargo(f: EncargoEnFormulario): unknown {
  const crudo = f.publicacionesPorSemana.trim()
  const numero = Number(crudo)
  return {
    objetivo: f.objetivo.trim(),
    comoSeMide: f.comoSeMide.trim(),
    // Si no es un número, viaja el texto tal cual: `NaN` sobrevive a
    // `JSON.stringify` como `null`, y el esquema lo rechazaría con un mensaje
    // que no menciona la capacidad.
    publicacionesPorSemana: crudo !== '' && Number.isFinite(numero) ? numero : crudo,
    canalesDisponibles: [...f.canalesDisponibles],
    queEstaPasando: f.queEstaPasando.trim(),
    queFunciono: f.queFunciono.trim(),
    queNoFunciono: f.queNoFunciono.trim(),
    queEvitar: f.queEvitar.trim(),
    algoMas: f.algoMas.trim(),
  } satisfies Record<keyof TipoEncargo, unknown>
}

/**
 * `true` si alguno de los CUATRO campos obligatorios está vacío.
 *
 * No reproduce ningún mínimo de longitud del esquema: solo distingue «vacío»
 * de «escrito». Duplicar los mínimos acá crearía una segunda lista de reglas
 * sincronizada a mano, que es la deuda que `pendientes.md` ya registra dos
 * veces.
 */
export function faltanCamposObligatorios(f: EncargoEnFormulario): boolean {
  return (
    f.objetivo.trim() === '' ||
    f.comoSeMide.trim() === '' ||
    f.publicacionesPorSemana.trim() === '' ||
    f.canalesDisponibles.length === 0
  )
}
