import { crearCliente } from '@gc/ai'
import { crearConexion } from '@gc/db'
import { config } from 'dotenv'
import { resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { tomarYEjecutarUna, type ResultadoDeTurno } from './tomar.js'

// Un solo `.env`, en la raíz. Se resuelve desde la ubicación de este archivo y
// no desde el cwd, igual que hacen el CLI y `next.config.ts`: pnpm ejecuta el
// worker con cwd en `apps/worker`.
const RAIZ = fileURLToPath(new URL('../../../', import.meta.url))
config({ path: resolve(RAIZ, '.env') })

const INTERVALO_MS = 2000

/**
 * El bucle es deliberadamente trivial: todo lo que vale la pena probar vive en
 * `tomarYEjecutarUna`. Es el primer proceso de este repositorio que corre
 * indefinidamente, y un bucle colgado no lo detecta ninguna prueba — así que
 * lo mejor que se puede hacer con él es que no tenga nada dentro.
 *
 * Cuando hay trabajo se encadena sin esperar: si acabas de completar una
 * corrida, es probable que haya otra detrás.
 */
async function principal(): Promise<void> {
  // El worker corre siempre local, contra Docker: nunca configura CLOUD_SQL_*,
  // así que `crearConexion` resuelve por `DATABASE_URL` (ver `destinoDeConexion`).
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

  // Sin esto, `docker compose stop` mata el proceso a mitad de corrida y la
  // fila queda `en_curso` con `error` nulo para siempre, indistinguible de una
  // que sigue ejecutándose: nada en el repositorio recupera corridas colgadas.
  // La bandera deja terminar el turno en marcha y sale entre uno y otro; si la
  // señal llega mientras espera, tarda a lo sumo un `INTERVALO_MS` en salir.
  let terminando = false
  const detener = () => {
    terminando = true
    console.log('[worker] señal recibida, se sale al terminar el turno')
  }
  process.on('SIGTERM', detener)
  process.on('SIGINT', detener)

  console.log('[worker] escuchando corridas pendientes')

  while (!terminando) {
    let resultado: ResultadoDeTurno
    try {
      resultado = await tomarYEjecutarUna(db, { cliente })
    } catch (error) {
      // `tomarYEjecutarUna` no lanza por corridas fallidas; si llega algo aquí
      // es la base caída o un fallo de infraestructura. Se registra y se sigue:
      // un worker que muere por eso deja de atender cuando vuelva. Se espera
      // como si no hubiera trabajo, para no girar en vacío contra una base que
      // sigue caída.
      console.error('[worker] fallo inesperado:', error)
      resultado = 'nada'
    }

    if (terminando) break
    if (resultado === 'nada') await new Promise((r) => setTimeout(r, INTERVALO_MS))
  }

  await cerrar()
  console.log('[worker] cerrado')
}

principal().catch((error) => {
  console.error('[worker] no pudo arrancar:', error)
  process.exit(1)
})
