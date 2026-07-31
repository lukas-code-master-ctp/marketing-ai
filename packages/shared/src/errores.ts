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

export function esTransitorio(e: unknown): boolean {
  return e instanceof ErrorDeDominio && e.clase === 'transitorio'
}
