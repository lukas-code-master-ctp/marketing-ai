import { sql } from 'drizzle-orm'
import {
  check, date, foreignKey, index, integer, jsonb, numeric, pgTable, text,
  timestamp, unique, uuid,
} from 'drizzle-orm/pg-core'
import { CANALES } from './canales.js'

// Reexportados desde `./canales`, y no declarados acá: ese módulo existe para
// que un componente de cliente los importe sin arrastrar el DDL de las dieciséis
// tablas de este archivo al bundle del navegador (ver su cabecera). Esta
// reexportación es lo que mantiene una sola fuente de verdad: todo lo que ya
// importaba `CANALES`/`Canal` del barril o de `./esquema` sigue resolviendo.
export { CANALES, type Canal } from './canales.js'

export const POLITICAS = ['auto', 'manual', 'asistido'] as const
export type PoliticaDeAprobacion = (typeof POLITICAS)[number]

export const NIVELES = ['razonamiento', 'redaccion', 'utilitario'] as const
export type Nivel = (typeof NIVELES)[number]

/**
 * `imagen` no la usa nadie hoy y está a propósito: el bloque 2D trae los
 * modelos de imagen, que no son otro nivel sino otra modalidad —`@gc/ai`
 * pide JSON y valida con Zod; un modelo de imagen devuelve una imagen—.
 * Sin este valor, 2D tendría que migrar la tabla antes de sembrar su
 * primera fila.
 */
export const MODALIDADES = ['chat', 'imagen'] as const

const id = () => uuid('id').primaryKey().default(sql`gen_random_uuid()`)
const creadoEn = () => timestamp('created_at', { withTimezone: true }).notNull().defaultNow()

// `text(col, { enum })` de Drizzle solo tipa en TypeScript; no genera ninguna
// restricción en Postgres. Para que la base rechace valores fuera del enum
// (ver esquema.test.ts) cada columna `text(..., { enum })` lleva su propio
// CHECK explícito, generado con este helper para mantener el mismo criterio
// y la misma convención de nombre en todas.
// El nombre de columna se interpola directo en el SQL vía `sql.raw`, así que
// este helper solo debe recibir constantes literales definidas en este
// archivo (como CANALES o los ESTADOS_*), nunca valores dinámicos o provistos
// por el usuario.
const chequeoEnum = (nombreRestriccion: string, columna: string, valores: readonly string[]) =>
  check(nombreRestriccion, sql.raw(`${columna} in (${valores.map((v) => `'${v}'`).join(', ')})`))

// Exportado —a diferencia de los otros ESTADOS_*— porque el lector de
// estrategias de `@gc/strategy` deriva de él el tipo del estado que devuelve,
// y repetir la lista allá sería una segunda fuente de verdad.
export const ESTADOS_STRATEGY = ['borrador', 'aprobada', 'archivada'] as const
const ESTADOS_CONTENT_PLAN = ['borrador', 'aprobada', 'en_ejecucion', 'cerrada'] as const
const ESTADOS_PLAN_SLOT = ['planificado', 'descartado'] as const
// `pendiente` es el estado de una corrida encolada por la web y todavía no
// tomada por el worker. Los pasos comparten la constante por simetría, pero
// ninguno nace `pendiente`: el motor los crea `en_curso` al empezarlos.
export const ESTADOS_PIPELINE = ['pendiente', 'en_curso', 'completado', 'fallido'] as const

export const organizations = pgTable('organizations', {
  id: id(),
  name: text('name').notNull(),
  slug: text('slug').notNull().unique(),
  createdAt: creadoEn(),
})

/**
 * Las personas que pueden entrar a la web. Se llena sola en el primer inicio
 * de sesión exitoso, con un upsert por correo.
 *
 * No lleva `organization_id` a propósito: hoy hay una sola organización y las
 * tres personas la comparten. Atar usuarios a organizaciones es el diseño que
 * hace falta cuando haya equipos distintos por marca, y eso está explícitamente
 * fuera de alcance.
 *
 * Quién puede entrar NO se decide aquí sino en la lista de correos permitidos
 * de la variable de entorno: esta tabla registra a quien ya entró, no autoriza.
 */
export const users = pgTable('users', {
  id: id(),
  email: text('email').notNull().unique(),
  name: text('name'),
  createdAt: creadoEn(),
})

