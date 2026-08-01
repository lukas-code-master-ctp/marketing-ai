'use server'

import { clasificarError } from '@gc/shared'
import { revalidatePath } from 'next/cache'
import { conexion, organizacionPorDefecto } from './datos.js'
import { aprobarGrilla, descartarSlot, editarSlot } from '@gc/operaciones'

export type Resultado = { ok: true } | { ok: false; mensaje: string; reintentable: boolean }

/**
 * Resuelve la organización, ejecuta la operación de dominio, revalida la
 * ruta afectada y traduce el error. Los mensajes del dominio ya están en
 * español, ya nombran la marca por su slug y ya explican el remedio: se
 * muestran tal cual, sin envolverlos en un texto genérico.
 */
async function ejecutar(
  ruta: string,
  fn: (db: Awaited<ReturnType<typeof conexion>>, organizationId: string) => Promise<void>,
): Promise<Resultado> {
  const db = conexion()
  try {
    await fn(db, await organizacionPorDefecto(db))
    revalidatePath(ruta)
    return { ok: true }
  } catch (error) {
    return {
      ok: false,
      mensaje: error instanceof Error ? error.message : String(error),
      reintentable: clasificarError(error) === 'transitorio',
    }
  }
}

export async function descartarSlotAccion(
  marca: string,
  mes: string,
  slotId: string,
): Promise<Resultado> {
  return ejecutar(`/${marca}/grilla/${mes}`, (db, organizationId) =>
    descartarSlot(db, organizationId, slotId),
  )
}

export async function editarSlotAccion(
  marca: string,
  mes: string,
  slotId: string,
  campos: { angulo: string; brief: string },
): Promise<Resultado> {
  return ejecutar(`/${marca}/grilla/${mes}`, (db, organizationId) =>
    editarSlot(db, organizationId, slotId, campos),
  )
}

export async function aprobarGrillaAccion(
  marca: string,
  mes: string,
  contentPlanId: string,
): Promise<Resultado> {
  return ejecutar(`/${marca}/grilla/${mes}`, (db, organizationId) =>
    aprobarGrilla(db, organizationId, contentPlanId),
  )
}
