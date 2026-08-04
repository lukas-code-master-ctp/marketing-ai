import { esquema, ESTADOS_PIPELINE, type BaseDeDatos } from '@gc/db'
import { permanente } from '@gc/shared'
import { validarMes, validarPeriodo } from '@gc/strategy'
import { and, desc, eq, getTableColumns, or, sql } from 'drizzle-orm'
import { resolverMarca } from './marcas.js'
import { describirAntiguedad, MINUTOS_SIN_SENAL_PARA_ABANDONO } from './senales.js'

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
  /**
   * Segundos desde la última señal de vida de la corrida, que **no** es lo
   * mismo que `encoladaHace`: una corrida `en_curso` puede llevar una hora
   * encolada y haber escrito un paso hace cinco segundos.
   *
   * Sale del mismo `ultimaSenalDeVida` que usa la guarda de
   * `reanudarCorridaEncolada`, a propósito: la pantalla ofrece reanudar
   * exactamente cuando el dominio va a aceptarlo. Dos definiciones de "sin
   * señal" serían un botón que aparece y después rechaza.
   */
  segundosSinSenal: number
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
 * La marca de tiempo más reciente que dejó la corrida: la suya propia o la de
 * cualquiera de sus pasos. Es una aproximación, no una respuesta: la única
 * forma correcta de distinguir una corrida viva de una abandonada es un latido
 * o un arriendo que el worker renueve. Está registrado en `pendientes.md`.
 *
 * `greatest` de Postgres ignora los nulos, así que un paso que todavía no
 * termina aporta su `started_at` sin anular el resto. El `finished_at` cuenta
 * porque un paso puede pasarse veinte minutos entre reintentos y llamadas al
 * modelo: mirando solo `started_at`, una corrida que acaba de completar ese
 * paso parecería abandonada.
 *
 * La subconsulta compara también la organización, no solo el `run_id`: es la
 * misma tenencia que la clave foránea compuesta ya exige, y aquí se escribe
 * igual que en el resto del paquete.
 *
 * Las columnas se escriben con las del esquema y no a mano, y la subconsulta va
 * sin alias para poder hacerlo: la propiedad se llama `startedAt` en las dos
 * tablas pero la columna física es `created_at`, así que un `s.started_at`
 * escrito a mano revienta con «column does not exist». Es el mismo tropiezo que
 * ya documenta el `ORDER BY` de `tomarCorridaPendiente`.
 *
 * Lo leen dos: la guarda de `reanudarCorridaEncolada`, que decide si una
 * `en_curso` se puede devolver a la cola, y `corridaDe`, que se lo pasa a la
 * pantalla como `segundosSinSenal` para que ofrezca el botón en el mismo
 * momento. Es una sola definición justamente para que no puedan discrepar.
 */
const ultimaSenalDeVida = sql`greatest(
  ${esquema.pipelineRuns.startedAt},
  (
    SELECT max(greatest(
      ${esquema.pipelineSteps.startedAt},
      ${esquema.pipelineSteps.finishedAt}
    ))
    FROM ${esquema.pipelineSteps}
    WHERE ${esquema.pipelineSteps.runId} = ${esquema.pipelineRuns.id}
      AND ${esquema.pipelineSteps.organizationId} = ${esquema.pipelineRuns.organizationId}
  )
)`

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
      segundosSinSenal: sql<number>`extract(epoch from now() - ${ultimaSenalDeVida})`
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
    segundosSinSenal: Math.floor(fila.segundosSinSenal),
  }
}

