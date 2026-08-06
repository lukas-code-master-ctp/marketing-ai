import { GoogleAuth } from 'google-auth-library'
import { destinoDelDespertador } from './destino.js'

/**
 * Segundos que Cloud Tasks espera a que el worker termine antes de dar la
 * tarea por fallida.
 *
 * **Este número está atado a otro que no vive en este repositorio**: el tiempo
 * de espera del servicio de Cloud Run, que se fija con `--timeout` en el
 * `gcloud run deploy` (hoy `--timeout 1200`, o sea 20 minutos). El diseño del
 * bloque declara no negociable la relación *plazo de Cloud Tasks ≥ tiempo de
 * espera de Cloud Run ≥ la generación más lenta con sus reintentos*
 * (`docs/superpowers/specs/2026-08-06-worker-en-la-nube-design.md`). Si el
 * plazo de acá venciera antes que el de Cloud Run, Cloud Tasks daría la tarea
 * por fallida y la reintentaría mientras la primera sigue corriendo: dos
 * workers drenando la misma cola. 1800 ≥ 1200 con holgura; **si alguien baja
 * este valor o sube el `--timeout` de Cloud Run, hay que revisar los dos
 * juntos.**
 */
const PLAZO_DE_DESPACHO_SEG = 1800

/**
 * Cuánto se espera a que la API de Cloud Tasks conteste antes de rendirse.
 *
 * Existe porque `despertarWorker` es de mejor esfuerzo ante **errores**, y sin
 * esto no lo sería ante **lentitud**. Esta llamada ocurre dentro de una Server
 * Action de Vercel, después de que la corrida ya quedó escrita: si Cloud Tasks
 * está degradado y tarda, quien esperaría es el usuario, y pasado el límite de
 * la función de Vercel vería un error sobre una escritura que sí funcionó —
 * exactamente lo que la decisión de «despertar después de encolar, nunca
 * dentro» vino a impedir. Peor todavía, al reintentar se toparía con la guarda
 * contra el doble encolado diciéndole que ya hay una corrida viva.
 *
 * Tres segundos son mucho para una llamada que el diseño estima en unos cien
 * milisegundos, y poco frente a los cinco minutos de la red de seguridad de
 * Cloud Scheduler, que es lo que se paga por rendirse.
 */
const ESPERA_MAXIMA_MS = 3000

/** El ámbito con el que se firma contra la API de administración de Google. */
const AMBITO = 'https://www.googleapis.com/auth/cloud-platform'

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
 *
 * **Habla con la API REST de Cloud Tasks a mano, y no con `@google-cloud/tasks`.**
 * No es purismo: el SDK es inviable dentro del bundle de Next. Su cliente lo
 * genera `google-gax`, que al evaluarse hace `require(path.join(...))` para
 * cargar JSON de configuración —una ruta que webpack no puede analizar y
 * reemplaza por un contexto vacío que lanza `Cannot find module`— y arrastra
 * gRPC y protobuf detrás. Las dos salidas que se intentaron antes fallaron y
 * están documentadas con su medición en `pendientes.md`: `serverExternalPackages`
 * no tuvo **ningún** efecto en esta build, y `webpackIgnore` +
 * `outputFileTracingIncludes` subía los archivos de los dos paquetes nombrados
 * pero **no los de su cierre transitivo** —`outputFileTracingIncludes` es un
 * glob puro: incluye lo que matchea y no vuelve a trazar sus imports—, así que
 * el `import()` resolvía el archivo, lo evaluaba, y explotaba con
 * `MODULE_NOT_FOUND: '@grpc/grpc-js'` en **todas** las generaciones.
 *
 * Crear una tarea es un `POST` con un `Bearer`. El token sale de
 * `google-auth-library`, que ya viaja en el bundle de la web porque
 * `packages/db/src/cliente.ts` la importa de forma estática para el conector
 * de Cloud SQL — o sea que este camino no agrega ni un paquete nuevo al árbol
 * de la web, y saca `@google-cloud/tasks`, `google-gax`, gRPC y protobuf.
 *
 * Ojo con el rango de `google-auth-library` en `package.json`: tiene que ser
 * **el mismo** que declara `packages/db/package.json`. Ver la regla no
 * negociable de `CLAUDE.md` sobre la copia única, y la prueba que la vigila
 * (`packages/db/src/resolucion-google-auth-library.test.ts`).
 */
export async function despertarWorker(
  env: Record<string, string | undefined> = process.env,
): Promise<void> {
  try {
    const destino = destinoDelDespertador(env)
    if (destino.tipo === 'ninguno') return

    // Con `credenciales === null` —dentro de Cloud Run, o en cualquier lado
    // con identidad adherida— el `GoogleAuth` se arma sin `credentials` y la
    // librería resuelve por el servidor de metadatos. En Vercel no hay tal
    // identidad, y el JSON de la cuenta de servicio llega por variable de
    // entorno: la misma que usa la conexión a la base.
    const auth = new GoogleAuth({
      ...(destino.credenciales !== null ? { credentials: JSON.parse(destino.credenciales) } : {}),
      scopes: [AMBITO],
    })
    const token = await auth.getAccessToken()

    const padre = `projects/${destino.proyecto}/locations/${destino.region}/queues/${destino.cola}`
    const respuesta = await fetch(
      `https://cloudtasks.googleapis.com/v2/${padre}/tasks`,
      {
        method: 'POST',
        headers: {
          authorization: `Bearer ${token}`,
          'content-type': 'application/json',
        },
        body: JSON.stringify({
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
            // En JSON, un `Duration` de protobuf se escribe como cadena con
            // sufijo `s` — no como `{ seconds }`, que es la forma del proto y
            // la que usaba el SDK. Con la forma equivocada la API responde 400.
            dispatchDeadline: `${PLAZO_DE_DESPACHO_SEG}s`,
          },
        }),
        signal: AbortSignal.timeout(ESPERA_MAXIMA_MS),
      },
    )

    // `fetch` no lanza por un código de error, así que sin esto un 403 por
    // permisos de IAM o un 404 por una cola mal nombrada pasarían por éxito y
    // el síntoma sería, otra vez, «generar tarda cinco minutos».
    if (!respuesta.ok) {
      throw new Error(
        `Cloud Tasks respondió ${respuesta.status}: ${(await respuesta.text()).slice(0, 500)}`,
      )
    }
  } catch (error) {
    console.error(
      '[despertador] no se pudo avisar al worker; la corrida quedó encolada y la red de ' +
        'seguridad la va a tomar igual, con unos minutos de retraso.',
      error instanceof Error ? error.message : String(error),
    )
  }
}
