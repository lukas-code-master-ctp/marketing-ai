/** Cómo debe reaccionar el pipeline ante una falla. */
export type ClaseDeError = 'transitorio' | 'permanente' | 'ambiguo'

export class ErrorDeDominio extends Error {
  constructor(
    mensaje: string,
    readonly clase: ClaseDeError,
    readonly causa?: unknown,
  ) {
    super(mensaje)
    this.name = 'ErrorDeDominio'
  }
}

/** Se reintenta con backoff. */
export const transitorio = (mensaje: string, causa?: unknown) =>
  new ErrorDeDominio(mensaje, 'transitorio', causa)

/** No se reintenta: escala a revisión humana. */
export const permanente = (mensaje: string, causa?: unknown) =>
  new ErrorDeDominio(mensaje, 'permanente', causa)

/** Requiere verificar el estado real antes de decidir. */
export const ambiguo = (mensaje: string, causa?: unknown) =>
  new ErrorDeDominio(mensaje, 'ambiguo', causa)

export function clasificarHttp(status: number): ClaseDeError {
  if (status === 408 || status === 429 || status >= 500) return 'transitorio'
  return 'permanente'
}

/**
 * Códigos SQLSTATE que ameritan reintento. La lista es explícita a propósito:
 * clasificar por familia (`08*`) arrastraría códigos futuros por accidente.
 */
const CODIGOS_TRANSITORIOS = new Set([
  '40001', // fallo de serialización
  '40P01', // deadlock detectado
  '08000', // excepción de conexión
  '08003', // conexión inexistente
  '08006', // fallo de conexión
  '08001', // el cliente no pudo establecer la conexión
  '08004', // el servidor rechazó la conexión
  '53300', // demasiadas conexiones
  '55P03', // lock no disponible
  '57P01', // apagado administrativo
  '57014', // consulta cancelada
])

export function clasificarPostgres(codigo: string): ClaseDeError {
  return CODIGOS_TRANSITORIOS.has(codigo) ? 'transitorio' : 'permanente'
}

/**
 * Único punto de clasificación del sistema. El motor de pipeline decide aquí
 * si reintentar, así que cubrir este camino cubre toda llamada a la base del
 * repositorio, incluidas las que se escriban después.
 *
 * Lo desconocido se trata como permanente a propósito: un TypeError es un bug,
 * y reintentar un bug solo lo repite.
 */
export function clasificarError(e: unknown): ClaseDeError {
  if (e instanceof ErrorDeDominio) return e.clase

  if (typeof e === 'object' && e !== null && 'code' in e) {
    const codigo = (e as { code: unknown }).code
    if (typeof codigo === 'string') return clasificarPostgres(codigo)
  }

  return 'permanente'
}

export function esTransitorio(e: unknown): boolean {
  return clasificarError(e) === 'transitorio'
}
