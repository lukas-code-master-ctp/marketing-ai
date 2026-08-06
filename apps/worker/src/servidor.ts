import type { BaseDeDatos } from '@gc/db'
import { timingSafeEqual } from 'node:crypto'
import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http'
import { drenarCola } from './drenar.js'
import type { DependenciasDelWorker } from './tomar.js'

export interface OpcionesDelServidor {
  db: BaseDeDatos
  deps: DependenciasDelWorker
  token: string
}

const CABECERA_DEL_TOKEN = 'x-token-worker'
const RUTA = '/trabajar'

/**
 * Compara sin filtrar el largo del token por el tiempo de respuesta.
 *
 * `timingSafeEqual` **lanza** si los búferes miden distinto, así que el largo
 * se compara antes. Eso filtra el largo, que no es secreto: lo que protege es
 * el contenido.
 */
function tokenValido(recibido: string | undefined, esperado: string): boolean {
  if (recibido === undefined) return false
  const a = Buffer.from(recibido, 'utf8')
  const b = Buffer.from(esperado, 'utf8')
  if (a.length !== b.length) return false
  return timingSafeEqual(a, b)
}

function responder(res: ServerResponse, codigo: number, cuerpo: unknown): void {
  const texto = JSON.stringify(cuerpo)
  res.writeHead(codigo, { 'content-type': 'application/json; charset=utf-8' })
  res.end(texto)
}

/**
 * El servidor del worker: una ruta, `POST /trabajar`, que drena la cola.
 *
 * **La autorización real la pone Cloud Run**, que se despliega
 * `--no-allow-unauthenticated` y rechaza toda petición sin token IAM antes de
 * que llegue a este proceso. El token compartido de aquí es un cerrojo más,
 * para que un `--allow-unauthenticated` puesto por error —o heredado de una
 * prueba— no deje esta ruta abierta a internet.
 *
 * El token se comprueba **antes** de mirar ruta y método a propósito: así un
 * llamador sin token recibe 401 para todo y no aprende qué rutas existen.
 *
 * Un turno con corridas fallidas responde **200**, no 500: la petición se
 * atendió bien y las corridas ya quedaron marcadas con su error. Devolver 500
 * haría que Cloud Tasks reintentara generaciones que ya fallaron por su
 * cuenta, y cada reintento vuelve a pagar el modelo. El 500 queda para lo que
 * sí conviene reintentar: que `drenarCola` lance, o sea un fallo de
 * infraestructura como la base caída.
 *
 * `manejarPeticion` no lleva su propio `try/catch`: el único manejador de
 * errores es `manejarErrorNoCapturado`, adjunto abajo con un solo `.catch()`.
 * Antes el cuerpo entero corría dentro de un `void (async () => {...})()` sin
 * `.catch()`, y el `try/catch` de adentro solo envolvía la llamada a
 * `drenarCola`: la comprobación del token y el ruteo quedaban sin protección,
 * así que una excepción ahí —hoy inalcanzable, pero no por diseño— habría
 * dejado la promesa rechazada sin manejar, y desde Node 15 eso termina el
 * proceso. En Cloud Run, cuya única función es sobrevivir para drenar la
 * cola, eso tumbaba la instancia entera en vez de responder 500.
 */
export function crearServidor({ db, deps, token }: OpcionesDelServidor): Server {
  return createServer((req: IncomingMessage, res: ServerResponse) => {
    manejarPeticion(req, res, { db, deps, token }).catch((error: unknown) => {
      manejarErrorNoCapturado(res, error)
    })
  })
}

async function manejarPeticion(
  req: IncomingMessage,
  res: ServerResponse,
  { db, deps, token }: OpcionesDelServidor,
): Promise<void> {
  const recibido = req.headers[CABECERA_DEL_TOKEN]
  if (!tokenValido(typeof recibido === 'string' ? recibido : undefined, token)) {
    responder(res, 401, { error: 'No autorizado.' })
    return
  }

  const ruta = (req.url ?? '').split('?')[0]
  if (req.method !== 'POST' || ruta !== RUTA) {
    responder(res, 404, { error: `Solo existe POST ${RUTA}.` })
    return
  }

  responder(res, 200, await drenarCola(db, deps))
}

/**
 * Único punto donde termina cualquier excepción que escape de
 * `manejarPeticion` —de la comprobación del token, del ruteo, o de
 * `drenarCola`—. Un fallo aquí es de infraestructura: lo único que puede
 * lanzar en ese camino es `drenarCola`, y solo lo hace ante lo que sí
 * conviene reintentar, como la base caída.
 *
 * Comprueba `res.headersSent` antes de responder porque `manejarPeticion`
 * puede haber escrito ya una respuesta completa —el camino feliz de
 * `drenarCola`— antes de que la excepción ocurriera en otra parte; escribir
 * una segunda respuesta sobre una ya enviada vuelve a lanzar. En ese caso
 * solo cierra la conexión y deja constancia en el log.
 */
function manejarErrorNoCapturado(res: ServerResponse, error: unknown): void {
  const texto = error instanceof Error ? error.message : String(error)
  console.error('[worker] fallo de infraestructura al atender la petición:', texto)
  if (res.headersSent) {
    res.end()
    return
  }
  responder(res, 500, { error: texto })
}
