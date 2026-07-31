import { esquema, type BaseDeDatos } from '@gc/db'
import { permanente } from '@gc/shared'
import { desc, eq, sql } from 'drizzle-orm'
import { validarPerfil, type TipoPerfilDeMarca } from './perfil.js'

export interface ReferenciaDeMarca {
  organizationId: string
  brandId: string
}

export interface PerfilVigente {
  version: number
  perfil: TipoPerfilDeMarca
}

/** Nunca actualiza: cada guardado crea una versión nueva. */
export async function guardarPerfil(
  db: BaseDeDatos,
  ref: ReferenciaDeMarca,
  crudo: unknown,
): Promise<number> {
  const perfil = validarPerfil(crudo)

  const [ultimo] = await db
    .select({ maximo: sql<number | null>`max(${esquema.brandProfiles.version})` })
    .from(esquema.brandProfiles)
    .where(eq(esquema.brandProfiles.brandId, ref.brandId))

  const version = (ultimo?.maximo ?? 0) + 1

  await db.insert(esquema.brandProfiles).values({
    organizationId: ref.organizationId,
    brandId: ref.brandId,
    version,
    data: perfil,
  })

  return version
}

export async function cargarPerfilVigente(
  db: BaseDeDatos,
  brandId: string,
): Promise<PerfilVigente> {
  const [fila] = await db
    .select()
    .from(esquema.brandProfiles)
    .where(eq(esquema.brandProfiles.brandId, brandId))
    .orderBy(desc(esquema.brandProfiles.version))
    .limit(1)

  if (!fila) throw permanente(`La marca ${brandId} no tiene perfil cargado`)

  return { version: fila.version, perfil: validarPerfil(fila.data) }
}
