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
 * marca nueva no tiene que pelearse con una lista de reglas rotas que no
 * escribió para empezar a editar. Lo que sí se rechaza es guardarla **sin
 * tocar** — ver `cargarPerfilDeObjeto`.
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

/**
 * Igualdad estructural sin depender del orden de las claves.
 *
 * `JSON.stringify` de los dos lados habría sido más corto y habría fallado
 * ante lo primero que hace el editor: la persona edita el texto a mano, y
 * mover una clave de lugar sin cambiar un solo valor bastaba para colarse. En
 * los arreglos el orden **sí** cuenta: reordenar los pilares o los públicos es
 * una decisión sobre el contenido, no un detalle de serialización.
 */
function mismoContenido(a: unknown, b: unknown): boolean {
  if (a === b) return true
  if (Array.isArray(a) || Array.isArray(b)) {
    if (!Array.isArray(a) || !Array.isArray(b) || a.length !== b.length) return false
    return a.every((elemento, i) => mismoContenido(elemento, b[i]))
  }
  if (typeof a !== 'object' || typeof b !== 'object' || a === null || b === null) return false

  const claves = Object.keys(a)
  if (claves.length !== Object.keys(b).length) return false
  return claves.every(
    (clave) =>
      Object.hasOwn(b, clave) &&
      mismoContenido((a as Record<string, unknown>)[clave], (b as Record<string, unknown>)[clave]),
  )
}

/**
 * Guarda el perfil, salvo que sea la plantilla sin tocar.
 *
 * La plantilla valida —a propósito— y hasta acá eso alcanzaba para que
 * guardarla creara la versión 1 de una marca cuyo perfil dice "A quién le
 * habla" y "Qué le promete a quien le compra, en una frase". Desde ahí P1 y P2
 * le pasan al modelo un contexto de marca de relleno, y con los pilares al
 * 50/50 la salida no se ve rota: se ve vacía. Y esa corrida **cuesta una
 * llamada real al modelo**, así que el momento de pararla es este y no cuando
 * llegue la factura.
 *
 * El rechazo va acá y no en el formulario web porque el CLI carga perfiles por
 * esta misma puerta (`perfil:cargar`), y porque `PLANTILLA_DE_PERFIL` vive de
 * este lado: la web no la puede comparar contra nada.
 */
export async function cargarPerfilDeObjeto(
  db: BaseDeDatos,
  organizationId: string,
  args: { slug: string; perfil: unknown },
): Promise<number> {
  const ref = await resolverMarca(db, organizationId, args.slug)

  if (mismoContenido(args.perfil, PLANTILLA_DE_PERFIL)) {
    throw permanente(
      `Este perfil es la plantilla sin cambios, así que no se guarda: describiría a ` +
        `"${args.slug}" con textos de relleno. Reemplaza el posicionamiento, los ` +
        'públicos, el tono y los pilares por los de la marca antes de guardar — la ' +
        'estrategia y la grilla se generan a partir de este texto, y cada generación ' +
        'cuesta una llamada al modelo.',
    )
  }

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
