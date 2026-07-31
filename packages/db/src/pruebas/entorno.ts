import { migrate } from 'drizzle-orm/postgres-js/migrator'
import { fileURLToPath } from 'node:url'
import { crearConexion, type BaseDeDatos } from '../cliente.js'
import { esquema } from '../esquema.js'

const CARPETA_MIGRACIONES = fileURLToPath(new URL('../../migraciones', import.meta.url))

/**
 * Abre una conexión a la base de pruebas, aplica migraciones, vacía las tablas
 * y ejecuta `fn`. Siempre cierra la conexión.
 */
export async function conBaseDeDatosDePrueba(
  fn: (db: BaseDeDatos) => Promise<void>,
): Promise<void> {
  const url = process.env.DATABASE_URL_TEST
  if (!url) throw new Error('Falta DATABASE_URL_TEST')

  const { db, cerrar } = crearConexion(url)
  try {
    await migrate(db, { migrationsFolder: CARPETA_MIGRACIONES })
    await db.delete(esquema.organizations)
    await fn(db)
  } finally {
    await cerrar()
  }
}
