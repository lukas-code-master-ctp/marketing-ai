import { crearConexion, esquema, type BaseDeDatos } from '@gc/db'
import { resolverOrganizacion } from '@gc/operaciones'
import { asc, eq } from 'drizzle-orm'

let cache: BaseDeDatos | undefined

/** Next.js reejecuta módulos entre peticiones en desarrollo; una conexión por
 *  petición agotaría el pool en minutos. */
export function conexion(): BaseDeDatos {
  if (!cache) {
    const url = process.env.DATABASE_URL
    if (!url) throw new Error('Falta DATABASE_URL')
    cache = crearConexion(url).db
  }
  return cache
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
