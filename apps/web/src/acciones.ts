'use server'

import { clasificarError } from '@gc/shared'
import { revalidatePath } from 'next/cache'
import { conexion, organizacionPorDefecto } from './datos.js'
import {
  aprobarGrilla,
  cargarPerfilDeObjeto,
  crearMarca,
  descartarSlot,
  editarSlot,
  encolarEstrategia,
  encolarGrilla,
  reabrirGrilla,
  reanudarCorridaEncolada,
} from '@gc/operaciones'

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

/**
 * Crea la marca. Es una escritura corta y no pasa por el worker: no hay nada
 * que generar todavía, solo una fila.
 *
 * Revalida `/` porque ahí vive el selector de marcas del layout raíz, que es
 * lo que cambia al crear una.
 *
 * El presupuesto llega como el texto crudo del campo, que viene vacío cuando
 * la persona no lo llenó: en ese caso no se pasa y manda el valor por omisión
 * de la columna. Ni el slug ni el nombre ni el monto se validan acá — eso vive
 * en `crearMarca`, para que el CLI, que escribe por la misma puerta, no tenga
 * su propia versión de las reglas.
 */
export async function crearMarcaAccion(
  slug: string,
  nombre: string,
  presupuestoUsd: string,
): Promise<Resultado> {
  return ejecutar('/', async (db, organizationId) => {
    await crearMarca(db, organizationId, {
      slug,
      nombre,
      ...(presupuestoUsd !== '' ? { presupuesto: presupuestoUsd } : {}),
    })
    return null
  })
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
 * Devuelve una grilla aprobada a borrador. `reabrirGrilla` solo acepta esa
 * transición: desde `en_ejecucion` o `cerrada` no, porque ahí ya hay
 * publicaciones en vuelo o cerradas y reabrir no las deshace.
 */
export async function reabrirGrillaAccion(marca: string, mes: string): Promise<Resultado> {
  return ejecutar(`/${marca}/grilla/${mes}`, async (db, organizationId) => {
    await reabrirGrilla(db, organizationId, { slug: marca, mes })
    return null
  })
}

/**
 * Encola y devuelve. **No ejecuta**: el worker toma la corrida y la corre. Es
 * lo que permite que esta acción responda al instante sin romper la regla de
 * que la web no hace trabajo largo ni llama al modelo.
 */
export async function encolarGrillaAccion(marca: string, mes: string): Promise<Resultado> {
  return ejecutar(`/${marca}/grilla/${mes}`, async (db, organizationId) => {
    await encolarGrilla(db, organizationId, { slug: marca, mes })
    return null
  })
}

/** La gemela de la anterior para P1. Encola y devuelve, por lo mismo. */
export async function encolarEstrategiaAccion(
  marca: string,
  periodo: string,
): Promise<Resultado> {
  return ejecutar(`/${marca}/estrategia`, async (db, organizationId) => {
    await encolarEstrategia(db, organizationId, { slug: marca, periodo })
    return null
  })
}

/**
 * Devuelve una corrida fallida (o colgada) a la cola.
 *
 * Recibe la ruta a revalidar y no la marca, porque el componente que la llama
 * sirve a las dos pantallas y la ruta ya lleva la marca dentro. Componer
 * `/${marca}/...` aquí obligaría a pasar además de qué pantalla se trata.
 */
export async function reanudarCorridaAccion(ruta: string, runId: string): Promise<Resultado> {
  return ejecutar(ruta, async (db, organizationId) => {
    await reanudarCorridaEncolada(db, organizationId, runId)
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
 *
 * `cargarPerfilDeObjeto` ya devuelve la versión que quedó. Devolverla al
 * cliente es lo que permite que el editor anuncie la versión real en vez de
 * la que traía en props, que es la anterior hasta que la revalidación llega.
 */
export async function guardarPerfilAction(
  slug: string,
  textoJson: string,
): Promise<Resultado<{ version: number }>> {
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

  return ejecutar(`/${slug}/perfil`, (db, organizationId) =>
    cargarPerfilDeObjeto(db, organizationId, { slug, perfil }).then((version) => ({ version })),
  )
}