// Multi-tenencia exigible: cada tabla lleva `organization_id`, pero una clave
// foránea simple hacia el padre no impide que la fila declare una organización
// distinta a la de ese padre. Por eso las tablas padre (`brands`, `strategies`,
// `content_plans`, `pipeline_runs`, `plan_slots`) llevan una única sobre
// (id, organization_id) y cada hija apunta con una clave foránea COMPUESTA
// (<padre>_id, organization_id). Así es Postgres —y no la capa de
// aplicación— quien rechaza una fila cuya organización no coincida con la de
// su padre. Al declarar la compuesta hay que quitar el `.references()` de la
// columna, o quedarían las dos restricciones sobre lo mismo.
export const brands = pgTable('brands', {
  id: id(),
  organizationId: uuid('organization_id').notNull()
    .references(() => organizations.id, { onDelete: 'cascade' }),
  slug: text('slug').notNull(),
  name: text('name').notNull(),
  monthlyBudgetUsd: numeric('monthly_budget_usd', { precision: 10, scale: 2 })
    .notNull().default('25.00'),
  createdAt: creadoEn(),
}, (t) => ({
  slugPorOrg: unique().on(t.organizationId, t.slug),
  // Destino de las claves foráneas compuestas de las tablas hijas: sin esta
  // única, Postgres no aceptaría referenciar (id, organization_id).
  idPorOrg: unique('brands_id_organization_id_unique').on(t.id, t.organizationId),
}))

export const brandProfiles = pgTable('brand_profiles', {
  id: id(),
  organizationId: uuid('organization_id').notNull()
    .references(() => organizations.id, { onDelete: 'cascade' }),
  brandId: uuid('brand_id').notNull(),
  version: integer('version').notNull(),
  data: jsonb('data').notNull(),
  createdAt: creadoEn(),
  createdBy: uuid('created_by').references(() => users.id, { onDelete: 'set null' }),
}, (t) => ({
  versionPorMarca: unique().on(t.brandId, t.version),
  marcaPorOrg: foreignKey({
    columns: [t.brandId, t.organizationId],
    foreignColumns: [brands.id, brands.organizationId],
    name: 'brand_profiles_brand_org_fk',
  }).onDelete('cascade'),
}))

export const channelAccounts = pgTable('channel_accounts', {
  id: id(),
  organizationId: uuid('organization_id').notNull()
    .references(() => organizations.id, { onDelete: 'cascade' }),
  brandId: uuid('brand_id').notNull(),
  channel: text('channel', { enum: CANALES }).notNull(),
  mode: text('mode').notNull().default('blog_api'),
  secretRef: text('secret_ref'),
  expiresAt: timestamp('expires_at', { withTimezone: true }),
  config: jsonb('config').notNull().default({}),
  createdAt: creadoEn(),
}, (t) => ({
  canalPorMarca: unique().on(t.brandId, t.channel),
  canalValido: chequeoEnum('channel_accounts_channel_check', 'channel', CANALES),
  marcaPorOrg: foreignKey({
    columns: [t.brandId, t.organizationId],
    foreignColumns: [brands.id, brands.organizationId],
    name: 'channel_accounts_brand_org_fk',
  }).onDelete('cascade'),
}))

export const approvalPolicies = pgTable('approval_policies', {
  id: id(),
  organizationId: uuid('organization_id').notNull()
    .references(() => organizations.id, { onDelete: 'cascade' }),
  brandId: uuid('brand_id').notNull(),
  channel: text('channel', { enum: CANALES }).notNull(),
  policy: text('policy', { enum: POLITICAS }).notNull(),
}, (t) => ({
  politicaPorCanal: unique().on(t.brandId, t.channel),
  canalValido: chequeoEnum('approval_policies_channel_check', 'channel', CANALES),
  politicaValida: chequeoEnum('approval_policies_policy_check', 'policy', POLITICAS),
  marcaPorOrg: foreignKey({
    columns: [t.brandId, t.organizationId],
    foreignColumns: [brands.id, brands.organizationId],
    name: 'approval_policies_brand_org_fk',
  }).onDelete('cascade'),
}))

export const strategies = pgTable('strategies', {
  id: id(),
  organizationId: uuid('organization_id').notNull()
    .references(() => organizations.id, { onDelete: 'cascade' }),
  brandId: uuid('brand_id').notNull(),
  period: text('period').notNull(),
  status: text('status', { enum: ESTADOS_STRATEGY })
    .notNull().default('borrador'),
  data: jsonb('data').notNull(),
  brandProfileVersion: integer('brand_profile_version').notNull(),
  createdAt: creadoEn(),
}, (t) => ({
  periodoPorMarca: unique().on(t.brandId, t.period),
  estadoValido: chequeoEnum('strategies_status_check', 'status', ESTADOS_STRATEGY),
  idPorOrg: unique('strategies_id_organization_id_unique').on(t.id, t.organizationId),
  marcaPorOrg: foreignKey({
    columns: [t.brandId, t.organizationId],
    foreignColumns: [brands.id, brands.organizationId],
    name: 'strategies_brand_org_fk',
  }).onDelete('cascade'),
}))

