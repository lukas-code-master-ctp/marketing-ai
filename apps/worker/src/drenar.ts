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
 *
 * **Pero por sí solo no alcanza**, y conviene decir por qué: acotar por
 * *cantidad* solo protege del corte si esas diez corridas caben dentro del
 * tiempo de espera de Cloud Run, y con los números de este repositorio no
 * caben. El peor turno realista de **una** corrida son 180 s —el margen de
 * `stop_grace_period` en `docker-compose.yml`, calculado sobre cinco intentos
 * del motor con espera exponencial hasta 30 s más las llamadas al modelo—, así
 * que diez dan hasta 1800 s contra los 1200 s del `--timeout` de Cloud Run.
 * Por eso el turno se acota **también por tiempo**: ver `PRESUPUESTO_MS`.
 */
export const LIMITE_POR_PETICION = 10

/**
 * Cuánto puede durar un turno antes de cortar entre corridas.
 *
 * **Está calculado contra un número que no vive en este repositorio**: el
 * tiempo de espera del servicio de Cloud Run, que se fija con `--timeout` en
 * el `gcloud run deploy` (hoy `--timeout 1200`, o sea 1.200.000 ms). El diseño
 * del bloque declara no negociable la relación *plazo de Cloud Tasks ≥ tiempo
 * de espera de Cloud Run ≥ la generación más lenta con sus reintentos*
 * (`docs/superpowers/specs/2026-08-06-worker-en-la-nube-design.md`); este
 * presupuesto es lo que hace que el tercer término siga siendo **una**
 * generación y no diez.
 *
 * 900.000 ms deja 300 s de margen sobre los 1.200.000 de Cloud Run: suficiente
 * para que la corrida que ya empezó cuando venció el presupuesto termine —180 s
 * es su peor caso realista— antes de que Cloud Run corte la petición. Si el
 * corte llegara igual, la corrida en vuelo queda `en_curso` con `error` nulo,
 * indistinguible de una viva, y **nada en el repositorio la recupera**: la red
 * de seguridad solo levanta filas en `pendiente`.
 *
 * **Si alguien sube el `--timeout` de Cloud Run o baja este número, hay que
 * revisar los dos juntos.**
 */
export const PRESUPUESTO_MS = 900_000

export interface RecuentoDelDrenado {
  completadas: number
  fallidas: number
  /**
   * Cierto si el turno cortó por el límite, por el presupuesto de tiempo o por
   * una señal de parada — o sea, por cualquier motivo que no sea haberse
   * quedado sin trabajo. Quien llame usa esto para saber que hay que volver.
   */
  quedaTrabajo: boolean
}

export interface OpcionesDelDrenado {
  /** Cuántas corridas como mucho. Por omisión, `LIMITE_POR_PETICION`. */
  limite?: number
  /** Cuánto puede durar el turno. Por omisión, `PRESUPUESTO_MS`. */
  presupuestoMs?: number
  /**
   * Se consulta entre corrida y corrida. Si devuelve cierto, el turno corta.
   *
   * Lo provee `main.ts`, que es el único que sabe si llegó un `SIGTERM`. Sin
   * esto, la bandera de apagado del worker no llegaba nunca hasta acá: la
   * miraba solo el bucle de sondeo local, así que un turno en curso seguía
   * tomando corridas nuevas hasta que mataran el proceso. En Cloud Run, donde
   * el drenado ocurre **dentro** de la petición, eso significaba que la señal
   * no podía acortar un turno en absoluto.
   */
  debeParar?: () => boolean
}

/**
 * Atiende corridas pendientes hasta que no quede ninguna, o hasta que se acabe
 * alguno de los tres presupuestos del turno: cantidad, tiempo y señal.
 *
 * Es todo lo que el servidor HTTP hace, y vive aparte de él para que se pueda
 * probar contra Postgres de verdad sin levantar un puerto. `tomarYEjecutarUna`
 * no lanza por una corrida fallida —solo por un fallo de infraestructura—, así
 * que este bucle no necesita `try`: una corrida rota se cuenta y se sigue, y
 * una base caída sube hasta quien llame, que es quien sabe qué código HTTP
 * corresponde.
 *
 * Los tres cortes se comprueban **entre** una corrida y la siguiente, que es
 * el único punto donde cortar es inofensivo: una corrida a medias quedaría
 * `en_curso` para siempre.
 *
 * El tercer parámetro acepta un número por compatibilidad con los llamadores
 * que solo querían recortar la cantidad —así las pruebas que pasan `1` siguen
 * diciendo lo mismo— o el objeto de opciones completo.
 */
export async function drenarCola(
  db: BaseDeDatos,
  deps: DependenciasDelWorker,
  opciones: number | OpcionesDelDrenado = {},
): Promise<RecuentoDelDrenado> {
  const { limite = LIMITE_POR_PETICION, presupuestoMs = PRESUPUESTO_MS, debeParar } =
    typeof opciones === 'number' ? { limite: opciones } : opciones

  // Un límite no positivo no es una configuración: es un error de quien llama.
  // Sin esta guarda el bucle no daba ni una vuelta y la función devolvía
  // `quedaTrabajo: true` —afirmando que hay trabajo **sin haber consultado la
  // cola**— más un log que decía «turno cortado por el límite de 0 corridas»,
  // como si hubiera atendido algo. Los dos son mentiras sobre lo que pasó, y
  // callarlas dejaría un worker que responde 200 sin trabajar nunca. Lo mismo
  // con el presupuesto: cero o negativo garantiza que ninguna corrida se
  // atienda.
  if (limite < 1 || presupuestoMs < 1) {
    throw new Error(
      `drenarCola recibió límite=${limite} y presupuesto=${presupuestoMs} ms: con cualquiera ` +
        'de los dos en cero o menos no se atendería ni una corrida, y el turno mentiría ' +
        'diciendo que cortó por llegar al tope. Los dos tienen que ser positivos.',
    )
  }

  const corte = Date.now() + presupuestoMs
  let completadas = 0
  let fallidas = 0
  let motivo: string

  while (completadas + fallidas < limite && Date.now() < corte && !debeParar?.()) {
    const resultado = await tomarYEjecutarUna(db, deps)
    if (resultado === 'nada') return { completadas, fallidas, quedaTrabajo: false }
    if (resultado === 'completada') completadas += 1
    else fallidas += 1
  }

  if (completadas + fallidas >= limite) motivo = `el límite de ${limite} corridas`
  else if (debeParar?.()) motivo = 'una señal de apagado'
  else motivo = `el presupuesto de ${presupuestoMs} ms`

  // Que el recorte quede en el log no es adorno: un turno que corta se ve,
  // desde afuera, exactamente igual que uno que vació la cola.
  console.log(`[worker] turno cortado por ${motivo}; queda trabajo para el siguiente`)
  return { completadas, fallidas, quedaTrabajo: true }
}
