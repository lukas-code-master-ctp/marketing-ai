import type { BaseDeDatos } from '@gc/db'
import { tomarYEjecutarUna, type DependenciasDelWorker } from './tomar.js'

/**
 * Cuántas corridas atiende un turno como mucho.
 *
 * El límite existe por el tiempo de espera de Cloud Run, no por rendimiento.
 * Sin él, una cola larga se atiende entera dentro de una sola petición HTTP y
 * el corte llega a mitad de una generación: esa corrida queda `en_curso` para
 * siempre, que es el modo de falla que nada en este repositorio recupera solo.
 * Con límite, el turno corta entre una corrida y la siguiente —el único punto
 * donde cortar es inofensivo— y el resto lo levanta la red de seguridad de
 * Cloud Scheduler unos minutos después.
 *
 * Diez es holgado: el sistema hace del orden de diez generaciones al mes.
 */
export const LIMITE_POR_PETICION = 10

export interface RecuentoDelDrenado {
  completadas: number
  fallidas: number
  /** Cierto solo si el turno cortó por el límite, no por quedarse sin trabajo. */
  quedaTrabajo: boolean
}

/**
 * Atiende corridas pendientes hasta que no quede ninguna, o hasta el límite.
 *
 * Es todo lo que el servidor HTTP hace, y vive aparte de él para que se pueda
 * probar contra Postgres de verdad sin levantar un puerto. `tomarYEjecutarUna`
 * no lanza por una corrida fallida —solo por un fallo de infraestructura—, así
 * que este bucle no necesita `try`: una corrida rota se cuenta y se sigue, y
 * una base caída sube hasta quien llame, que es quien sabe qué código HTTP
 * corresponde.
 */
export async function drenarCola(
  db: BaseDeDatos,
  deps: DependenciasDelWorker,
  limite: number = LIMITE_POR_PETICION,
): Promise<RecuentoDelDrenado> {
  let completadas = 0
  let fallidas = 0

  while (completadas + fallidas < limite) {
    const resultado = await tomarYEjecutarUna(db, deps)
    if (resultado === 'nada') return { completadas, fallidas, quedaTrabajo: false }
    if (resultado === 'completada') completadas += 1
    else fallidas += 1
  }

  // Que el recorte quede en el log no es adorno: un turno que corta por el
  // límite se ve, desde afuera, exactamente igual que uno que vació la cola.
  console.log(
    `[worker] turno cortado por el límite de ${limite} corridas; queda trabajo para el siguiente`,
  )
  return { completadas, fallidas, quedaTrabajo: true }
}