/**
 * Lo que la persona responde antes de generar la estrategia de un trimestre.
 * Una fila por marca y periodo, igual que `strategies`.
 *
 * No lleva la única `(id, organization_id)` que sí tienen `strategies` y
 * `brands`: esa existe para que otras tablas puedan apuntar a ellas con una
 * foránea compuesta, y nada apunta a un encargo. Agregarla «por simetría»
 * sería un índice que nadie usa.
 */
export const strategyBriefs = pgTable('strategy_briefs', {
  id: id(),
  organizationId: uuid('organization_id').notNull()
    .references(() => organizations.id, { onDelete: 'cascade' }),
  brandId: uuid('brand_id').notNull(),
  period: text('period').notNull(),
  data: jsonb('data').notNull(),
  createdAt: creadoEn(),
  createdBy: uuid('created_by').references(() => users.id, { onDelete: 'set null' }),
}, (t) => ({
  periodoPorMarca: unique().on(t.brandId, t.period),
  marcaPorOrg: foreignKey({
    columns: [t.brandId, t.organizationId],
    foreignColumns: [brands.id, brands.organizationId],
    name: 'strategy_briefs_brand_org_fk',
  }).onDelete('cascade'),
}))

export const contentPlans = pgTable('content_plans', {
  id: id(),
  organizationId: uuid('organization_id').notNull()
    .references(() => organizations.id, { onDelete: 'cascade' }),
  brandId: uuid('brand_id').notNull(),
  strategyId: uuid('strategy_id'),
  month: date('month').notNull(),
  status: text('status', {
    enum: ESTADOS_CONTENT_PLAN,
  }).notNull().default('borrador'),
  createdAt: creadoEn(),
  approvedBy: uuid('approved_by').references(() => users.id, { onDelete: 'set null' }),
  reopenedBy: uuid('reopened_by').references(() => users.id, { onDelete: 'set null' }),
}, (t) => ({
  mesPorMarca: unique().on(t.brandId, t.month),
  estadoValido: chequeoEnum('content_plans_status_check', 'status', ESTADOS_CONTENT_PLAN),
  idPorOrg: unique('content_plans_id_organization_id_unique').on(t.id, t.organizationId),
  marcaPorOrg: foreignKey({
    columns: [t.brandId, t.organizationId],
    foreignColumns: [brands.id, brands.organizationId],
    name: 'content_plans_brand_org_fk',
  }).onDelete('cascade'),
  // ⚠️ AQUÍ EL SQL NO COINCIDE CON ESTE ESQUEMA. LEER ANTES DE REGENERAR. ⚠️
  //
  // Lo que dice esta declaración:  ON DELETE SET NULL
  // Lo que hay en la base de datos: ON DELETE SET NULL ("strategy_id")
  //
  // Mismo caso que `aiCalls.corridaPorOrg`: `SET NULL` sobre una compuesta
  // anula TODAS sus columnas, y `content_plans.organization_id` es NOT NULL,
  // así que la forma simple revienta con 23502 al borrar una estrategia que
  // tenga planes colgando. La forma con lista de columnas (Postgres 15+) anula
  // solo `strategy_id` y deja el plan vivo, que es la semántica que tenía la
  // clave simple original.
  //
  // Sin esta compuesta, un plan de la organización A podía apuntar a una
  // estrategia de la B: P2 lee la estrategia del plan, así que un join
  // terminaba sirviendo la estrategia de otro inquilino.
  //
  // drizzle-kit 0.28 NO sabe expresar la lista de columnas: la sentencia real
  // se escribió a mano en `migraciones/0002_empty_kulan_gath.sql`.
  // CONSECUENCIA: regenerar esta restricción reintroduce el bug y hay que
  // repetir la edición. La prueba «conserva los planes al borrar su
  // estrategia, anulando solo strategy_id» es la red que lo detecta.
  estrategiaPorOrg: foreignKey({
    columns: [t.strategyId, t.organizationId],
    foreignColumns: [strategies.id, strategies.organizationId],
    name: 'content_plans_strategy_org_fk',
  }).onDelete('set null'),
}))