/**
 * Devuelve una corrida a `pendiente` para que el worker la retome.
 *
 * Una `fallido` se reanuda siempre: nadie la está ejecutando. Una `en_curso`
 * solo si lleva `MINUTOS_SIN_SENAL_PARA_ABANDONO` sin dar señales, porque el
 * estado no distingue "se colgó" de "el worker la está ejecutando ahora
 * mismo". Reanudar una viva la devuelve a la cola, otro worker la toma, y los
 * dos ejecutan el mismo paso: el `onConflictDoUpdate` de `ejecutarPaso`
 * reinicia la fila del primero mientras sigue corriendo, así que **los dos
 * llaman al modelo**. Hoy no es alcanzable con un worker de bucle secuencial,
 * pero nada en el código ni en `docker-compose.yml` impone que haya uno solo.
 *
 * Reanudar una abandonada no vuelve a pagar el modelo: el pipeline es
 * idempotente por paso y los completados no se reejecutan.
 *
 * Una corrida `completado` se rechaza: no hay nada que reanudar, y permitirlo
 * invitaría a usar este botón como "regenerar", que es otra cosa y destruye lo
 * que haya. Una `pendiente` también: ya está en la cola.
 *
 * La marca de tiempo se reinicia porque reanudar **es** volver a encolar, y la
 * antigüedad en la cola tiene que contar desde ahora. Sin eso la pantalla
 * miente en el instante mismo en que se suelta el botón: `encoladaHace` sigue
 * midiendo desde el encolado original, así que una corrida que llevaba una
 * hora ahí renace `pendiente` con tres mil seiscientos segundos encima y cruza
 * de sobra el umbral con el que la pantalla decide anunciar «nadie tomó esta
 * generación… lo normal es que el worker no esté corriendo», con el worker
 * sano y la corrida recién encolada. Efecto secundario deseable: como
 * `tomarCorridaPendiente` ordena por esta misma columna, la reanudada va al
 * final de la cola en vez de colarse delante de las que ya estaban esperando.
 */
export async function reanudarCorridaEncolada(
  db: BaseDeDatos,
  organizationId: string,
  runId: string,
): Promise<void> {
  // `startedAt` es la propiedad; la columna física es `created_at`. El `WHERE`
  // que sigue mira la fila **anterior** al UPDATE —así evalúa Postgres—, así
  // que reiniciarla aquí no afecta a la guarda de los quince minutos.
  const [fila] = await db
    .update(esquema.pipelineRuns)
    .set({ status: 'pendiente', error: null, finishedAt: null, startedAt: sql`now()` })
    .where(
      and(
        eq(esquema.pipelineRuns.id, runId),
        eq(esquema.pipelineRuns.organizationId, organizationId),
        or(
          eq(esquema.pipelineRuns.status, 'fallido'),
          and(
            eq(esquema.pipelineRuns.status, 'en_curso'),
            sql`${ultimaSenalDeVida} < now() - ${MINUTOS_SIN_SENAL_PARA_ABANDONO}::int * interval '1 minute'`,
          ),
        ),
      ),
    )
    .returning({ id: esquema.pipelineRuns.id })

  if (fila) return

  const [actual] = await db
    .select({
      status: esquema.pipelineRuns.status,
      // Se calcula en SQL y no restando `Date.now()` por lo mismo que
      // `encoladaHace`: son dos relojes que hoy son el mismo host y mañana no.
      segundosSinSenal: sql<number>`extract(epoch from now() - ${ultimaSenalDeVida})`
        .mapWith(Number),
    })
    .from(esquema.pipelineRuns)
    .where(
      and(
        eq(esquema.pipelineRuns.id, runId),
        eq(esquema.pipelineRuns.organizationId, organizationId),
      ),
    )

  if (!actual) throw permanente(`No existe la corrida ${runId} en esta organización`)

  // El rechazo de una `en_curso` viva se distingue del resto a propósito: no es
  // "este estado no se reanuda" sino "espera, alguien la está ejecutando".
  if (actual.status === 'en_curso') {
    throw permanente(
      `La corrida ${runId} parece estar ejecutándose ahora mismo: dio señales de vida ` +
        `hace ${describirAntiguedad(actual.segundosSinSenal)}. Se puede reanudar recién ` +
        `cuando lleve ${MINUTOS_SIN_SENAL_PARA_ABANDONO} minutos sin avanzar.`,
    )
  }

  throw permanente(
    `La corrida ${runId} está en estado "${actual.status}" y solo se reanuda una que ` +
      `haya fallado o que lleve ${MINUTOS_SIN_SENAL_PARA_ABANDONO} minutos colgada`,
  )
}
