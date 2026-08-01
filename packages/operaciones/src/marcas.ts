import { esquema, type BaseDeDatos } from '@gc/db'
import { esViolacionDeUnica, permanente } from '@gc/shared'
import { and, asc, eq } from 'drizzle-orm'

const ORGANIZACION_POR_DEFECTO = 'Principal'
const SLUG_POR_DEFECTO = 'principal'

export interface ReferenciaResuelta {
  organizationId: string
  brandId: string
  brandSlug?: string
}

export interface OpcionesDeOrganizacion {
  org?: string
  env?: Record<string, string | undefined>
}

/**
 * Bandera, luego variable de entorno, luego la única que exista. Con varias y
 * sin indicación, falla listando los slugs: elegir en silencio es exactamente
 * el defecto que este trabajo viene a cerrar.
 */
export async function resolverOrganizacion(
  db: BaseDeDatos,
  opciones: OpcionesDeOrganizacion = {},
): Promise<string> {
  const env = opciones.env ?? process.env
  const pedido = opciones.org ?? env.ORGANIZACION

  if (pedido) {
    const [org] = await db
      .select({ id: esquema.organizations.id })
      .from(esquema.organizations)
      .where(eq(esquema.organizations.slug, pedido))
    if (!org) throw permanente(`No existe la organización "${pedido}"`)
    return org.id
  }

  const todas = await db
    .select({ id: esquema.organizations.id, slug: esquema.organizations.slug })
    .from(esquema.organizations)
    .orderBy(asc(esquema.organizations.createdAt))

  if (todas.length === 1) return todas[0]!.id

  if (todas.length === 0) {
    const [nueva] = await db
      .insert(esquema.organizations)
      .values({ name: ORGANIZACION_POR_DEFECTO, slug: SLUG_POR_DEFECTO })
      .returning({ id: esquema.organizations.id })
    return nueva!.id
  }

  throw permanente(
    `Hay ${todas.length} organizaciones y no indicaste cuál. Usa --org o la ` +
      `variable ORGANIZACION. Disponibles: ${todas.map((o) => o.slug).join(', ')}`,
  )
}

export async function resolverMarca(
  db: BaseDeDatos,
  organizationId: string,
  slug: string,
): Promise<ReferenciaResuelta> {
  const [marca] = await db
    .select()
    .from(esquema.brands)
    .where(
      and(
        eq(esquema.brands.organizationId, organizationId),
        eq(esquema.brands.slug, slug),
      ),
    )
  if (!marca) throw permanente(`No existe la marca "${slug}" en esta organización`)
  return { organizationId: marca.organizationId, brandId: marca.id, brandSlug: slug }
}

export async function crearMarca(
  db: BaseDeDatos,
  organizationId: string,
  args: { slug: string; nombre: string; presupuesto?: string },
): Promise<ReferenciaResuelta> {
  try {
    const [marca] = await db
      .insert(esquema.brands)
      .values({
        organizationId,
        slug: args.slug,
        name: args.nombre,
        ...(args.presupuesto !== undefined ? { monthlyBudgetUsd: args.presupuesto } : {}),
      })
      .returning()
    return { organizationId, brandId: marca!.id, brandSlug: args.slug }
  } catch (error) {
    if (esViolacionDeUnica(error)) {
      throw permanente(
        `Ya existe una marca con el slug "${args.slug}" en esta organización`,
        error,
      )
    }
    throw error
  }
}
