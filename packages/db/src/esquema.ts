import { sql } from 'drizzle-orm'
import {
  check, date, index, integer, jsonb, numeric, pgTable, text,
  timestamp, unique, uuid,
} from 'drizzle-orm/pg-core'

export const CANALES = ['instagram', 'linkedin', 'facebook', 'tiktok', 'blog'] as const
export type Canal = (typeof CANALES)[number]

export const POLITICAS = ['auto', 'manual', 'asistido'] as const
export type PoliticaDeAprobacion = (typeof POLITICAS)[number]

const id = () => uuid('id').primaryKey().default(sql`gen_random_uuid()`)
const creadoEn = () => timestamp('created_at', { withTimezone: true }).notNull().defaultNow()

export const organizations = pgTable('organizations', {
  id: id(),
  name: text('name').notNull(),
  createdAt: creadoEn(),
})

export const brands = pgTable('brands', {
  id: id(),
  organizationId: uuid('organization_id').notNull()
    .references(() => organizations.id, { onDelete: 'cascade' }),
  slug: text('slug').notNull(),
  name: text('name').notNull(),
  monthlyBudgetUsd: numeric('monthly_budget_usd', { precision: 10, scale: 2 })
    .notNull().default('25.00'),
  createdAt: creadoEn(),
}, (t) => ({ slugPorOrg: unique().on(t.organizationId, t.slug) }))

export const brandProfiles = pgTable('brand_profiles', {
  id: id(),
  organizationId: uuid('organization_id').notNull()
    .references(() => organizations.id, { onDelete: 'cascade' }),
  brandId: uuid('brand_id').notNull()
    .references(() => brands.id, { onDelete: 'cascade' }),
  version: integer('version').notNull(),
  data: jsonb('data').notNull(),
  createdAt: creadoEn(),
}, (t) => ({ versionPorMarca: unique().on(t.brandId, t.version) }))

export const channelAccounts = pgTable('channel_accounts', {
  id: id(),
  organizationId: uuid('organization_id').notNull()
    .references(() => organizations.id, { onDelete: 'cascade' }),
  brandId: uuid('brand_id').notNull()
    .references(() => brands.id, { onDelete: 'cascade' }),
  channel: text('channel', { enum: CANALES }).notNull(),
  mode: text('mode').notNull().default('blog_api'),
  secretRef: text('secret_ref'),
  expiresAt: timestamp('expires_at', { withTimezone: true }),
  config: jsonb('config').notNull().default({}),
  createdAt: creadoEn(),
}, (t) => ({ canalPorMarca: unique().on(t.brandId, t.channel) }))

export const approvalPolicies = pgTable('approval_policies', {
  id: id(),
  organizationId: uuid('organization_id').notNull()
    .references(() => organizations.id, { onDelete: 'cascade' }),
  brandId: uuid('brand_id').notNull()
    .references(() => brands.id, { onDelete: 'cascade' }),
  channel: text('channel', { enum: CANALES }).notNull(),
  policy: text('policy', { enum: POLITICAS }).notNull(),
}, (t) => ({
  politicaPorCanal: unique().on(t.brandId, t.channel),
  // `text(..., { enum })` de Drizzle solo tipa en TypeScript; no genera
  // restricción en la base. Esta tabla necesita rechazo real en Postgres
  // (ver esquema.test.ts), así que se agrega el CHECK explícito.
  politicaValida: check(
    'approval_policies_policy_check',
    sql.raw(`policy in (${POLITICAS.map((p) => `'${p}'`).join(', ')})`),
  ),
}))

export const strategies = pgTable('strategies', {
  id: id(),
  organizationId: uuid('organization_id').notNull()
    .references(() => organizations.id, { onDelete: 'cascade' }),
  brandId: uuid('brand_id').notNull()
    .references(() => brands.id, { onDelete: 'cascade' }),
  period: text('period').notNull(),
  status: text('status', { enum: ['borrador', 'aprobada', 'archivada'] })
    .notNull().default('borrador'),
  data: jsonb('data').notNull(),
  brandProfileVersion: integer('brand_profile_version').notNull(),
  createdAt: creadoEn(),
}, (t) => ({ periodoPorMarca: unique().on(t.brandId, t.period) }))

