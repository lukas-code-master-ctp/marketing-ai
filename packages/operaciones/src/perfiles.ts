import { guardarPerfil } from '@gc/brand'
import { esquema, type BaseDeDatos } from '@gc/db'
import { leerEstrategiaDelTrimestre, type LecturaDeEstrategia } from '@gc/strategy'
import { desc, eq } from 'drizzle-orm'
import { readFile } from 'node:fs/promises'
import { resolverMarca } from './marcas.js'

export interface PerfilConHistorial {
  version: number
  perfil: unknown
  versiones: { version: number; createdAt: Date }[]
}

/**
 * El perfil de partida de una marca recién creada: la forma completa que pide
 * el esquema, con el texto de cada campo reemplazado por lo que hay que
 * escribir ahí.
 *
 * Vive acá y no en la web porque tiene que cumplir `validarPerfil`, y eso lo
 * sabe `@gc/brand` —al que la web no llega—: dejarla del otro lado la volvía
 * un objeto que nadie podía comprobar. Tampoco se reusa `PERFIL_VALIDO`, que
 * es la muestra de una marca concreta: una marca nueva estrenaría su perfil
 * hablando de parcelas de agrado.
 *
 * Valida a propósito, aunque sea texto de relleno: quien abre el editor de una
 * marca nueva tiene que poder guardar y ver crecer la versión, no recibir una
 * lista de reglas rotas que no escribió.
 */
export const PLANTILLA_DE_PERFIL = {
  posicionamiento: {
    categoria: 'En qué categoría compite la marca',
    promesa: 'Qué le promete a quien le compra, en una frase',
    diferenciadores: ['En qué es distinta de las alternativas'],
  },
  publicos: [
    {
      nombre: 'A quién le habla',
      dolor: 'Qué problema concreto tiene hoy esa persona',
      objecion: 'Qué la frena justo antes de decidirse',
    },
  ],
  tono: {
    atributos: ['claro'],
    hacer: ['Qué sí hace la marca cuando escribe'],
    noHacer: ['Qué no hace la marca nunca cuando escribe'],
  },
  lexico: {
    preferido: [],
    prohibido: [],
  },
  pilares: [
    { nombre: 'educacion', descripcion: 'Sobre qué enseña la marca', proporcion: 0.5 },
    { nombre: 'producto', descripcion: 'Qué vende la marca', proporcion: 0.5 },
  ],
  ofertas: [],
  restricciones: {
    disclaimers: [],
  },
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
 *
 * Devuelve `null` —y no lanza— cuando la marca todavía no tiene ninguna
 * versión: desde que la web crea marcas, una marca recién creada sin perfil
 * es un estado normal por el que pasa toda marca nueva, no un error. Lanzar
 * ahí obligaba a quien llamara a envolver la llamada en un `catch` que
 * distinguiera por clase de error, y ese `catch` no podía distinguir este
 * caso de cualquier otro `permanente` que saliera de la misma consulta
 * —empezando por el "no existe la marca" de `resolverMarca`—, así que los
 * confundía todos en el mismo mensaje. Que la marca no exista sigue lanzando.
 */
export async function perfilConHistorial(
  db: BaseDeDatos,
  organizationId: string,
  slug: string,
): Promise<PerfilConHistorial | null> {
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
  if (!vigente) return null

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
