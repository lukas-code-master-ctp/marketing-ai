import { esquema, ESTADOS_PIPELINE, type BaseDeDatos } from '@gc/db'
import { validarMes, validarPeriodo } from '@gc/strategy'
import { and, desc, eq, getTableColumns, sql } from 'drizzle-orm'
import { resolverMarca } from './marcas.js'

/**
 * Se deriva del enumerado que declara el esquema en vez de repetir la lista:
 * el `CHECK` de Postgres, la columna y este tipo se mueven juntos o no se
 * mueven. Es lo mismo que hace `@gc/strategy` con `ESTADOS_STRATEGY`.
 */
export type EstadoDeCorrida = (typeof ESTADOS_PIPELINE)[number]

/** Los dos flujos que la web sabe encolar, con los nombres que `pipeline_runs.flow` guarda. */
export type FlujoEncolable = 'p1_estrategia' | 'p2_grilla'

export interface CorridaEnCurso {
  id: string
  flow: FlujoEncolable
  estado: EstadoDeCorrida
  error: string | null
  /** El paso más reciente por antigüedad, o `null` si todavía no empezó ninguno. */
  pasoActual: string | null
  /** Segundos desde que se encoló. La pantalla lo usa para distinguir "en cola"
   *  de "nadie la tomó porque el worker no está corriendo". */
  encoladaHace: number
}

export interface CorridaTomada {
  id: string
  organizationId: string
  brandId: string | null
  /**
   * El slug de la marca, o `null` si la corrida no tiene marca. Viaja junto a
   * la corrida —y no lo consulta después quien la toma— porque es lo que el
   * motor pasa a los pasos como `brandSlug`: sin él los mensajes de error que
   * ve el usuario dicen el UUID de la marca en vez de su nombre.
   */
  brandSlug: string | null
  flow: string
  input: Record<string, unknown>
}

/**
 * Inserta la corrida en `pendiente` y devuelve. **No ejecuta nada**: eso es del
 * worker. Es lo que permite que la Server Action responda al instante sin
 * romper la regla de que la web no hace trabajo largo.
 *
 * La entrada se valida antes de insertar: una corrida encolada con un mes
 * inválido fallaría recién en el worker, minutos después y lejos del usuario
 * que la pidió.
 */
async function encolar(
  db: BaseDeDatos,
  organizationId: string,
  flujo: FlujoEncolable,
  brandId: string,
  input: Record<string, string>,
): Promise<string> {
  const [fila] = await db
    .insert(esquema.pipelineRuns)
    .values({ organizationId, brandId, flow: flujo, status: 'pendiente', input })
    .returning({ id: esquema.pipelineRuns.id })

  return fila!.id
}

export async function encolarEstrategia(
  db: BaseDeDatos,
  organizationId: string,
  args: { slug: string; periodo: string },
): Promise<string> {
  validarPeriodo(args.periodo)
  const ref = await resolverMarca(db, organizationId, args.slug)
  return encolar(db, organizationId, 'p1_estrategia', ref.brandId, {
    brandId: ref.brandId,
    period: args.periodo,
  })
}

export async function encolarGrilla(
  db: BaseDeDatos,
  organizationId: string,
  args: { slug: string; mes: string },
): Promise<string> {
  validarMes(args.mes)
  const ref = await resolverMarca(db, organizationId, args.slug)
  return encolar(db, organizationId, 'p2_grilla', ref.brandId, {
    brandId: ref.brandId,
    mes: args.mes,
  })
}

/** Las columnas que devuelve el `RETURNING`, en `snake_case` como salen de la base. */
interface FilaTomada {
  id: string
  organization_id: string
  brand_id: string | null
  brand_slug: string | null
  flow: string
  input: Record<string, unknown>
}

/**
 * Toma una corrida pendiente y la marca `en_curso`, atómicamente.
 *
 * El bloqueo es lo que impide que dos workers se lleven la misma corrida, y
 * cada mitad de `FOR UPDATE SKIP LOCKED` responde por algo distinto:
 *
 * - `FOR UPDATE` es la garantía de exclusión. Sin él los dos subconsultas leen
 *   el mismo `id` desde el mismo snapshot; el segundo `UPDATE` espera al
 *   primero, pero al despertar revalida solo su propio `WHERE id = <ese id>`,
 *   que sigue siendo cierto, así que actualiza la fila otra vez y la devuelve.
 *   Los dos workers ejecutarían la misma corrida.
 * - `SKIP LOCKED` es lo que evita la espera. Sin él el segundo worker se queda
 *   bloqueado hasta que el primero confirme, en vez de seguir buscando otra
 *   corrida o volver a dormir. Con un worker no se nota; con dos, uno queda
 *   colgado del otro.
 *
 * No filtra por organización a propósito: el worker sirve a todas.
 */
