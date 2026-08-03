import { guardarPerfil } from '@gc/brand'
import { esquema, type BaseDeDatos } from '@gc/db'
import { permanente } from '@gc/shared'
import { leerEstrategiaDelTrimestre, type LecturaDeEstrategia } from '@gc/strategy'
import { desc, eq } from 'drizzle-orm'
import { readFile } from 'node:fs/promises'
import { resolverMarca } from './marcas.js'

export interface PerfilConHistorial {
  version: number
  perfil: unknown
  versiones: { version: number; createdAt: Date }[]
}

export async function cargarPerfilDeObjeto(
  db: BaseDeDatos,
  organizationId: string,
  args: { slug: string; perfil: unknown },
): Promise<number> {
  const ref = await resolverMarca(db, organizationId, args.slug)
  return guardarPerfil(db, ref, args.perfil)
}

export async function cargarPerfilDeArchivo(
  db: BaseDeDatos,
  organizationId: string,
  args: { slug: string; archivo: string },
): Promise<number> {
  const crudo = JSON.parse(await readFile(args.archivo, 'utf8')) as unknown
  return cargarPerfilDeObjeto(db, organizationId, { slug: args.slug, perfil: crudo })
}

/**
 * El perfil vigente (la versión más alta) más el historial completo de
 * versiones, para que la pantalla de edición muestre ambos sin dos
 * resoluciones de marca. `perfil` viaja como `unknown`: quien lo consume es
 * el textarea de edición, no un lector que necesite el tipo validado.
 */
export async function perfilConHistorial(
  db: BaseDeDatos,
  organizationId: string,
  slug: string,
): Promise<PerfilConHistorial> {
  const ref = await resolverMarca(db, organizationId, slug)

  const filas = await db
    .select({
      version: esquema.brandProfiles.version,
      createdAt: esquema.brandProfiles.createdAt,
      data: esquema.brandProfiles.data,
    })
    .from(esquema.brandProfiles)
    .where(eq(esquema.brandProfiles.brandId, ref.brandId))
    .orderBy(desc(esquema.brandProfiles.version))

  const vigente = filas[0]
  if (!vigente) throw permanente(`La marca ${ref.brandSlug ?? slug} no tiene perfil cargado`)

  return {
    version: vigente.version,
    perfil: vigente.data,
    versiones: filas.map((f) => ({ version: f.version, createdAt: f.createdAt })),
  }
}

/**
 * La estrategia del trimestre al que pertenece `mes`, por slug de marca.
 *
 * `archivadas: 'incluir'` porque alimenta una vista de solo lectura: mostrar
 * la fila con su estado —"Archivada" incluido— es más útil que esconderla.
 * La política va explícita aquí, que es el punto de haberla vuelto un
 * parámetro; antes era una diferencia silenciosa con la gemela de `grilla.ts`.
 *
 * Devuelve la unión y no `| null`: la página necesita distinguir "no hay" de
 * "hay pero está corrupta", y antes esto entregaba la columna cruda sin
 * validar y la dejaba parseando por su cuenta.
 */
export async function estrategiaDelTrimestre(
  db: BaseDeDatos,
  organizationId: string,
  slug: string,
  mes: string,
): Promise<LecturaDeEstrategia> {
  const ref = await resolverMarca(db, organizationId, slug)
  return leerEstrategiaDelTrimestre(db, ref.brandId, mes, { archivadas: 'incluir' })
}