export const planSlots = pgTable('plan_slots', {
  id: id(),
  organizationId: uuid('organization_id').notNull()
    .references(() => organizations.id, { onDelete: 'cascade' }),
  contentPlanId: uuid('content_plan_id').notNull(),
  sourceSlotId: uuid('source_slot_id'),
  scheduledFor: timestamp('scheduled_for', { withTimezone: true }).notNull(),
  channel: text('channel', { enum: CANALES }).notNull(),
  format: text('format').notNull(),
  pillar: text('pillar').notNull(),
  angle: text('angle').notNull(),
  brief: text('brief').notNull(),
  status: text('status', { enum: ESTADOS_PLAN_SLOT })
    .notNull().default('planificado'),
  createdAt: creadoEn(),
}, (t) => ({
  porPlan: index('plan_slots_por_plan').on(t.contentPlanId, t.scheduledFor),
  canalValido: chequeoEnum('plan_slots_channel_check', 'channel', CANALES),
  estadoValido: chequeoEnum('plan_slots_status_check', 'status', ESTADOS_PLAN_SLOT),
  idPorOrg: unique('plan_slots_id_organization_id_unique').on(t.id, t.organizationId),
  planPorOrg: foreignKey({
    columns: [t.contentPlanId, t.organizationId],
    foreignColumns: [contentPlans.id, contentPlans.organizationId],
    name: 'plan_slots_plan_org_fk',
  }).onDelete('cascade'),
  // Autorreferencia: un derivado cuelga de otro slot de la MISMA organización.
  // Antes `source_slot_id` era un uuid suelto, sin clave foránea alguna.
  //
  // NO ACTION en vez de CASCADE: borrar un artículo ya no se lleva sus
  // adaptaciones en silencio. La UI descarta con status = 'descartado'.
  //
  // Frente a RESTRICT la diferencia es sutil y conviene no confundirla: con la
  // restricción NOT DEFERRABLE, como está aquí, ambos se verifican al final de
  // la sentencia, así que el borrado masivo de la regeneración funciona igual
  // con los dos. Se elige NO ACTION porque es el único que se puede diferir de
  // verdad si alguna vez hace falta reordenar derivados dentro de una
  // transacción: RESTRICT acepta la palabra DEFERRABLE, pero su verificación
  // se sigue haciendo al final de cada sentencia.
  origenPorOrg: foreignKey({
    columns: [t.sourceSlotId, t.organizationId],
    foreignColumns: [t.id, t.organizationId],
    name: 'plan_slots_source_org_fk',
  }),
}))

/**
 * El texto de una pieza: la **ejecución** de lo que el slot planificó.
 *
 * Una fila por slot —única sobre `plan_slot_id`—, así que regenerar reemplaza
 * en vez de acumular. Las versiones y la autoría son de `content_revisions`,
 * que llega con el editor (bloque 2C): hoy no hay edición humana, así que una
 * tabla de revisiones solo registraría a la IA repitiéndose.
 *
 * `channel` se copia del slot a propósito: el esquema Zod está discriminado
 * por canal, y leerlo del slot en cada validación obligaría a una consulta más
 * justo donde importa que sea barato.
 *
 * No lleva columna de estado. La máquina de estados de una pieza —`en_qa`,
 * `en_revision`, `aprobada`— pertenece a los bloques que la usan (2B y 2C);
 * acá la pieza existe o no existe, y el avance de la generación ya lo cuentan
 * las corridas.
 */
export const contentPieces = pgTable('content_pieces', {
  id: id(),
  organizationId: uuid('organization_id').notNull()
    .references(() => organizations.id, { onDelete: 'cascade' }),
  planSlotId: uuid('plan_slot_id').notNull().unique(),
  channel: text('channel', { enum: CANALES }).notNull(),
  data: jsonb('data').notNull(),
  brandProfileVersion: integer('brand_profile_version').notNull(),
  createdAt: creadoEn(),
}, (t) => ({
  canalValido: chequeoEnum('content_pieces_channel_check', 'channel', CANALES),
  slotPorOrg: foreignKey({
    columns: [t.planSlotId, t.organizationId],
    foreignColumns: [planSlots.id, planSlots.organizationId],
    name: 'content_pieces_slot_org_fk',
  }).onDelete('cascade'),
}))