export const contentPlans = pgTable('content_plans', {
  id: id(),
  organizationId: uuid('organization_id').notNull()
    .references(() => organizations.id, { onDelete: 'cascade' }),
  brandId: uuid('brand_id').notNull()
    .references(() => brands.id, { onDelete: 'cascade' }),
  strategyId: uuid('strategy_id').references(() => strategies.id, { onDelete: 'set null' }),
  month: date('month').notNull(),
  status: text('status', {
    enum: ['borrador', 'aprobada', 'en_ejecucion', 'cerrada'],
  }).notNull().default('borrador'),
  createdAt: creadoEn(),
}, (t) => ({ mesPorMarca: unique().on(t.brandId, t.month) }))

export const planSlots = pgTable('plan_slots', {
  id: id(),
  organizationId: uuid('organization_id').notNull()
    .references(() => organizations.id, { onDelete: 'cascade' }),
  contentPlanId: uuid('content_plan_id').notNull()
    .references(() => contentPlans.id, { onDelete: 'cascade' }),
  sourceSlotId: uuid('source_slot_id'),
  scheduledFor: timestamp('scheduled_for', { withTimezone: true }).notNull(),
  channel: text('channel', { enum: CANALES }).notNull(),
  format: text('format').notNull(),
  pillar: text('pillar').notNull(),
  angle: text('angle').notNull(),
  brief: text('brief').notNull(),
  status: text('status', { enum: ['planificado', 'descartado'] })
    .notNull().default('planificado'),
  createdAt: creadoEn(),
}, (t) => ({ porPlan: index('plan_slots_por_plan').on(t.contentPlanId, t.scheduledFor) }))

export const pipelineRuns = pgTable('pipeline_runs', {
  id: id(),
  organizationId: uuid('organization_id').notNull()
    .references(() => organizations.id, { onDelete: 'cascade' }),
  brandId: uuid('brand_id').references(() => brands.id, { onDelete: 'cascade' }),
  flow: text('flow').notNull(),
  status: text('status', { enum: ['en_curso', 'completado', 'fallido'] })
    .notNull().default('en_curso'),
  input: jsonb('input').notNull().default({}),
  error: text('error'),
  startedAt: creadoEn(),
  finishedAt: timestamp('finished_at', { withTimezone: true }),
})

export const pipelineSteps = pgTable('pipeline_steps', {
  id: id(),
  runId: uuid('run_id').notNull()
    .references(() => pipelineRuns.id, { onDelete: 'cascade' }),
  name: text('name').notNull(),
  status: text('status', { enum: ['en_curso', 'completado', 'fallido'] }).notNull(),
  attempt: integer('attempt').notNull().default(1),
  idempotencyKey: text('idempotency_key').notNull(),
  input: jsonb('input'),
  output: jsonb('output'),
  error: text('error'),
  startedAt: creadoEn(),
  finishedAt: timestamp('finished_at', { withTimezone: true }),
}, (t) => ({ claveUnica: unique().on(t.idempotencyKey) }))

export const aiCalls = pgTable('ai_calls', {
  id: id(),
  organizationId: uuid('organization_id').notNull()
    .references(() => organizations.id, { onDelete: 'cascade' }),
  brandId: uuid('brand_id').references(() => brands.id, { onDelete: 'cascade' }),
  runId: uuid('run_id').references(() => pipelineRuns.id, { onDelete: 'set null' }),
  task: text('task').notNull(),
  model: text('model').notNull(),
  tokensIn: integer('tokens_in').notNull().default(0),
  tokensOut: integer('tokens_out').notNull().default(0),
  costUsd: numeric('cost_usd', { precision: 12, scale: 6 }).notNull().default('0'),
  latencyMs: integer('latency_ms').notNull().default(0),
  promptHash: text('prompt_hash').notNull(),
  brandProfileVersion: integer('brand_profile_version'),
  createdAt: creadoEn(),
}, (t) => ({ porMarcaYFecha: index('ai_calls_por_marca_fecha').on(t.brandId, t.createdAt) }))

export const esquema = {
  organizations, brands, brandProfiles, channelAccounts, approvalPolicies,
  strategies, contentPlans, planSlots, pipelineRuns, pipelineSteps, aiCalls,
}
