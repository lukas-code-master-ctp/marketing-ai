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
  /**
   * Si no existe ninguna organización, ¿se crea la por defecto?
   *
   * Por defecto `true`, que es lo que el CLI necesita para que un clon nuevo
   * arranque con un solo comando. La web pasa `false`: resuelve la
   * organización en cada petición, incluidas las de lectura, y con esto
   * activado un `GET /` escribía en la base — además por la rama que no es
   * segura ante concurrencia.
   */
  crearSiFalta?: boolean
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
    if (opciones.crearSiFalta === false) {
      throw permanente(
        'No hay ninguna organización en la base. Créala desde la línea de comandos con ' +
          '"pnpm cli marca:crear --slug <slug> --nombre <nombre>", que crea la organización ' +
          'por defecto junto con la primera marca.',
      )
    }

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

/**
 * El slug es un segmento de URL (`/parcelas/grilla/2026-09`) y la clave por la
 * que el CLI, la web y el worker nombran la marca. Validar con expresión
 * regular es correcto acá: es entrada de una persona, no salida de un modelo.
 */
const SLUG_DE_MARCA = /^[a-z0-9]+(?:-[a-z0-9]+)*$/
/** `numeric(10, 2)`: dólares con hasta dos decimales y punto, nunca coma. */
const MONTO_USD = /^\d{1,8}(?:\.\d{1,2})?$/

/**
 * Crea la marca, validando antes de tocar la base.
 *
 * La validación vive acá y no en el formulario web porque el CLI escribe por
 * esta misma puerta, y porque el error tiene que salir clasificado como
 * `permanente`: reintentar un slug con espacios no lo arregla. Sin esto, un
 * presupuesto con coma llegaba a Postgres y volvía como
 * `invalid input syntax for type numeric` —en inglés y nombrando un tipo de
 * la base— a una persona que solo escribió "25,50" en un formulario.
 */
export async function crearMarca(
  db: BaseDeDatos,
  organizationId: string,
  args: { slug: string; nombre: string; presupuesto?: string },
): Promise<ReferenciaResuelta> {
  if (!SLUG_DE_MARCA.test(args.slug)) {
    throw permanente(
      `El slug "${args.slug}" no sirve como identificador de marca: usa solo ` +
        'minúsculas, números y guiones, por ejemplo "mi-marca". Es lo que aparece ' +
        'en la dirección de cada pantalla.',
    )
  }

  if (args.nombre.trim() === '') {
    throw permanente('El nombre de la marca no puede quedar en blanco')
  }

  if (args.presupuesto !== undefined && !MONTO_USD.test(args.presupuesto)) {
    throw permanente(
      `El presupuesto "${args.presupuesto}" no es un monto válido: escríbelo en ` +
        'dólares, con punto y hasta dos decimales, por ejemplo 25 o 25.50.',
    )
  }

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
