import { drizzle, type PostgresJsDatabase } from 'drizzle-orm/postgres-js'
import postgres from 'postgres'
import { usaAgrupador } from './agrupador.js'
import { esquema } from './esquema.js'

export type BaseDeDatos = PostgresJsDatabase<typeof esquema>

export function crearConexion(url: string): { db: BaseDeDatos; cerrar: () => Promise<void> } {
  const sql = postgres(url, {
    max: 5,
    // Ver `usaAgrupador`: contra PgBouncer en modo transacción las sentencias
    // preparadas no funcionan, y el síntoma solo aparece en producción.
    ...(usaAgrupador(url) ? { prepare: false } : {}),
  })
  return { db: drizzle(sql, { schema: esquema }), cerrar: () => sql.end() }
}
