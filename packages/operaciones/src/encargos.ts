import { esquema, type BaseDeDatos } from '@gc/db'
import { permanente } from '@gc/shared'
import { Encargo, validarPeriodo, type TipoEncargo } from '@gc/strategy'
import { and, eq } from 'drizzle-orm'
import type { z } from 'zod'
import { resolverMarca } from './marcas.js'

/**
 * Los nombres que el formulario le muestra a la persona por cada campo del
 * encargo. Sirven para traducir los `issues` de Zod a un mensaje que nombre
 * el campo por su nombre humano y no por su ruta en el esquema (`comoSeMide`
 * no le dice nada a quien llena el formulario; «Cómo sabrás que resultó» sí).
 */
const NOMBRE_DE_CAMPO: Record<string, string> = {
  objetivo: 'Objetivo del trimestre',
  comoSeMide: 'Cómo sabrás que resultó',
  publicacionesPorSemana: 'Publicaciones por semana que puedes sostener',
  canalesDisponibles: 'Canales disponibles este trimestre',
  queEstaPasando: 'Qué está pasando',
  queFunciono: 'Qué funcionó',
  queNoFunciono: 'Qué no funcionó',
  queEvitar: 'Qué evitar',
  algoMas: 'Algo más',
}

function nombreDeCampo(path: (string | number)[]): string {
  const clave = path[0]
  if (typeof clave === 'string' && clave in NOMBRE_DE_CAMPO) return NOMBRE_DE_CAMPO[clave]!
  return path.length > 0 ? path.join('.') : 'el encargo'
}

/**
 * Traduce un `issue` de Zod a una frase corta en español, sin repetir el
 * mínimo o máximo exacto que el esquema exige: decir «es demasiado corto» en
 * vez de «necesita 10 caracteres» evita una segunda lista de reglas —escrita
 * a mano acá— que se desincronizaría del esquema el día que ese mínimo
 * cambie. El dato que sí se usa del `issue` (su `code` y, cuando aplica, su
 * `type`) sale del propio `issue`, nunca escrito literal.
 */
function describirProblema(issue: z.ZodIssue): string {
  switch (issue.code) {
    case 'too_small':
      if (issue.type === 'array') return 'no tiene ninguna opción marcada'
      if (issue.type === 'number') return 'es demasiado bajo'
      return 'es demasiado corto'
    case 'too_big':
      return issue.type === 'number' ? 'es demasiado alto' : 'es demasiado largo'
    case 'invalid_type':
      return issue.received === 'undefined' ? 'falta' : 'no tiene el formato esperado'
    case 'invalid_enum_value':
      return 'incluye un valor que no es una opción válida'
    default:
      return 'no es válido'
  }
}

/**
 * Arma, a partir de un `ZodError` de validar un `Encargo`, un mensaje en
 * español que nombra cada campo por el rótulo que ve la persona en el
 * formulario y describe el problema sin exponer el JSON de Zod. Sigue el
 * mismo patrón que `validarPerfil` (`packages/brand/src/perfil.ts`): recorrer
 * `error.issues` y armar una lista legible, una línea por campo.
 */
function mensajeDeEncargoInvalido(error: z.ZodError): string {
  const detalle = error.issues
    .map((issue) => `- ${nombreDeCampo(issue.path)}: ${describirProblema(issue)}`)
    .join('\n')
  return `El encargo tiene campos que corregir antes de guardarlo:\n${detalle}`
}

/**
 * Los tres estados de un encargo, con la misma forma que
 * `estrategiaDelTrimestre` usa para la estrategia.
 *
 * `invalido` existe porque el encargo se valida al escribirlo: la única forma
 * de que deje de cumplir el esquema es que una versión posterior agregue un
 * campo obligatorio. Ese día conviene decirlo en pantalla, y no mostrar un
 * formulario en blanco que hace perder lo que la persona ya había escrito.
 *
 * El `motivo` de `invalido` sale de `mensajeDeEncargoInvalido`: ya es un
 * texto en español, pensado para pantalla, que nombra los campos por su
 * rótulo del formulario y no por su ruta en el esquema. A diferencia de un
 * volcado crudo de Zod, quien consuma este tipo puede imprimirlo tal cual.
 *
 * `datos` lleva la fila cruda, tal como salió de la base, sin validar. Existe
 * para que quien la muestre pueda pasarla por `desdeElEncargo`
 * (`apps/web/src/componentes/encargo/conversion.ts`), que carga lo que se
 * pueda campo por campo y nunca lanza. Sin este campo, un encargo inválido
 * llegaba a la pantalla como `null` y el formulario salía en blanco — que es
 * justo lo que el comentario de arriba dice que este estado existe para
 * evitar.
 */
export type LecturaDeEncargo =
  | { tipo: 'ausente' }
  | { tipo: 'invalido'; motivo: string; datos: unknown }
  | { tipo: 'presente'; encargo: TipoEncargo }

