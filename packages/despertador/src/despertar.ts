import { CloudTasksClient } from '@google-cloud/tasks'
import { destinoDelDespertador } from './destino.js'

/** Segundos que Cloud Tasks espera a que el worker termine antes de dar la tarea por fallida. */
const PLAZO_DE_DESPACHO_SEG = 1800

/**
 * Avisa al worker que hay trabajo, creando una tarea de Cloud Tasks.
 *
 * **Se llama después de encolar, nunca dentro.** Cuando esto corre, la corrida
 * ya está escrita en `pipeline_runs` y la red de seguridad de Cloud Scheduler
 * la va a levantar de todos modos unos minutos después. Por eso todo error se
 * registra y se traga: convertir un problema de configuración de Google en un
 * error visible sobre una escritura que sí funcionó sería peor que tardar.
 *
 * Cloud Tasks es lo que resuelve un nudo que ninguna de las dos plataformas
 * deshace sola: una Server Action de Vercel no puede avisar y seguir —si no
 * espera la respuesta, la función termina y la petición se corta—, y Cloud
 * Run le quita CPU a la instancia en cuanto responde, así que el worker
 * tampoco puede contestar «recibido» y trabajar después. Cloud Tasks espera
 * los minutos por los dos.
 */
export async function despertarWorker(
  env: Record<string, string | undefined> = process.env,
): Promise<void> {
  try {
    const destino = destinoDelDespertador(env)
    if (destino.tipo === 'ninguno') return

    const cliente = new CloudTasksClient(
      destino.credenciales !== null ? { credentials: JSON.parse(destino.credenciales) } : {},
    )

    await cliente.createTask({
      parent: cliente.queuePath(destino.proyecto, destino.region, destino.cola),
      task: {
        httpRequest: {
          httpMethod: 'POST',
          url: `${destino.urlDelWorker}/trabajar`,
          headers: { 'x-token-worker': destino.token },
          // El token OIDC es lo que satisface el `--no-allow-unauthenticated`
          // del servicio. La audiencia es la URL base y no la ruta: Cloud Run
          // la valida contra la URL del servicio.
          oidcToken: {
            serviceAccountEmail: destino.cuentaDeServicio,
            audience: destino.urlDelWorker,
          },
        },
        dispatchDeadline: { seconds: PLAZO_DE_DESPACHO_SEG },
      },
    })
  } catch (error) {
    console.error(
      '[despertador] no se pudo avisar al worker; la corrida quedó encolada y la red de ' +
        'seguridad la va a tomar igual, con unos minutos de retraso.',
      error instanceof Error ? error.message : String(error),
    )
  }
}
