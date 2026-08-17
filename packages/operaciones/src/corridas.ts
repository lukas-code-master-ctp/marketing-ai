import { esquema, ESTADOS_PIPELINE, type BaseDeDatos } from '@gc/db'
import { permanente } from '@gc/shared'
import { validarMes, validarPeriodo } from '@gc/strategy'
import { and, desc, eq, getTableColumns, inArray, ne, or, sql } from 'drizzle-orm'
import { leerEncargo } from './encargos.js'
import { resolverMarca } from './marcas.js'
import {
  describirAntiguedad, ESTADOS_VIVOS, MINUTOS_SIN_SENAL_PARA_ABANDONO,
} from './senales.js'

/**
 * Se deriva del enumerado que declara el esquema en vez de repetir la lista:
 * el `CHECK` de Postgres, la columna y este tipo se mueven juntos o no se
 * mueven. Es lo mismo que hace `@gc/strategy` con `ESTADOS_STRATEGY`.
 */
export type EstadoDeCorrida = (typeof ESTADOS_PIPELINE)[number]

/** Los tres flujos que la web sabe encolar, con los nombres que `pipeline_runs.flow` guarda. */
export type FlujoEncolable = 'p1_estrategia' | 'p2_grilla' | 'p3_pieza'

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
 * Cada flujo guarda su periodo dentro de `input` bajo una clave distinta, y
 * este es el único sitio donde eso se declara. Antes estaba escrito tres veces
 * —al encolar la estrategia, al encolar la grilla, y en el selector de rama de
 * `corridaDe`—, así que la escritura y la lectura podían separarse sin que
 * nada lo notara: el `input` viaja como jsonb y `tsc` no ve dentro.
 *
 * `coincide` devuelve el fragmento con la clave escrita **literal** y no
 * interpolada: `sql.raw` la metería sin escapar, y pasarla como parámetro
 * dejaría a Postgres eligiendo entre `jsonb ->> text` y `jsonb ->> integer`
 * sin datos para decidir. Por eso son dos entradas con su fragmento propio y
 * no un solo constructor parametrizado.
 */
const PERIODO_EN_LA_ENTRADA = {
  p1_estrategia: {
    clave: 'period',
    coincide: (periodo: string) => sql`${esquema.pipelineRuns.input}->>'period' = ${periodo}`,
    /** Cómo se nombra en pantalla lo que este flujo genera. */
    genera: 'la estrategia',
  },
  p2_grilla: {
    clave: 'mes',
    coincide: (periodo: string) => sql`${esquema.pipelineRuns.input}->>'mes' = ${periodo}`,
    genera: 'la grilla',
  },
  p3_pieza: {
    clave: 'mes',
    coincide: (periodo: string) => sql`${esquema.pipelineRuns.input}->>'mes' = ${periodo}`,
    genera: 'las piezas',
  },
} as const satisfies Record<FlujoEncolable, unknown>

/**
 * Inserta la corrida en `pendiente` y devuelve. **No ejecuta nada**: eso es del
 * worker. Es lo que permite que la Server Action responda al instante sin
 * romper la regla de que la web no hace trabajo largo.
 *
 * La entrada se valida antes de insertar: una corrida encolada con un mes
 * inválido fallaría recién en el worker, minutos después y lejos del usuario
 * que la pidió.
 *
 * **Rechaza si ya hay una corrida viva para esa marca, ese flujo y ese
 * periodo.** Las dos pantallas ya esconden el botón mientras haya una en
 * vuelo, pero eso es un render de servidor: dos pestañas abiertas, o una
 * pestaña vieja, lo esquivan. Medido antes de esta guarda: dos `encolarGrilla`
 * seguidos daban dos corridas sin una queja, el worker ejecutaba las dos y
 * `ai_calls` terminaba en 2. Encima `corridaDe` devuelve solo la más reciente,
 * así que la segunda se paga sin aparecer en ninguna pantalla.
 *
 * **Queda una ventana de carrera**, y es a propósito: dos peticiones
 * simultáneas pueden pasar las dos por el SELECT antes de que ninguna inserte.
 * Cerrarla exige un índice único parcial sobre `(brand_id, flow, input->>…)`
 * limitado a los estados vivos, o sea una migración. Está registrado en
 * `pendientes.md`. Lo que esta guarda sí cierra es el caso real —dos clics
 * separados por segundos, desde dos pestañas—, que es por donde ocurrió.
 *
 * El `input` se arma aquí con la clave que declara `PERIODO_EN_LA_ENTRADA`, y
 * no en cada sitio de llamada: así la fila que se inserta y la consulta que la
 * busca no pueden nombrar el periodo distinto.
 */
