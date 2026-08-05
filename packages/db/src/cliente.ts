import { drizzle, type NodePgDatabase } from 'drizzle-orm/node-postgres'
import pg from 'pg'
import { esquema } from './esquema.js'

export type BaseDeDatos = NodePgDatabase<typeof esquema>

export function crearConexion(url: string): { db: BaseDeDatos; cerrar: () => Promise<void> } {
  // `pg` es CommonJS: la importación por defecto y después `pg.Pool` es la
  // forma que funciona desde ESM sin depender de la interoperabilidad de
  // nombres, que para este paquete no es estable entre versiones de Node.
  const pool = new pg.Pool({ connectionString: url, max: 5 })
  return { db: drizzle(pool, { schema: esquema }), cerrar: () => pool.end() }
}
