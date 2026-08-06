import { Connector, IpAddressTypes } from '@google-cloud/cloud-sql-connector'
import { drizzle, type NodePgDatabase } from 'drizzle-orm/node-postgres'
import { GoogleAuth } from 'google-auth-library'
import pg from 'pg'
import { destinoDeConexion } from './destino.js'
import { esquema } from './esquema.js'

export type BaseDeDatos = NodePgDatabase<typeof esquema>

export type Conexion = { db: BaseDeDatos; cerrar: () => Promise<void> }

/**
 * `Pool` extiende `EventEmitter`, y su `makeIdleListener` interno emite
 * `'error'` sobre el pool cuando un cliente OCIOSO se cae: el servidor
 * reiniciando, un corte de red, o —el caso que importa acá, porque la base
 * se muda a Cloud SQL— el otro extremo cerrando la conexión por inactividad.
 * `postgres-js`, el driver anterior, absorbía esto internamente y solo
 * rechazaba las consultas en vuelo; `node-postgres` no.
 *
 * Un `'error'` emitido sobre un `EventEmitter` sin oyentes se relanza como
 * excepción no atrapada y tumba el proceso — fatal en `apps/worker`, que es
 * un `while` de vida larga sin nada que lo vuelva a levantar. Escuchar acá
 * es lo único que hace falta: el propio pool ya descarta el cliente roto, y
 * la siguiente consulta toma uno nuevo del pool sin intervención.
 *
 * El mensaje se limita al texto del error, sin el objeto completo ni su
 * pila. El motivo fuerte: `pg-pool` le adjunta `err.client = client` al
 * error antes de emitirlo, así que volcar el objeto completo expondría el
 * cliente entero —socket, parámetros de conexión— en cada caída. Además, si
 * la caída se repite —una reconexión masiva tras un corte, por ejemplo—
 * cada línea sigue siendo una sola línea y no ahoga el log.
 */
function noDejarQueUnaConexionOciosaCaidaTumbeElProceso(pool: pg.Pool): void {
  pool.on('error', (error: unknown) => {
    const texto = error instanceof Error ? error.message : String(error)
    console.error(
      `[db] una conexión ociosa del pool se cayó (${texto}). Postgres pudo reiniciarse, cerrar la conexión por inactividad, o hubo un corte de red. El pool descarta el cliente afectado; la siguiente consulta abre uno nuevo.`,
    )
  })
}

/**
 * Abre la conexión que corresponda al entorno. Ver `destinoDeConexion`.
 *
 * `max: 5` es bajo a propósito: en Vercel cada invocación corre en su propio
 * proceso y abre su propio pool, así que el límite de conexiones de la
 * instancia se reparte entre todas las que estén vivas a la vez. El modo de
 * falla —agotar las conexiones— no aparece nunca en local.
 *
 * `urlDePrueba` es opcional y solo existe para el arnés de pruebas
 * (`crearConexionDePrueba`, en `pruebas/entorno.ts`): necesita apuntar a
 * `gestor_test` sin depender de `process.env.DATABASE_URL`, que durante toda
 * la suite apunta a `gestor` —la base de desarrollo— porque `vitest.setup.ts`
 * carga el `.env` de la raíz. Los tres llamadores de producción —el CLI, el
 * worker y `apps/web/src/datos.ts`— llaman sin argumentos y resuelven del
 * entorno como siempre; el único que pasa la URL es ese ayudante.
 */
export async function crearConexion(urlDePrueba?: string): Promise<Conexion> {
  const destino =
    urlDePrueba !== undefined
      ? { tipo: 'url' as const, url: urlDePrueba }
      : destinoDeConexion(process.env)

  if (destino.tipo === 'url') {
    // `pg` es CommonJS: la importación por defecto y después `pg.Pool` es la
    // forma que funciona desde ESM sin depender de la interoperabilidad de
    // nombres, que para este paquete no es estable entre versiones de Node.
    const pool = new pg.Pool({ connectionString: destino.url, max: 5 })
    noDejarQueUnaConexionOciosaCaidaTumbeElProceso(pool)
    return { db: drizzle(pool, { schema: esquema }), cerrar: () => pool.end() }
  }

  // Las credenciales van como objeto y no por `GOOGLE_APPLICATION_CREDENTIALS`,
  // que espera una **ruta a un archivo**: en Vercel no hay archivos que poner.
  // El JSON de la cuenta de servicio viaja en una variable de entorno y se le
  // entrega al conector por su opción `auth`.
  //
  // Con `credenciales === null` —o sea, dentro de Cloud Run— se construye el
  // `GoogleAuth` **sin** `credentials`, y la librería resuelve por el servidor
  // de metadatos la cuenta adherida al servicio. Lo que NO se puede hacer es
  // saltarse el `GoogleAuth` y pasar `new Connector()` a secas: el conector
  // decide si usa lo que le dan con `loginAuth instanceof GoogleAuth`, así que
  // sin ese objeto la petición sale sin credenciales y responde
  // `401 Login Required` sin mencionar nada de esto. Ver la regla no
  // negociable de `CLAUDE.md` sobre la copia única de `google-auth-library`.
  const conector = new Connector({
    auth: new GoogleAuth({
      ...(destino.credenciales !== null
        ? { credentials: JSON.parse(destino.credenciales) }
        : {}),
      scopes: ['https://www.googleapis.com/auth/sqlservice.admin'],
    }),
  })

  // Si `getOptions` rechaza, el `conector` recién construido no se cierra
  // solo. Hoy no hay fuga real —revisado en el paquete: el intervalo de
  // refresco interno solo se arma cuando hay `domainName`, y ese refresco no
  // se rearma si falla antes de establecer conexión—, pero eso es un detalle
  // interno de `@google-cloud/cloud-sql-connector` que `crearConexion` no
  // debería dar por sentado sin decirlo: una versión futura del paquete
  // puede armar el intervalo en otro punto. Cerrarlo explícitamente ante
  // cualquier falla no depende de que ese detalle siga siendo cierto.
  let opciones: Awaited<ReturnType<typeof conector.getOptions>>
  try {
    opciones = await conector.getOptions({
      instanceConnectionName: destino.instancia,
      ipType: IpAddressTypes.PUBLIC,
    })
  } catch (error) {
    conector.close()
    throw error
  }

  const pool = new pg.Pool({
    ...opciones,
    user: destino.usuario,
    password: destino.clave,
    database: destino.base,
    max: 5,
  })
  noDejarQueUnaConexionOciosaCaidaTumbeElProceso(pool)

  return {
    db: drizzle(pool, { schema: esquema }),
    cerrar: async () => {
      await pool.end()
      conector.close()
    },
  }
}
