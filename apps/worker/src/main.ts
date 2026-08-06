import { crearCliente } from '@gc/ai'
import { crearConexion } from '@gc/db'
import { config } from 'dotenv'
import { resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { drenarCola } from './drenar.js'
import { crearServidor } from './servidor.js'

// Un solo `.env`, en la raíz. Se resuelve desde la ubicación de este archivo y
// no desde el cwd, igual que hacen el CLI y `next.config.ts`: pnpm ejecuta el
// worker con cwd en `apps/worker`.
//
// En Cloud Run ese archivo no existe y `dotenv` no se queja: las variables
// llegan del entorno del servicio. `pendientes.md` registraba esta línea como
// una desviación del diseño pensando en el despliegue; queda comprobado que
// es inofensiva, y por eso se conserva en vez de complicarla con una rama.
const RAIZ = fileURLToPath(new URL('../../../', import.meta.url))
config({ path: resolve(RAIZ, '.env') })

const PUERTO = Number(process.env.PORT ?? 8080)

/**
 * El worker ya no es un bucle: es un servidor con una ruta que drena la cola.
 * Lo despierta Cloud Tasks cuando la web encola, y Cloud Scheduler cada pocos
 * minutos como red de seguridad. Entre llamada y llamada la instancia de Cloud
 * Run se apaga sola, que es lo que hace que esto no cueste nada.
 *
 * El sondeo sobrevive **solo para desarrollo local**, donde no hay ni Cloud
 * Tasks ni Cloud Scheduler: lo enciende `SONDEO_MS`, que en Cloud Run no se
 * declara. Es el mismo trato que `destinoDeConexion` le da a Cloud SQL —el
 * camino de la nube no se toca nunca en local— y tiene el mismo precio, que
 * conviene decir en voz alta: **el despertar por Cloud Tasks solo se ejercita
 * desplegado**.
 */
async function principal(): Promise<void> {
  // Sin token no se arranca. Misma política que con `OPENROUTER_API_KEY`:
  // prefiere no levantar antes que levantar sin la comprobación puesta, que
  // dejaría la ruta abierta si además alguien despliega el servicio como
  // público.
  const token = process.env.WORKER_TOKEN?.trim()
  if (!token) {
    throw new Error(
      'Falta WORKER_TOKEN. Es el token compartido que el worker exige en la cabecera ' +
        '`x-token-worker`, y tiene que valer lo mismo aquí que en quien crea las tareas.',
    )
  }

  const { db, cerrar } = await crearConexion()

  // Misma construcción que el CLI, con una diferencia: `CARPETA_DE_MUESTRAS`
  // se resuelve contra la raíz del repositorio y no contra donde se escribió
  // el comando. El CLI lo hace contra `INIT_CWD` porque es una herramienta que
  // alguien invoca parado en algún lado; el worker es un proceso que se
  // levanta y se queda, y su cwd no significa nada.
  const cliente = crearCliente({
    env: process.env,
    ...(process.env.CARPETA_DE_MUESTRAS !== undefined
      ? { carpetaDeMuestras: resolve(RAIZ, process.env.CARPETA_DE_MUESTRAS) }
      : {}),
  })

  const deps = { cliente }
  const servidor = crearServidor({ db, deps, token })

  let terminando = false

  // El sondeo local. Se lanza sin esperarlo: convive con el servidor en el
  // mismo proceso y las dos vías llaman a `drenarCola`, que es segura de
  // ejecutar en paralelo porque `tomarCorridaPendiente` toma con
  // `FOR UPDATE SKIP LOCKED` — dos drenados nunca se llevan la misma corrida.
  //
  // La promesa que devuelve esta IIFE se guarda en `sondeoEnCurso`: es lo que
  // `detener()` espera antes de cerrar la conexión. `servidor.close()` solo
  // depende de las conexiones HTTP abiertas, sin ninguna relación con este
  // bucle — sin esperar esta promesa, `cerrar()` (`pool.end()`) podía correr
  // en paralelo con las consultas que le quedan a una corrida a mitad de
  // `drenarCola`, tumbándolas a mitad de camino.
  const sondeoMs = Number(process.env.SONDEO_MS ?? 0)
  let sondeoEnCurso: Promise<void> | undefined
  if (sondeoMs > 0) {
    console.log(`[worker] sondeo local cada ${sondeoMs} ms (sustituto de Cloud Scheduler)`)
    sondeoEnCurso = (async () => {
      while (!terminando) {
        try {
          await drenarCola(db, deps)
        } catch (error) {
          // La base caída, típicamente. Se registra y se sigue: un worker que
          // muere por esto deja de atender cuando la base vuelva.
          console.error('[worker] fallo inesperado en el sondeo:', error)
        }
        if (terminando) break
        await new Promise((r) => setTimeout(r, sondeoMs))
      }
    })()
  }

  // Sin esto, `docker compose stop` mata el proceso a mitad de corrida y la
  // fila queda `en_curso` con `error` nulo para siempre, indistinguible de una
  // que sigue ejecutándose: nada en el repositorio recupera corridas colgadas.
  // En Cloud Run el papel es el mismo, con la diferencia de que allá la señal
  // solo llega a una instancia ociosa.
  let deteniendo = false
  const detener = () => {
    // Idempotente: si llegan dos señales antes de que termine el primer
    // cierre —SIGTERM seguido de SIGINT, o dos SIGTERM—, la segunda no vuelve
    // a llamar a `servidor.close()` ni a `cerrar()`.
    if (deteniendo) return
    deteniendo = true
    terminando = true
    console.log('[worker] señal recibida, se deja de aceptar peticiones')
    servidor.close(async () => {
      // Si el bucle de sondeo está a mitad de una iteración —incluyendo un
      // `drenarCola` con varias escrituras a la base—, hay que esperar a que
      // termine antes de cerrar el pool. Si no hay sondeo (Cloud Run, donde
      // `SONDEO_MS` no está), `sondeoEnCurso` es `undefined` y no se espera
      // nada.
      await sondeoEnCurso
      await cerrar()
      console.log('[worker] cerrado')
    })
  }
  process.on('SIGTERM', detener)
  process.on('SIGINT', detener)

  servidor.listen(PUERTO, () => {
    console.log(`[worker] escuchando en el puerto ${PUERTO}`)
  })
}

principal().catch((error) => {
  console.error('[worker] no pudo arrancar:', error)
  process.exit(1)
})
