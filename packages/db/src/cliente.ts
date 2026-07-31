import { drizzle, type PostgresJsDatabase } from 'drizzle-orm/postgres-js'
import postgres from 'postgres'
import { esquema } from './esquema.js'

export type BaseDeDatos = PostgresJsDatabase<typeof esquema>

export function crearConexion(url: string): { db: BaseDeDatos; cerrar: () => Promise<void> } {
  const sql = postgres(url, { max: 5 })
  return { db: drizzle(sql, { schema: esquema }), cerrar: () => sql.end() }
}
