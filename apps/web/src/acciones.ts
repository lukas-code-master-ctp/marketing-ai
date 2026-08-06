'use server'

import { despertarWorker } from '@gc/despertador'
import { clasificarError } from '@gc/shared'
import { revalidatePath } from 'next/cache'
import { sesionActual } from './auth.js'
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
 * Resuelve la sesión, ejecuta la operación de dominio, revalida la ruta y
 * traduce el error. Los mensajes del dominio ya están en español, ya nombran
 * la marca por su slug y ya explican el remedio: se muestran tal cual, sin
 * envolverlos en un texto genérico.
 *
 * **La comprobación de sesión vive aquí y no en las páginas a propósito.** Una
 * Server Action es un endpoint HTTP con identificador estable: cualquiera que
 * lo conozca puede llamarlo sin pasar nunca por la página que lo renderiza, así
 * que proteger el componente de servidor no protege la acción. Lo que protege
 * es **pasar por este ayudante**, no vivir en este archivo: una acción nueva
 * que lo llame queda protegida por construcción, y una que no lo use se ve en
 * la revisión — así viva acá mismo o en otro archivo. Un `'use server'`
 * declarado en línea dentro de una página (como en
 * `src/app/entrar/page.tsx`, que por eso mismo tiene que ser alcanzable sin
 * sesión) tampoco pasa por aquí y queda igual de fuera de este mecanismo.
 */
async function ejecutar<T = null>(
  ruta: string,
  fn: (
    db: Awaited<ReturnType<typeof conexion>>,
    organizationId: string,
    usuarioId: string,
  ) => Promise<T>,
): Promise<Resultado<T>> {
  try {
    const sesion = await sesionActual()
    if (!sesion) {
      return {
        ok: false,
        mensaje: 'Tu sesión no está activa. Vuelve a entrar para seguir.',
        reintentable: false,
      }
    }

    const db = await conexion()
    const datos = await fn(db, await organizacionPorDefecto(db), sesion.id)
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
 * Revalida `/` porque ahí vive el selector de marcas, en el layout del grupo
 * de rutas `(app)` (`apps/web/src/app/(app)/layout.tsx`), que es lo que
 * cambia al crear una.
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
  return ejecutar(`/${marca}/grilla/${mes}`, async (db, organizationId, usuarioId) => {
    await aprobarGrilla(db, organizationId, contentPlanId, usuarioId)
    return null
  })
}

/**
 * Devuelve una grilla aprobada a borrador. `reabrirGrilla` solo acepta esa
 * transición: desde `en_ejecucion` o `cerrada` no, porque ahí ya hay
 * publicaciones en vuelo o cerradas y reabrir no las deshace.
 */
export async function reabrirGrillaAccion(marca: string, mes: string): Promise<Resultado> {
  return ejecutar(`/${marca}/grilla/${mes}`, async (db, organizationId, usuarioId) => {
    await reabrirGrilla(db, organizationId, { slug: marca, mes }, usuarioId)
    return null
  })
}

/**
 * Encola y devuelve. **No ejecuta**: el worker toma la corrida y la corre. Es
 * lo que permite que esta acción responda al instante sin romper la regla de
 * que la web no hace trabajo largo ni llama al modelo.
 *
 * `despertarWorker` va **después** de `encolar` y nunca dentro: cuando corre,
 * la corrida ya está a salvo en la base. Si crear la tarea falla, la función
 * lo registra y no lanza, y la red de seguridad de Cloud Scheduler levanta la
 * corrida unos minutos después. En local no hace nada: no hay Cloud Tasks, y
 * el worker de Docker sondea solo.
 */
export async function encolarGrillaAccion(marca: string, mes: string): Promise<Resultado> {
  return ejecutar(`/${marca}/grilla/${mes}`, async (db, organizationId) => {
    await encolarGrilla(db, organizationId, { slug: marca, mes })
    await despertarWorker()
    return null
  })
}

/** La gemela de la anterior para P1. Encola, despierta y devuelve, por lo mismo. */
export async function encolarEstrategiaAccion(
  marca: string,
  periodo: string,
): Promise<Resultado> {
  return ejecutar(`/${marca}/estrategia`, async (db, organizationId) => {
    await encolarEstrategia(db, organizationId, { slug: marca, periodo })
    await despertarWorker()
    return null
  })
}

/**
 * Devuelve una corrida fallida (o colgada) a la cola.
 *
 * Recibe la ruta a revalidar y no la marca, porque el componente que la llama
 * sirve a las dos pantallas y la ruta ya lleva la marca dentro. Componer
 * `/${marca}/...` aquí obligaría a pasar además de qué pantalla se trata.
 *
 * Despierta igual que las dos de arriba: reanudar deja la fila en `pendiente`,
 * o sea exactamente el mismo estado que encolar, y sin el aviso el botón
 * «Reintentar» tardaría los minutos de la red de seguridad en hacer algo
 * visible.
 */
export async function reanudarCorridaAccion(ruta: string, runId: string): Promise<Resultado> {
  return ejecutar(ruta, async (db, organizationId) => {
    await reanudarCorridaEncolada(db, organizationId, runId)
    await despertarWorker()
    return null
  })
}

/**
 * El JSON se parsea dentro del callback de `ejecutar`, después de la guarda de
 * sesión: parsearlo antes le daría a un llamador anónimo un oráculo trivial
 * ("JSON inválido" ≠ "sin sesión") y CPU gratis sobre una entrada de tamaño
 * arbitrario. Un error de sintaxis nunca llega a `cargarPerfilDeObjeto`; se
 * relanza como `Error` con el mismo mensaje que antes, y `ejecutar` lo
 * traduce: `clasificarError` clasifica un `Error` genérico como `permanente`,
 * así que `reintentable` sigue dando `false` igual que cuando se devolvía a
 * mano.
 *
 * Si parsea, `cargarPerfilDeObjeto` ya valida con `validarPerfil` y ya crea
 * una versión nueva — un perfil que no cumple sus reglas (proporciones que no
 * suman 1, un pilar que no es snake_case, etc.) vuelve como error
 * `permanente` con el detalle de cuál regla falló, y ese mensaje es el que ve
 * el usuario tal cual.
 *
 * `cargarPerfilDeObjeto` ya devuelve la versión que quedó. Devolverla al
 * cliente es lo que permite que el editor anuncie la versión real en vez de
 * la que traía en props, que es la anterior hasta que la revalidación llega.
 */
export async function guardarPerfilAction(
  slug: string,
  textoJson: string,
): Promise<Resultado<{ version: number }>> {
  return ejecutar(`/${slug}/perfil`, async (db, organizationId, usuarioId) => {
    let perfil: unknown
    try {
      perfil = JSON.parse(textoJson)
    } catch (error) {
      throw new Error(
        `El texto no es JSON válido: ${error instanceof Error ? error.message : String(error)}`,
      )
    }

    const version = await cargarPerfilDeObjeto(db, organizationId, { slug, perfil }, usuarioId)
    return { version }
  })
}
