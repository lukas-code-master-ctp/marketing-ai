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
 * carga el `.env` de la raíz. Los cuatro llamadores reales (CLI, worker,
 * `apps/web/src/datos.ts` y el propio ayudante de pruebas) llaman sin
 * argumentos y resuelven del entorno como siempre.
 */
export async function crearConexion(urlDePrueba?: string): Promise<Conexion> {
  const destino = urlDePrueba !== undefined ? { tipo: 'url' as const, url: urlDePrueba } : destinoDeConexion(process.env)

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
  // entrega al conector por su opción `auth`. Un `new Connector()` a secas cae
  // a las credenciales por omisión, que en Vercel no existen — y eso solo se
  // descubre desplegando.
  const conector = new Connector({
    auth: new GoogleAuth({
      credentials: JSON.parse(destino.credenciales),
      scopes: ['https://www.googleapis.com/auth/sqlservice.admin'],
    }),
  })
  const opciones = await conector.getOptions({
    instanceConnectionName: destino.instancia,
    ipType: IpAddressTypes.PUBLIC,
  })

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
