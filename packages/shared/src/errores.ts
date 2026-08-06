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
 * Códigos de error de red que Node adjunta como `.code` cuando falla el
 * intento de conectar por TCP. No son SQLSTATE —ni el formato coincide: un
 * SQLSTATE son siempre cinco caracteres, esto son mnemónicos de `errno`— así
 * que viven en un conjunto aparte y no se mezclan con `CODIGOS_TRANSITORIOS`.
 * `pg` no los envuelve: los reemite tal cual desde el socket
 * (`connection.js`, `reportStreamError`), así que lo que ve `clasificarError`
 * es exactamente lo que produce Node.
 *
 * Los tres se consideran transitorios, cada uno por una razón distinta:
 * - `ECONNRESET`: el otro extremo cortó una conexión que sí se había
 *   establecido. Un reintento abre una conexión nueva y puede completarse.
 * - `ETIMEDOUT`: el intento de conectar no obtuvo respuesta a tiempo. Puede
 *   deberse a congestión momentánea de la red.
 * - `ECONNREFUSED`: nadie escucha del otro lado — el caso típico es la
 *   instancia de Cloud SQL apagada (ver CLAUDE.md). El reintento va a fallar
 *   exactamente igual mientras siga apagada, pero reintentar no hace daño:
 *   el backoff exponencial ya acota cuántas veces se repite antes de escalar
 *   a revisión humana.
 *
 * Deliberadamente NO incluye `ENOTFOUND`: sale de una resolución DNS
 * fallida, que en este sistema casi siempre es una `CLOUD_SQL_INSTANCIA` (o
 * el nombre de host derivado de ella) mal escrita. Reintentar una
 * configuración incorrecta no la arregla, solo demora el error real.
 */
const CODIGOS_DE_RED_TRANSITORIOS = new Set(['ECONNRESET', 'ETIMEDOUT', 'ECONNREFUSED'])

/**
 * Dos fallos de conexión de `pg`/`pg-pool` no traen `.code`: son
 * `new Error(mensaje)` a secas, así que la única señal disponible es el
 * mensaje. Es una comparación de texto, frágil por naturaleza —se rompe si
 * una versión futura del driver cambia la redacción— pero es la única que el
 * driver da. Por eso se compara por igualdad exacta contra mensajes
 * conocidos y no por subcadena: una subcadena como "timeout" o "connection"
 * atraparía errores de aplicación sin relación con la red, por ejemplo un
 * `statement_timeout` de una consulta lenta a propósito.
 *
 * - `'Connection terminated unexpectedly'`: el socket se cierra mientras hay
 *   una consulta en curso (`pg/lib/client.js`, el `on('end', …)` del
 *   `Connection`). Es justo el escenario del backoff: una conexión que se
 *   cae en vuelo contra una base remota.
 * - `'timeout exceeded when trying to connect'`: se agotó el tiempo
 *   esperando un cliente libre del pool (`pg-pool/index.js`, `connect`). Con
 *   `max: 5` (ver `crearConexion`) esto puede pasar por carga momentánea, no
 *   solo por una base caída.
 *
 * Deliberadamente NO incluye `'Connection terminated due to connection
 * timeout'` (otro mensaje real de `pg-pool`, para cuando el timeout llega
 * después de obtener el cliente): no estaba entre los casos que motivaron
 * este cambio y agregarlo sin un caso concreto que lo pida sería la misma
 * clasificación por bulto que `CODIGOS_TRANSITORIOS` evita a propósito.
 */
const MENSAJES_DE_RED_TRANSITORIOS = new Set([
  'Connection terminated unexpectedly',
  'timeout exceeded when trying to connect',
])

const VIOLACION_DE_UNICA = '23505'

/**
 * Vive junto a `clasificarPostgres` porque es el mismo trabajo: mirar el
 * `code` de un error del driver. Tenerlo aquí evita que quien necesite el
 * 23503 mañana encuentre dos precedentes que se contradicen y agregue un
 * tercer literal en otro archivo.
 */
export function esViolacionDeUnica(e: unknown): boolean {
  return (
    typeof e === 'object' &&
    e !== null &&
    (e as { code?: unknown }).code === VIOLACION_DE_UNICA
  )
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
    if (typeof codigo === 'string') {
      if (CODIGOS_DE_RED_TRANSITORIOS.has(codigo)) return 'transitorio'
      return clasificarPostgres(codigo)
    }
  }

  // Los dos fallos de conexión que no traen `.code`. Ver el comentario de
  // `MENSAJES_DE_RED_TRANSITORIOS`.
  if (e instanceof Error && MENSAJES_DE_RED_TRANSITORIOS.has(e.message)) {
    return 'transitorio'
  }

  return 'permanente'
}

export function esTransitorio(e: unknown): boolean {
  return clasificarError(e) === 'transitorio'
}