async function encolar(
  db: BaseDeDatos,
  organizationId: string,
  flujo: FlujoEncolable,
  ref: { brandId: string; slug: string },
  periodo: string,
): Promise<string> {
  const { clave, coincide, genera } = PERIODO_EN_LA_ENTRADA[flujo]

  const [viva] = await db
    .select({ status: esquema.pipelineRuns.status })
    .from(esquema.pipelineRuns)
    .where(
      and(
        eq(esquema.pipelineRuns.organizationId, organizationId),
        eq(esquema.pipelineRuns.brandId, ref.brandId),
        eq(esquema.pipelineRuns.flow, flujo),
        inArray(esquema.pipelineRuns.status, [...ESTADOS_VIVOS]),
        coincide(periodo),
      ),
    )
    .limit(1)

  if (viva) {
    throw permanente(
      `Ya se está generando ${genera} de ${periodo} para la marca ${ref.slug}: ` +
        `la generación anterior está ${viva.status === 'pendiente' ? 'en cola' : 'en curso'}. ` +
        'Espera a que termine — pedirla de nuevo no la apura y paga el modelo otra vez.',
    )
  }

  const [fila] = await db
    .insert(esquema.pipelineRuns)
    .values({
      organizationId,
      brandId: ref.brandId,
      flow: flujo,
      status: 'pendiente',
      input: { brandId: ref.brandId, [clave]: periodo },
    })
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

  // Se comprueba antes de encolar para que el aviso llegue en la pantalla, en
  // vez de que el worker despierte, falle y lo deje anotado en una corrida.
  // La guarda autoritativa vive en P1: esta es la que hace que el error se vea
  // donde se puede arreglar.
  const encargo = await leerEncargo(db, organizationId, args)
  if (encargo.tipo === 'ausente') {
    throw permanente(
      `Para generar la estrategia de ${args.periodo} falta escribir el encargo del trimestre: ` +
        'qué quieres lograr, cómo lo medirás, cuánto puedes publicar y en qué canales. ' +
        `Escríbelo en la pantalla de estrategia de la marca, en \`/${args.slug}/estrategia\`.`,
    )
  }
  // Los dos casos que no son `presente` se distinguen a propósito. Decirle
  // «falta escribir el encargo» a quien lo escribió —y lo tiene lleno en la
  // pantalla— lo manda a buscar un formulario en blanco que no va a
  // encontrar. `motivo` no se interpola: es el volcado de Zod, en inglés.
  if (encargo.tipo === 'invalido') {
    throw permanente(
      `El encargo de ${args.periodo} está escrito pero ya no cumple su esquema, así que no se ` +
        `puede usar para generar. Ábrelo en \`/${args.slug}/estrategia\`, revisa que estén los ` +
        'cuatro campos obligatorios y vuelve a guardarlo.',
    )
  }

  return encolar(
    db, organizationId, 'p1_estrategia', { brandId: ref.brandId, slug: args.slug }, args.periodo,
  )
}

export async function encolarGrilla(
  db: BaseDeDatos,
  organizationId: string,
  args: { slug: string; mes: string },
): Promise<string> {
  validarMes(args.mes)
  const ref = await resolverMarca(db, organizationId, args.slug)
  return encolar(
    db, organizationId, 'p2_grilla', { brandId: ref.brandId, slug: args.slug }, args.mes,
  )
}

/**
 * Encola una corrida de `p3_pieza` por cada slot no descartado del mes que
 * todavía no tiene texto ni corrida viva. Es la decisión de arquitectura del
 * bloque: una pieza es una corrida independiente, no un paso dentro de una
 * corrida de la grilla entera, así que un slot que falla no arrastra a los
 * otros y regenerar una sola pieza es encolar una corrida más.
 *
 * **No usa el ayudante `encolar`.** Ese ayudante rechaza una segunda corrida
 * viva de la misma marca, el mismo flujo y el mismo periodo — exactamente lo
 * que hace falta permitir acá, porque veinte piezas del mismo mes son veinte
 * corridas de `p3_pieza` del mismo mes. La guarda equivalente es más angosta,
 * por slot: no encolar el slot que ya tiene una corrida viva, y no encolar el
 * que ya tiene pieza.
 *
 * **Exige que la grilla del mes esté `aprobada`.** Generar piezas sobre un
 * borrador invita a seguir editando la grilla después y a que esa edición
 * —o una regeneración— tire veinte textos que ya se pagaron. La guarda es
 * autoritativa acá, no solo un aviso en pantalla, porque no hay ningún P3
 * que la repita más abajo.
 */
