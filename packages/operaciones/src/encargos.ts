import { esquema, type BaseDeDatos } from '@gc/db'
import { permanente } from '@gc/shared'
import { Encargo, validarPeriodo, type TipoEncargo } from '@gc/strategy'
import { and, eq } from 'drizzle-orm'
import { resolverMarca } from './marcas.js'

/**
 * Los tres estados de un encargo, con la misma forma que
 * `estrategiaDelTrimestre` usa para la estrategia.
 *
 * `invalido` existe porque el encargo se valida al escribirlo: la única forma
 * de que deje de cumplir el esquema es que una versión posterior agregue un
 * campo obligatorio. Ese día conviene decirlo en pantalla, y no mostrar un
 * formulario en blanco que hace perder lo que la persona ya había escrito.
 *
 * El `motivo` de `invalido` transporta `leido.error.message` de Zod: un
 * volcado JSON en inglés, no un texto pensado para pantalla. Quien consuma
 * este tipo tiene que escribir su propio mensaje en español a partir de él
 * (o ignorarlo y mostrar uno genérico); imprimirlo tal cual rompe la regla
 * de este proyecto de que todo texto que ve el usuario va en español.
 */
export type LecturaDeEncargo =
  | { tipo: 'ausente' }
  | { tipo: 'invalido'; motivo: string }
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
  if (!leido.success) return { tipo: 'invalido', motivo: leido.error.message }
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
    throw permanente(`El encargo no cumple su esquema: ${leido.error.message}`)
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
