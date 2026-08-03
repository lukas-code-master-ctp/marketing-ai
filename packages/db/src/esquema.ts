import { sql } from 'drizzle-orm'
import {
  check, date, foreignKey, index, integer, jsonb, numeric, pgTable, text,
  timestamp, unique, uuid,
} from 'drizzle-orm/pg-core'

export const CANALES = ['instagram', 'linkedin', 'facebook', 'tiktok', 'blog'] as const
export type Canal = (typeof CANALES)[number]

export const POLITICAS = ['auto', 'manual', 'asistido'] as const
export type PoliticaDeAprobacion = (typeof POLITICAS)[number]

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
const ESTADOS_PIPELINE = ['en_curso', 'completado', 'fallido'] as const

export const organizations = pgTable('organizations', {
  id: id(),
  name: text('name').notNull(),
  slug: text('slug').notNull().unique(),
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

export const esquema = {
  organizations, brands, brandProfiles, channelAccounts, approvalPolicies,
  strategies, contentPlans, planSlots, pipelineRuns, pipelineSteps, aiCalls,
}
