import type { ClienteLlm } from '@gc/ai'
import type { BaseDeDatos } from '@gc/db'
import { resolverMarca } from '@gc/operaciones'
import { ejecutarFlujo } from '@gc/pipeline'
import { crearFlujoEstrategia, type SalidaP1 } from './p1.js'
import { crearFlujoGrilla, type SalidaP2 } from './p2.js'

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