export async function encolarPiezas(
  db: BaseDeDatos,
  organizationId: string,
  args: { slug: string; mes: string },
): Promise<{ encoladas: number }> {
  validarMes(args.mes)
  const ref = await resolverMarca(db, organizationId, args.slug)

  const [plan] = await db
    .select({ id: esquema.contentPlans.id, status: esquema.contentPlans.status })
    .from(esquema.contentPlans)
    .where(
      and(
        eq(esquema.contentPlans.organizationId, organizationId),
        eq(esquema.contentPlans.brandId, ref.brandId),
        eq(esquema.contentPlans.month, `${args.mes}-01`),
      ),
    )

  if (!plan || plan.status !== 'aprobada') {
    throw permanente(
      `La grilla de ${args.mes} para la marca ${args.slug} está en estado ` +
        `"${plan?.status ?? 'sin generar'}" y las piezas solo se generan sobre una grilla ` +
        'aprobada. Apruébala primero en su pantalla: generar sobre un borrador invita a ' +
        'seguir editando la grilla después y a tirar textos que ya se pagaron.',
    )
  }

  const slotsVigentes = await db
    .select({ id: esquema.planSlots.id })
    .from(esquema.planSlots)
    .where(
      and(
        eq(esquema.planSlots.contentPlanId, plan.id),
        eq(esquema.planSlots.organizationId, organizationId),
        ne(esquema.planSlots.status, 'descartado'),
      ),
    )
  const idsDeSlots = slotsVigentes.map((s) => s.id)
  if (idsDeSlots.length === 0) return { encoladas: 0 }

  const conPieza = await db
    .select({ planSlotId: esquema.contentPieces.planSlotId })
    .from(esquema.contentPieces)
    .where(
      and(
        eq(esquema.contentPieces.organizationId, organizationId),
        inArray(esquema.contentPieces.planSlotId, idsDeSlots),
      ),
    )
  const idsConPieza = new Set(conPieza.map((p) => p.planSlotId))

  // El `slotId` se lee del `input` con la misma extracción de jsonb que usa
  // el resto del archivo: no hace falta cruzar por `mes` además, porque cada
  // slot pertenece a un único plan y su id ya lo desambigua.
  const corridasVivas = await db
    .select({ slotId: sql<string>`${esquema.pipelineRuns.input}->>'slotId'` })
    .from(esquema.pipelineRuns)
    .where(
      and(
        eq(esquema.pipelineRuns.organizationId, organizationId),
        eq(esquema.pipelineRuns.brandId, ref.brandId),
        eq(esquema.pipelineRuns.flow, 'p3_pieza'),
        inArray(esquema.pipelineRuns.status, [...ESTADOS_VIVOS]),
      ),
    )
  const idsConCorridaViva = new Set(corridasVivas.map((c) => c.slotId))

  const candidatos = idsDeSlots.filter(
    (id) => !idsConPieza.has(id) && !idsConCorridaViva.has(id),
  )
  if (candidatos.length === 0) return { encoladas: 0 }

  await db.insert(esquema.pipelineRuns).values(
    candidatos.map((slotId) => ({
      organizationId,
      brandId: ref.brandId,
      flow: 'p3_pieza' as const,
      status: 'pendiente' as const,
      input: { slotId, mes: args.mes, brandId: ref.brandId },
    })),
  )

  return { encoladas: candidatos.length }
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
  // `db.execute` con `node-postgres` devuelve un `QueryResult` con las filas
  // adentro, no el arreglo directamente: hay que desestructurar `rows`.
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
  const { rows } = await db.execute(sql`
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
  `)
  const filas = rows as unknown as FilaTomada[]

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

  // La misma declaración con la que `encolar` arma el `input`: la fila que se
  // escribe y la consulta que la busca no pueden nombrar el periodo distinto
  // porque el nombre está en un solo lugar.
  const periodoCoincide = PERIODO_EN_LA_ENTRADA[args.flujo].coincide(args.periodo)

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
