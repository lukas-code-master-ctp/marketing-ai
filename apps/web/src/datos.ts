import { crearConexion, esquema, type BaseDeDatos } from '@gc/db'
import { resolverOrganizacion } from '@gc/operaciones'
import { asc, eq } from 'drizzle-orm'

/**
 * Next.js reejecuta módulos entre peticiones en desarrollo; una conexión por
 * petición agotaría el pool en minutos. Una variable de módulo normal no
 * alcanza: cada hot reload invalida y reejecuta el módulo, perdiendo la
 * referencia al pool anterior sin cerrarlo — el pool viejo (`max: 5`) queda
 * abierto y cada recarga suma otras 5 conexiones hacia el límite de
 * Postgres. Guardar el pool en `globalThis` sobrevive a la reejecución del
 * módulo; es el workaround estándar para este patrón en Next dev.
 */
const cacheGlobal = globalThis as unknown as { __gcDb__?: BaseDeDatos }

export function conexion(): BaseDeDatos {
  if (!cacheGlobal.__gcDb__) {
    const url = process.env.DATABASE_URL
    if (!url) throw new Error('Falta DATABASE_URL')
    cacheGlobal.__gcDb__ = crearConexion(url).db
  }
  return cacheGlobal.__gcDb__
}

export interface MarcaListada {
  id: string
  slug: string
  name: string
}

export async function marcasDeLaOrganizacion(
  db: BaseDeDatos,
  organizationId: string,
): Promise<MarcaListada[]> {
  return db
    .select({
      id: esquema.brands.id,
      slug: esquema.brands.slug,
      name: esquema.brands.name,
    })
    .from(esquema.brands)
    .where(eq(esquema.brands.organizationId, organizationId))
    .orderBy(asc(esquema.brands.createdAt))
}

export async function organizacionPorDefecto(db: BaseDeDatos): Promise<string> {
  return resolverOrganizacion(db)
}