export const pipelineRuns = pgTable('pipeline_runs', {
  id: id(),
  organizationId: uuid('organization_id').notNull()
    .references(() => organizations.id, { onDelete: 'cascade' }),
  brandId: uuid('brand_id'),
  flow: text('flow').notNull(),
  status: text('status', { enum: ESTADOS_PIPELINE })
    .notNull().default('en_curso'),
  input: jsonb('input').notNull().default({}),
  error: text('error'),
  startedAt: creadoEn(),
  finishedAt: timestamp('finished_at', { withTimezone: true }),
}, (t) => ({
  estadoValido: chequeoEnum('pipeline_runs_status_check', 'status', ESTADOS_PIPELINE),
  idPorOrg: unique('pipeline_runs_id_organization_id_unique').on(t.id, t.organizationId),
  marcaPorOrg: foreignKey({
    columns: [t.brandId, t.organizationId],
    foreignColumns: [brands.id, brands.organizationId],
    name: 'pipeline_runs_brand_org_fk',
  }).onDelete('cascade'),
}))

export const pipelineSteps = pgTable('pipeline_steps', {
  id: id(),
  organizationId: uuid('organization_id').notNull()
    .references(() => organizations.id, { onDelete: 'cascade' }),
  runId: uuid('run_id').notNull(),
  name: text('name').notNull(),
  status: text('status', { enum: ESTADOS_PIPELINE }).notNull(),
  attempt: integer('attempt').notNull().default(1),
  idempotencyKey: text('idempotency_key').notNull(),
  input: jsonb('input'),
  output: jsonb('output'),
  error: text('error'),
  startedAt: creadoEn(),
  finishedAt: timestamp('finished_at', { withTimezone: true }),
}, (t) => ({
  claveUnica: unique().on(t.idempotencyKey),
  estadoValido: chequeoEnum('pipeline_steps_status_check', 'status', ESTADOS_PIPELINE),
  corridaPorOrg: foreignKey({
    columns: [t.runId, t.organizationId],
    foreignColumns: [pipelineRuns.id, pipelineRuns.organizationId],
    name: 'pipeline_steps_run_org_fk',
  }).onDelete('cascade'),
}))

export const aiCalls = pgTable('ai_calls', {
  id: id(),
  organizationId: uuid('organization_id').notNull()
    .references(() => organizations.id, { onDelete: 'cascade' }),
  brandId: uuid('brand_id'),
  runId: uuid('run_id'),
  task: text('task').notNull(),
  model: text('model').notNull(),
  tokensIn: integer('tokens_in').notNull().default(0),
  tokensOut: integer('tokens_out').notNull().default(0),
  costUsd: numeric('cost_usd', { precision: 12, scale: 6 }).notNull().default('0'),
  latencyMs: integer('latency_ms').notNull().default(0),
  promptHash: text('prompt_hash').notNull(),
  brandProfileVersion: integer('brand_profile_version'),
  createdAt: creadoEn(),
}, (t) => ({
  porMarcaYFecha: index('ai_calls_por_marca_fecha').on(t.brandId, t.createdAt),
  marcaPorOrg: foreignKey({
    columns: [t.brandId, t.organizationId],
    foreignColumns: [brands.id, brands.organizationId],
    name: 'ai_calls_brand_org_fk',
  }).onDelete('cascade'),
  // ⚠️ AQUÍ EL SQL NO COINCIDE CON ESTE ESQUEMA. LEER ANTES DE REGENERAR. ⚠️
  //
  // Lo que dice esta declaración:  ON DELETE SET NULL
  // Lo que hay en la base de datos: ON DELETE SET NULL ("run_id")
  //
  // Por qué: `SET NULL` sobre una clave foránea COMPUESTA anula TODAS sus
  // columnas, y `ai_calls.organization_id` es NOT NULL. Con la forma simple,
  // borrar un `pipeline_run` que tenga `ai_calls` colgando revienta con
  // 23502 (not-null violation) en lugar de conservar la fila. Y esa fila
  // tiene que sobrevivir: `cost_usd` es lo que suma el guardián de
  // presupuesto, así que perder el gasto histórico al borrar una corrida
  // debilitaría en silencio la única barrera del sistema con plata detrás.
  //
  // La forma con lista de columnas (Postgres 15+, acá corremos 16) anula
  // solo `run_id` y deja intacta `organization_id`. drizzle-kit 0.28 NO sabe
  // expresarla: por eso la declaración de abajo dice `set null` a secas y la
  // sentencia real se escribió a mano en
  // `migraciones/0002_empty_kulan_gath.sql`, que reemplaza la versión
  // rota que `0001` había creado.
  //
  // CONSECUENCIA: si algún día se regenera esta restricción con
  // `drizzle-kit generate`, la migración nueva volverá a emitir el `SET NULL`
  // sin lista de columnas y reintroducirá el bug. Hay que reaplicar la misma
  // edición a mano. La prueba
  // «conserva la llamada de IA al borrar su corrida, anulando solo run_id»
  // en `esquema.test.ts` es la red que lo detecta.
  corridaPorOrg: foreignKey({
    columns: [t.runId, t.organizationId],
    foreignColumns: [pipelineRuns.id, pipelineRuns.organizationId],
    name: 'ai_calls_run_org_fk',
  }).onDelete('set null'),
}))

