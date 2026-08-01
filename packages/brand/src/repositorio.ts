import { esquema, type BaseDeDatos } from '@gc/db'
import { permanente } from '@gc/shared'
import { desc, eq, sql } from 'drizzle-orm'
import { validarPerfil, type TipoPerfilDeMarca } from './perfil.js'

export interface ReferenciaDeMarca {
  organizationId: string
  brandId: string
  brandSlug?: string
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

  return db.transaction(async (tx) => {
    // Se bloquea la fila de la marca antes de calcular la versión: sin esto,
    // dos guardados simultáneos leen el mismo máximo, calculan la misma
    // versión y el segundo choca contra la restricción única con un error
    // crudo del driver, fuera de la taxonomía del sistema.
    const [marca] = await tx
      .select({ id: esquema.brands.id })
      .from(esquema.brands)
      .where(eq(esquema.brands.id, ref.brandId))
      .for('update')

    if (!marca) throw permanente(`No existe la marca ${ref.brandSlug ?? ref.brandId}`)

    const [ultimo] = await tx
      .select({ maximo: sql<number | null>`max(${esquema.brandProfiles.version})` })
      .from(esquema.brandProfiles)
      .where(eq(esquema.brandProfiles.brandId, ref.brandId))

    const version = (ultimo?.maximo ?? 0) + 1

    await tx.insert(esquema.brandProfiles).values({
      organizationId: ref.organizationId,
      brandId: ref.brandId,
      version,
      data: perfil,
    })

    return version
  })
}

export async function cargarPerfilVigente(
  db: BaseDeDatos,
  brandId: string,
  nombreVisible?: string,
): Promise<PerfilVigente> {
  const [fila] = await db
    .select()
    .from(esquema.brandProfiles)
    .where(eq(esquema.brandProfiles.brandId, brandId))
    .orderBy(desc(esquema.brandProfiles.version))
    .limit(1)

  if (!fila) throw permanente(`La marca ${nombreVisible ?? brandId} no tiene perfil cargado`)

  return { version: fila.version, perfil: validarPerfil(fila.data) }
}
