import { drizzle, type NodePgDatabase } from 'drizzle-orm/node-postgres'
import pg from 'pg'
import { esquema } from './esquema.js'

export type BaseDeDatos = NodePgDatabase<typeof esquema>

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
 * pila: si la caída se repite —una reconexión masiva tras un corte, por
 * ejemplo— cada línea sigue siendo una sola línea y no ahoga el log.
 */
function noDejarQueUnaConexionOciosaCaidaTumbeElProceso(pool: pg.Pool): void {
  pool.on('error', (error: unknown) => {
    const texto = error instanceof Error ? error.message : String(error)
    console.error(
      `[db] una conexión ociosa del pool se cayó (${texto}). Postgres pudo reiniciarse, cerrar la conexión por inactividad, o hubo un corte de red. El pool descarta el cliente afectado; la siguiente consulta abre uno nuevo.`,
    )
  })
}

export function crearConexion(url: string): { db: BaseDeDatos; cerrar: () => Promise<void> } {
  // `pg` es CommonJS: la importación por defecto y después `pg.Pool` es la
  // forma que funciona desde ESM sin depender de la interoperabilidad de
  // nombres, que para este paquete no es estable entre versiones de Node.
  const pool = new pg.Pool({ connectionString: url, max: 5 })
  noDejarQueUnaConexionOciosaCaidaTumbeElProceso(pool)
  return { db: drizzle(pool, { schema: esquema }), cerrar: () => pool.end() }
}
