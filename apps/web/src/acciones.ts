'use server'

import { clasificarError } from '@gc/shared'
import { revalidatePath } from 'next/cache'
import { conexion, organizacionPorDefecto } from './datos.js'
import { aprobarGrilla, cargarPerfilDeObjeto, descartarSlot, editarSlot } from '@gc/operaciones'

/**
 * `null` por defecto y no `void`: con `void` la propiedad `datos` seguiría
 * siendo obligatoria y las cuatro acciones que no devuelven nada tendrían que
 * declararla igual. Con `null`, `ejecutar` devuelve lo que devuelva su
 * callback y ninguna de ellas se toca.
 */
export type Resultado<T = null> =
  | { ok: true; datos: T }
  | { ok: false; mensaje: string; reintentable: boolean }

/**
 * Resuelve la organización, ejecuta la operación de dominio, revalida la
 * ruta afectada y traduce el error. Los mensajes del dominio ya están en
 * español, ya nombran la marca por su slug y ya explican el remedio: se
 * muestran tal cual, sin envolverlos en un texto genérico.
 */
async function ejecutar<T = null>(
  ruta: string,
  fn: (db: Awaited<ReturnType<typeof conexion>>, organizationId: string) => Promise<T>,
): Promise<Resultado<T>> {
  const db = conexion()
  try {
    const datos = await fn(db, await organizacionPorDefecto(db))
    revalidatePath(ruta)
    return { ok: true, datos }
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
  return ejecutar(`/${marca}/grilla/${mes}`, async (db, organizationId) => {
    await descartarSlot(db, organizationId, slotId)
    return null
  })
}

export async function editarSlotAccion(
  marca: string,
  mes: string,
  slotId: string,
  campos: { angulo: string; brief: string },
): Promise<Resultado> {
  return ejecutar(`/${marca}/grilla/${mes}`, async (db, organizationId) => {
    await editarSlot(db, organizationId, slotId, campos)
    return null
  })
}

export async function aprobarGrillaAccion(
  marca: string,
  mes: string,
  contentPlanId: string,
): Promise<Resultado> {
  return ejecutar(`/${marca}/grilla/${mes}`, async (db, organizationId) => {
    await aprobarGrilla(db, organizationId, contentPlanId)
    return null
  })
}

/**
 * El JSON se parsea antes de tocar la base: un error de sintaxis nunca llega
 * a `cargarPerfilDeObjeto`. Si parsea, esa función ya valida con
 * `validarPerfil` y ya crea una versión nueva — un perfil que no cumple sus
 * reglas (proporciones que no suman 1, un pilar que no es snake_case, etc.)
 * vuelve como error `permanente` con el detalle de cuál regla falló, y ese
 * mensaje es el que ve el usuario tal cual.
 */
export async function guardarPerfilAction(slug: string, textoJson: string): Promise<Resultado> {
  let perfil: unknown
  try {
    perfil = JSON.parse(textoJson)
  } catch (error) {
    return {
      ok: false,
      mensaje: `El texto no es JSON válido: ${error instanceof Error ? error.message : String(error)}`,
      reintentable: false,
    }
  }

  return ejecutar(`/${slug}/perfil`, async (db, organizationId) => {
    await cargarPerfilDeObjeto(db, organizationId, { slug, perfil })
    return null
  })
}