export async function leerEncargo(
  db: BaseDeDatos,
  organizationId: string,
  args: { slug: string; periodo: string },
): Promise<LecturaDeEncargo> {
  validarPeriodo(args.periodo)
  const ref = await resolverMarca(db, organizationId, args.slug)

  const [fila] = await db
    .select({ data: esquema.strategyBriefs.data })
    .from(esquema.strategyBriefs)
    .where(and(
      eq(esquema.strategyBriefs.brandId, ref.brandId),
      eq(esquema.strategyBriefs.organizationId, organizationId),
      eq(esquema.strategyBriefs.period, args.periodo),
    ))
    .limit(1)

  if (!fila) return { tipo: 'ausente' }

  const leido = Encargo.safeParse(fila.data)
  if (!leido.success) {
    return { tipo: 'invalido', motivo: mensajeDeEncargoInvalido(leido.error), datos: fila.data }
  }
  return { tipo: 'presente', encargo: leido.data }
}

export async function guardarEncargo(
  db: BaseDeDatos,
  organizationId: string,
  args: { slug: string; periodo: string; encargo: unknown },
  usuarioId?: string,
): Promise<void> {
  // Un periodo mal formado no cuesta nada: se rechaza antes de resolver la
  // marca o de tocar la base.
  validarPeriodo(args.periodo)
  const ref = await resolverMarca(db, organizationId, args.slug)

  const leido = Encargo.safeParse(args.encargo)
  if (!leido.success) {
    throw permanente(mensajeDeEncargoInvalido(leido.error))
  }

  // La congelación se comprueba acá y no en la pantalla: el bloque de solo
  // lectura es comodidad, y una Server Action es un endpoint con identificador
  // estable que cualquiera puede llamar sin pasar por la página.
  const [estrategia] = await db
    .select({ status: esquema.strategies.status })
    .from(esquema.strategies)
    .where(and(
      eq(esquema.strategies.brandId, ref.brandId),
      eq(esquema.strategies.organizationId, organizationId),
      eq(esquema.strategies.period, args.periodo),
    ))
    .limit(1)

  if (estrategia && estrategia.status !== 'borrador') {
    throw permanente(
      `La estrategia de ${args.periodo} está en estado «${estrategia.status}», así que su ` +
        'encargo quedó congelado con ella. Para cambiarlo, la estrategia tiene que volver a borrador.',
    )
  }

  const [escrita] = await db
    .insert(esquema.strategyBriefs)
    .values({
      organizationId,
      brandId: ref.brandId,
      period: args.periodo,
      data: leido.data,
      ...(usuarioId !== undefined ? { createdBy: usuarioId } : {}),
    })
    // `createdAt` queda fuera del `set`: conserva el momento de la primera
    // escritura, porque corregir un encargo no lo vuelve un encargo nuevo.
    // `createdBy`, en cambio, sí entra al `set` a propósito: para este campo
    // la lectura intencionada no es "quién lo escribió primero" sino "quién
    // lo escribió por última vez" — si otra persona corrige el texto, el
    // autor tiene que reflejar eso. Cuando la corrección llega sin
    // `usuarioId` (el spread condicional de más abajo) la columna no se toca
    // y conserva el autor anterior; no se sobrescribe con `null`.
    .onConflictDoUpdate({
      target: [esquema.strategyBriefs.brandId, esquema.strategyBriefs.period],
      set: {
        data: leido.data,
        ...(usuarioId !== undefined ? { createdBy: usuarioId } : {}),
      },
    })
    .returning({ id: esquema.strategyBriefs.id })

  // Sin fila devuelta la escritura no ocurrió. Hoy esta guarda es
  // inalcanzable: el `onConflictDoUpdate` de arriba no lleva `setWhere`, así
  // que siempre inserta o actualiza y siempre devuelve una fila. Se deja
  // igual, como red barata —una línea— para el día en que alguien le agregue
  // un `setWhere` a este upsert. Contraste con `packages/flujos/src/p1.ts`:
  // ahí el upsert de la estrategia sí lleva `setWhere: eq(status, 'borrador')`,
  // así que ahí la misma guarda sí es alcanzable y la congelación es atómica
  // (upsert y comprobación de estado son la misma operación). Acá la
  // congelación es una comprobación previa —el `select` de `estrategia` más
  // arriba— con una ventana entre ese `select` y este `insert` en la que,
  // en teoría, la estrategia podría pasar a `aprobada` o `archivada` justo
  // en el medio. Hoy nadie puede abrir esa ventana: en todo el repositorio
  // no existe ninguna operación que ponga una estrategia en esos dos
  // estados, así que la ventana está descrita pero no es explotable todavía.
  if (!escrita) throw permanente(`No se pudo guardar el encargo de ${args.periodo}.`)
}
