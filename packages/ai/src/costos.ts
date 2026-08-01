import { esquema, type BaseDeDatos } from '@gc/db'
import { permanente } from '@gc/shared'
import { and, eq, gte, lt, sql } from 'drizzle-orm'
import type { UsoDeLlamada } from './ejecutar.js'

export interface DatosDeLlamada {
  organizationId: string
  brandId?: string
  runId?: string
  uso: UsoDeLlamada
  brandProfileVersion?: number
}

export async function registrarLlamada(db: BaseDeDatos, d: DatosDeLlamada): Promise<void> {
  await db.insert(esquema.aiCalls).values({
    organizationId: d.organizationId,
    brandId: d.brandId ?? null,
    runId: d.runId ?? null,
    task: d.uso.tarea,
    model: d.uso.modelo,
    tokensIn: d.uso.tokensEntrada,
    tokensOut: d.uso.tokensSalida,
    costUsd: d.uso.costoUsd.toFixed(6),
    latencyMs: d.uso.latenciaMs,
    promptHash: d.uso.hashDePrompt,
    brandProfileVersion: d.brandProfileVersion ?? null,
  })
}

/** Devuelve una función lista para pasar como `registrarUso` a `ejecutarTarea`. */
export function crearRegistrador(
  db: BaseDeDatos,
  base: Omit<DatosDeLlamada, 'uso'>,
): (uso: UsoDeLlamada) => Promise<void> {
  return (uso) => registrarLlamada(db, { ...base, uso })
}

function limitesDelMes(mes: Date): { desde: Date; hasta: Date } {
  const desde = new Date(Date.UTC(mes.getUTCFullYear(), mes.getUTCMonth(), 1))
  const hasta = new Date(Date.UTC(mes.getUTCFullYear(), mes.getUTCMonth() + 1, 1))
  return { desde, hasta }
}

export async function gastoDelMes(
  db: BaseDeDatos,
  brandId: string,
  mes: Date,
): Promise<number> {
  const { desde, hasta } = limitesDelMes(mes)
  const [fila] = await db
    .select({ total: sql<string>`coalesce(sum(${esquema.aiCalls.costUsd}), 0)` })
    .from(esquema.aiCalls)
    .where(
      and(
        eq(esquema.aiCalls.brandId, brandId),
        gte(esquema.aiCalls.createdAt, desde),
        lt(esquema.aiCalls.createdAt, hasta),
      ),
    )
  return Number(fila?.total ?? 0)
}

export interface EstadoDePresupuesto {
  gastadoUsd: number
  presupuestoUsd: number
  porcentaje: number
  estado: 'ok' | 'aviso' | 'agotado'
}

const UMBRAL_DE_AVISO = 0.8

export async function verificarPresupuesto(
  db: BaseDeDatos,
  brandId: string,
  mes: Date,
  nombreVisible?: string,
): Promise<EstadoDePresupuesto> {
  const [marca] = await db
    .select({ presupuesto: esquema.brands.monthlyBudgetUsd })
    .from(esquema.brands)
    .where(eq(esquema.brands.id, brandId))
  if (!marca) throw permanente(`No existe la marca ${nombreVisible ?? brandId}`)

  const presupuestoUsd = Number(marca.presupuesto)
  const gastadoUsd = await gastoDelMes(db, brandId, mes)
  const porcentaje = presupuestoUsd === 0 ? 1 : gastadoUsd / presupuestoUsd

  const estado =
    porcentaje >= 1 ? 'agotado' : porcentaje >= UMBRAL_DE_AVISO ? 'aviso' : 'ok'

  return { gastadoUsd, presupuestoUsd, porcentaje, estado }
}

/**
 * Compuerta previa a cualquier tarea de IA. Al agotarse el presupuesto el flujo
 * se detiene con un error permanente: escala a revisión humana, no se reintenta.
 */
export async function exigirPresupuesto(
  db: BaseDeDatos,
  brandId: string,
  mes: Date,
  nombreVisible?: string,
): Promise<EstadoDePresupuesto> {
  const estado = await verificarPresupuesto(db, brandId, mes, nombreVisible)
  if (estado.estado === 'agotado') {
    throw permanente(
      `Presupuesto mensual agotado para la marca ${nombreVisible ?? brandId}: ` +
        `${estado.gastadoUsd.toFixed(2)} de ${estado.presupuestoUsd.toFixed(2)} USD`,
    )
  }
  return estado
}
