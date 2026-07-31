import type { ClienteLlm } from '@gc/ai'
import { guardarPerfil } from '@gc/brand'
import { esquema, type BaseDeDatos } from '@gc/db'
import { ejecutarFlujo } from '@gc/pipeline'
import { permanente } from '@gc/shared'
import { crearFlujoEstrategia, crearFlujoGrilla, type SalidaP1, type SalidaP2 } from '@gc/strategy'
import { and, asc, eq, gte, lt } from 'drizzle-orm'
import { readFile } from 'node:fs/promises'

const ORGANIZACION_POR_DEFECTO = 'Principal'
const SLUG_POR_DEFECTO = 'principal'
const VIOLACION_DE_UNICA = '23505'

export interface ReferenciaResuelta {
  organizationId: string
  brandId: string
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

function esViolacionDeUnica(e: unknown): boolean {
  return (
    typeof e === 'object' &&
    e !== null &&
    (e as { code?: unknown }).code === VIOLACION_DE_UNICA
  )
}

async function resolverMarca(
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
  return { organizationId: marca.organizationId, brandId: marca.id }
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
    return { organizationId, brandId: marca!.id }
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

export async function generarEstrategia(
  db: BaseDeDatos,
  cliente: ClienteLlm,
  organizationId: string,
  args: { slug: string; periodo: string; env?: Record<string, string | undefined> },
): Promise<SalidaP1> {
  const ref = await resolverMarca(db, organizationId, args.slug)
  const flujo = crearFlujoEstrategia({
    cliente,
    ...(args.env !== undefined ? { env: args.env } : {}),
  })
  const r = await ejecutarFlujo(db, flujo, { brandId: ref.brandId, period: args.periodo }, ref)
  return r.salida as SalidaP1
}

export async function generarGrilla(
  db: BaseDeDatos,
  cliente: ClienteLlm,
  organizationId: string,
  args: { slug: string; mes: string; env?: Record<string, string | undefined> },
): Promise<SalidaP2> {
  const ref = await resolverMarca(db, organizationId, args.slug)
  const flujo = crearFlujoGrilla({
    cliente,
    ...(args.env !== undefined ? { env: args.env } : {}),
  })
  const r = await ejecutarFlujo(db, flujo, { brandId: ref.brandId, mes: args.mes }, ref)
  return r.salida as SalidaP2
}

const MES_VALIDO = /^\d{4}-(0[1-9]|1[0-2])$/

export interface FilaDeGrilla {
  fecha: string
  canal: string
  formato: string
  pilar: string
  angulo: string
  derivado: boolean
}

export async function verGrilla(
  db: BaseDeDatos,
  organizationId: string,
  args: { slug: string; mes: string },
): Promise<FilaDeGrilla[]> {
  const ref = await resolverMarca(db, organizationId, args.slug)

  // Sin esta validación un mes mal escrito produce fechas Invalid Date y el
  // usuario recibe un error del driver en vez de saber qué escribió mal.
  if (!MES_VALIDO.test(args.mes)) {
    throw permanente(`Mes inválido "${args.mes}": se espera el formato AAAA-MM`)
  }

  const [anio, mes] = args.mes.split('-').map(Number)
  const desde = new Date(Date.UTC(anio!, mes! - 1, 1))
  const hasta = new Date(Date.UTC(anio!, mes!, 1))

  const filas = await db
    .select({
      scheduledFor: esquema.planSlots.scheduledFor,
      channel: esquema.planSlots.channel,
      format: esquema.planSlots.format,
      pillar: esquema.planSlots.pillar,
      angle: esquema.planSlots.angle,
      sourceSlotId: esquema.planSlots.sourceSlotId,
    })
    .from(esquema.planSlots)
    .innerJoin(esquema.contentPlans, eq(esquema.planSlots.contentPlanId, esquema.contentPlans.id))
    .where(
      and(
        eq(esquema.contentPlans.brandId, ref.brandId),
        gte(esquema.planSlots.scheduledFor, desde),
        lt(esquema.planSlots.scheduledFor, hasta),
      ),
    )
    .orderBy(asc(esquema.planSlots.scheduledFor))

  return filas.map((f) => ({
    fecha: f.scheduledFor.toISOString().slice(0, 16).replace('T', ' '),
    canal: f.channel,
    formato: f.format,
    pilar: f.pillar,
    angulo: f.angle,
    derivado: f.sourceSlotId !== null,
  }))
}
