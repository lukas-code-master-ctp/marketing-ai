import type { ClienteLlm } from '@gc/ai'
import { esquema, type BaseDeDatos } from '@gc/db'
import { ejecutarFlujo } from '@gc/pipeline'
import {
  crearFlujoEstrategia, crearFlujoGrilla, validarMes, type SalidaP1, type SalidaP2,
} from '@gc/strategy'
import { and, asc, eq, gte, lt } from 'drizzle-orm'
import { resolverMarca } from './marcas.js'

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

export interface FilaDeGrilla {
  fecha: string
  canal: string
  formato: string
  pilar: string
  angulo: string
  derivado: boolean
  /**
   * `grilla:ver` listaba los descartados igual que los vigentes porque ni
   * siquiera seleccionaba la columna, mientras la cabecera de la web sí los
   * excluía de sus conteos. Dos lectores de `plan_slots` en el mismo paquete
   * con nociones distintas de lo que hay en la grilla.
   */
  descartado: boolean
}

export async function verGrilla(
  db: BaseDeDatos,
  organizationId: string,
  args: { slug: string; mes: string },
): Promise<FilaDeGrilla[]> {
  const ref = await resolverMarca(db, organizationId, args.slug)

  // La misma validación que usa `trimestreDe` en `grilla:generar`: dos copias
  // del formato eran dos maneras de que un comando aceptara lo que el otro
  // rechaza.
  validarMes(args.mes)

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
      status: esquema.planSlots.status,
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
    descartado: f.status === 'descartado',
  }))
}
