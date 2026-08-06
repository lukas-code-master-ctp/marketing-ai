/**
 * A quién avisar cuando se encola una corrida.
 *
 * En la nube la web crea una tarea de Cloud Tasks y esa tarea llama al worker
 * en Cloud Run. En local no hay a quién avisar: el worker de Docker sondea
 * solo, así que el destino es `ninguno` y despertar no hace nada.
 *
 * Recibe el entorno como parámetro en vez de leer `process.env` por dentro,
 * para que la decisión se pueda probar sin ensuciar el proceso de pruebas —
 * la misma forma que `destinoDeConexion` en `@gc/db`.
 */
export type DestinoDelDespertador =
  | { tipo: 'ninguno' }
  | {
      tipo: 'cloud-tasks'
      proyecto: string
      region: string
      cola: string
      /** Sin barra final: se le concatena la ruta del worker. */
      urlDelWorker: string
      /** La cuenta con la que Cloud Tasks firma el token OIDC. */
      cuentaDeServicio: string
      /** El token compartido que el worker exige en `x-token-worker`. */
      token: string
      /** El JSON de la cuenta de servicio, o `null` para usar las del entorno. */
      credenciales: string | null
    }

/**
 * Las cinco que solo existen en la nube. Ninguna tiene consumidor local: si no
 * hay ni una, es que no hay a quién despertar.
 *
 * `WORKER_TOKEN` queda **fuera** de esta lista a propósito, y no es un detalle
 * de estilo. Es la única de las seis con un consumidor local legítimo:
 * `apps/worker/src/main.ts` no arranca sin ella, así que quien levante el
 * worker a mano —`pnpm --filter @gc/worker start`, que CLAUDE.md documenta—
 * tiene que ponerla en el único `.env` que este proyecto permite, el de la
 * raíz. Si contara para decidir si el despertador está configurado, esa
 * configuración perfectamente correcta se leería como «configurado a medias» y
 * cada encolado desde la web y cada `corrida:reanudar` del CLI imprimirían un
 * error rojo por algo que no está roto. Es el mismo error perseguido en vano
 * que este repositorio ya sufrió con `MissingSecret`, y por eso se corta acá.
 */
const REQUERIDAS_DE_LA_NUBE = [
  'CLOUD_TASKS_PROYECTO',
  'CLOUD_TASKS_REGION',
  'CLOUD_TASKS_COLA',
  'WORKER_URL',
  'WORKER_CUENTA_DE_SERVICIO',
] as const

export function destinoDelDespertador(
  env: Record<string, string | undefined>,
): DestinoDelDespertador {
  const presentes = REQUERIDAS_DE_LA_NUBE.filter((nombre) => Boolean(env[nombre]?.trim()))

  // Ninguna de las cinco: es el entorno local, y no hay nada que avisar. Da
  // igual que `WORKER_TOKEN` esté puesta —el worker local la exige— porque
  // sola no configura ningún destino.
  if (presentes.length === 0) return { tipo: 'ninguno' }

  // Algunas sí y otras no: se falla. Quedarse callado dejaría a la web
  // encolando sin despertar a nadie, y el único síntoma sería que generar
  // «tarda cinco minutos» —el intervalo de la red de seguridad— sin ningún
  // error que apunte a la configuración.
  //
  // `WORKER_TOKEN` sí se exige acá: una vez que hay a quién despertar, una
  // tarea sin el token compartido llega al worker y se lleva un 401.
  const faltantes = [...REQUERIDAS_DE_LA_NUBE, 'WORKER_TOKEN' as const].filter(
    (nombre) => !env[nombre]?.trim(),
  )
  if (faltantes.length > 0) {
    throw new Error(
      `El despertador está configurado a medias: faltan ${faltantes.join(', ')}. ` +
        'O están las seis, o ninguna (que es el caso local, donde el worker sondea solo). ' +
        'La excepción es WORKER_TOKEN sola: el worker local la necesita para arrancar, y ' +
        'por sí sola no configura ningún destino.',
    )
  }

  return {
    tipo: 'cloud-tasks',
    proyecto: env.CLOUD_TASKS_PROYECTO!.trim(),
    region: env.CLOUD_TASKS_REGION!.trim(),
    cola: env.CLOUD_TASKS_COLA!.trim(),
    urlDelWorker: env.WORKER_URL!.trim().replace(/\/+$/, ''),
    cuentaDeServicio: env.WORKER_CUENTA_DE_SERVICIO!.trim(),
    token: env.WORKER_TOKEN!.trim(),
    credenciales: env.GOOGLE_CREDENCIALES_JSON?.trim() ? env.GOOGLE_CREDENCIALES_JSON! : null,
  }
}