export async function tomarCorridaPendiente(db: BaseDeDatos): Promise<CorridaTomada | null> {
  // El orden se escribe con la columna del esquema, no con su nombre a mano:
  // la propiedad se llama `startedAt` pero la columna física es `created_at`,
  // y `ORDER BY started_at` revienta con «column does not exist».
  //
  // El desempate por `id` importa porque `defaultNow()` es `now()`, que en
  // Postgres marca el *inicio* de la transacción: dos corridas encoladas
  // dentro de la misma transacción comparten el mismo `created_at` exacto, y
  // sin desempate el orden entre ellas queda arbitrario.
  //
  // `db.execute` con el driver postgres-js devuelve el arreglo de filas
  // directamente —no un `{ rows }`—, igual que en `esquema.test.ts`.
  //
  // El `WHERE status = 'pendiente'` del UPDATE externo es redundante con el
  // de la subconsulta en el camino feliz —Postgres ya filtró por eso al
  // elegir el `id`— pero no depende de que la subconsulta se reevalúe tras el
  // bloqueo: si alguien edita esta consulta y pierde `FOR UPDATE SKIP
  // LOCKED`, esta cláusula sigue impidiendo que el UPDATE tome una fila que
  // ya no está pendiente.
  //
  // El slug sale en el mismo `RETURNING`, con una subconsulta correlacionada y
  // no con un `FROM brands`: un `UPDATE ... FROM` se comporta como un join
  // interno, así que una corrida sin marca —`brand_id` nulo— no encontraría
  // pareja y **no se actualizaría**. La subconsulta devuelve `NULL` en ese
  // caso y deja el UPDATE intacto. La organización también se compara porque
  // es la tenencia que la clave foránea compuesta ya exige: aquí solo se
  // escribe igual que en el resto del paquete.
  const filas = (await db.execute(sql`
    UPDATE pipeline_runs SET status = 'en_curso'
    WHERE status = 'pendiente' AND id = (
      SELECT id FROM pipeline_runs
      WHERE status = 'pendiente'
      ORDER BY ${esquema.pipelineRuns.startedAt}, id
      LIMIT 1
      FOR UPDATE SKIP LOCKED
    )
    RETURNING id, organization_id, brand_id, flow, input, (
      SELECT b.slug FROM brands b
      WHERE b.id = pipeline_runs.brand_id
        AND b.organization_id = pipeline_runs.organization_id
    ) AS brand_slug
  `)) as unknown as FilaTomada[]

  const fila = filas[0]
  if (!fila) return null

  return {
    id: fila.id,
    organizationId: fila.organization_id,
    brandId: fila.brand_id,
    brandSlug: fila.brand_slug,
    flow: fila.flow,
    input: fila.input,
  }
}

/**
 * La corrida más reciente de esa marca, ese flujo y ese periodo.
 *
 * El periodo se busca dentro de `input`, que es donde el flujo ya lo guarda:
 * `mes` para la grilla, `period` para la estrategia. Es una consulta sobre
 * jsonb sin índice; `pipeline_runs` es pequeña y seguirá siéndolo mientras
 * haya un worker, pero es el primer lugar donde mirar si algún día pesa.
 */
export async function corridaDe(
  db: BaseDeDatos,
  organizationId: string,
  args: { slug: string; flujo: FlujoEncolable; periodo: string },
): Promise<CorridaEnCurso | null> {
  const ref = await resolverMarca(db, organizationId, args.slug)

  // Las dos ramas son fragmentos con la clave escrita literal: interpolarla
  // con `sql.raw` la metería sin escapar en la consulta, y pasarla como
  // parámetro dejaría a Postgres eligiendo entre `jsonb ->> text` y
  // `jsonb ->> integer` sin datos para decidir.
  const periodoCoincide =
    args.flujo === 'p2_grilla'
      ? sql`${esquema.pipelineRuns.input}->>'mes' = ${args.periodo}`
      : sql`${esquema.pipelineRuns.input}->>'period' = ${args.periodo}`

  // `encoladaHace` se calcula en SQL, no como `Date.now()` de la aplicación
  // menos `startedAt` de Postgres: si ambos relojes no coinciden exactamente
  // —hoy es el mismo host, pero no siempre lo será— la resta entre relojes
  // distintos puede dar un número negativo, y esa cifra es la que la pantalla
  // usa para distinguir "en cola" de "nadie tomó esta generación".
  const [fila] = await db
    .select({
      ...getTableColumns(esquema.pipelineRuns),
      encoladaHace: sql<number>`extract(epoch from now() - ${esquema.pipelineRuns.startedAt})`
        .mapWith(Number),
    })
    .from(esquema.pipelineRuns)
    .where(
      and(
        eq(esquema.pipelineRuns.organizationId, organizationId),
        eq(esquema.pipelineRuns.brandId, ref.brandId),
        eq(esquema.pipelineRuns.flow, args.flujo),
        periodoCoincide,
      ),
    )
    .orderBy(desc(esquema.pipelineRuns.startedAt))
    .limit(1)

  if (!fila) return null

  const [paso] = await db
    .select({ name: esquema.pipelineSteps.name })
    .from(esquema.pipelineSteps)
    .where(
      and(
        eq(esquema.pipelineSteps.organizationId, organizationId),
        eq(esquema.pipelineSteps.runId, fila.id),
      ),
    )
    .orderBy(desc(esquema.pipelineSteps.startedAt))
    .limit(1)

  return {
    id: fila.id,
    flow: args.flujo,
    estado: fila.status,
    error: fila.error,
    pasoActual: paso?.name ?? null,
    encoladaHace: Math.floor(fila.encoladaHace),
  }
}