/**
 * El menú de modelos entre los que se puede elegir. **Global, sin
 * organización**: es configuración del sistema y no datos de un inquilino,
 * así que las tres marcas eligen del mismo menú.
 *
 * Los precios son por millón de tokens y están para poder elegir, no para
 * calcular: lo que se cobró de verdad lo registra `ai_calls` llamada por
 * llamada.
 */
export const modelCatalog = pgTable('model_catalog', {
  id: id(),
  level: text('level', { enum: NIVELES }).notNull(),
  modelId: text('model_id').notNull(),
  label: text('label').notNull(),
  description: text('description').notNull(),
  modality: text('modality', { enum: MODALIDADES }).notNull().default('chat'),
  priceInputUsd: numeric('price_input_usd', { precision: 10, scale: 4 }).notNull(),
  priceOutputUsd: numeric('price_output_usd', { precision: 10, scale: 4 }).notNull(),
  createdAt: creadoEn(),
}, (t) => ({
  nivelValido: chequeoEnum('model_catalog_level_check', 'level', NIVELES),
  modalidadValida: chequeoEnum('model_catalog_modality_check', 'modality', MODALIDADES),
  unicoPorNivel: unique('model_catalog_level_model_unique').on(t.level, t.modelId),
}))

/**
 * Qué eligió cada organización para cada nivel. El respaldo es opcional
 * porque `guardarEleccionDeModelo` (`packages/operaciones/src/modelos.ts`)
 * acepta `respaldoId: null` y la pantalla de configuración ofrece
 * explícitamente «Sin respaldo»: quien opera puede no querer pagar un
 * segundo modelo. También conserva el comportamiento previo a esta rama,
 * donde la variable de entorno de respaldo vacía caía al principal. Por eso
 * `respaldo_id` queda nulable, y `modelosDelNivel` (mismo archivo) devuelve
 * el principal en los dos cuando no hay respaldo elegido.
 *
 * Las dos foráneas son simples y no compuestas: `organizations` es la raíz
 * de la tenencia y `model_catalog` es global, así que no hay un par
 * (id, organization_id) que exigir.
 */
export const organizationModels = pgTable('organization_models', {
  id: id(),
  organizationId: uuid('organization_id').notNull()
    .references(() => organizations.id, { onDelete: 'cascade' }),
  level: text('level', { enum: NIVELES }).notNull(),
  principalId: uuid('principal_id').notNull()
    .references(() => modelCatalog.id, { onDelete: 'restrict' }),
  respaldoId: uuid('respaldo_id')
    .references(() => modelCatalog.id, { onDelete: 'restrict' }),
  // No usa `creadoEn()`: ese ayudante nombra la columna física `created_at`,
  // que en cada otra tabla coincide con «cuándo se creó la fila» porque crear
  // y empezar son el mismo instante. Acá no: esta fila se actualiza con cada
  // cambio de elección, así que el nombre tiene que decir `updated_at` de
  // verdad. Y por no llevar `$onUpdate`, quien escriba (`onConflictDoUpdate`,
  // en la tarea que sigue) tiene que poner este valor a mano en cada cambio;
  // si no lo hace, la columna conserva en silencio la fecha de la primera
  // elección y el registro de «cuándo se cambió» queda falso.
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  updatedBy: uuid('updated_by').references(() => users.id, { onDelete: 'set null' }),
}, (t) => ({
  nivelValido: chequeoEnum('organization_models_level_check', 'level', NIVELES),
  unicoPorNivel: unique('organization_models_org_level_unique').on(t.organizationId, t.level),
}))

export const esquema = {
  organizations, users, brands, brandProfiles, channelAccounts, approvalPolicies,
  strategies, strategyBriefs, contentPlans, planSlots, contentPieces,
  pipelineRuns, pipelineSteps, aiCalls, modelCatalog, organizationModels,
}
