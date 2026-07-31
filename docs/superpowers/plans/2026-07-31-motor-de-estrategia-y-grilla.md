# Motor de estrategia y grilla — Plan de implementación

> **Para trabajadores agénticos:** SUB-SKILL REQUERIDA: usa `superpowers:subagent-driven-development` (recomendado) o `superpowers:executing-plans` para implementar este plan tarea por tarea. Los pasos usan sintaxis de casilla (`- [ ]`) para seguimiento.

**Goal:** Construir el motor que, a partir del perfil de marca de una startup, genera su estrategia trimestral y una grilla mensual validada, operable por CLI, con costos de IA registrados y modo seco sin gasto.

**Architecture:** Monorepo pnpm con paquetes de responsabilidad única (`shared`, `db`, `ai`, `pipeline`, `brand`, `strategy`) y una app CLI que los orquesta. Todo el contacto con modelos pasa por `@gc/ai`; todo el estado vive en Postgres; el motor de pipeline aporta reintentos, idempotencia y trazas. Sin UI ni publicación en este plan.

**Tech Stack:** TypeScript 5 (ESM), Node 22, pnpm workspaces, PostgreSQL 16, Drizzle ORM, Zod, Vitest, OpenRouter (API compatible con OpenAI), Docker Compose para Postgres local.

## Global Constraints

- **Node 22 LTS.** Todos los paquetes son ESM (`"type": "module"` en cada `package.json`).
- **Idioma del código:** esquema de base de datos y nombres de tabla/columna en **inglés** (`snake_case`); API de dominio, variables y comentarios en **español**; prompts en español.
- **Nombres de paquetes:** `@gc/shared`, `@gc/db`, `@gc/ai`, `@gc/pipeline`, `@gc/brand`, `@gc/strategy`. La app CLI es `apps/cli`.
- **Zod v3** (`zod@^3`) con `zod-to-json-schema@^3`. No usar helpers específicos de OpenAI.
- **Ninguna salida de modelo se parsea con expresiones regulares.** Toda tarea de IA declara un esquema Zod y valida.
- **Ningún paquete fuera de `@gc/ai` importa `openai` ni menciona nombres de modelos.**
- **Los modelos se leen de variables de entorno**, nunca se escriben literales en el código.
- **Existe un único `.env`, en la raíz del repositorio.** Ningún paquete tiene el suyo. Las pruebas lo cargan con `setupFiles: ['../../vitest.setup.ts']`; los scripts y binarios resuelven la ruta desde `import.meta.url`.
- **Los tipos enumerados del esquema se hacen cumplir en Postgres con `CHECK`**, no solo en TypeScript: `text(col, { enum })` de Drizzle no genera restricción alguna en la base.
- **Toda tabla lleva `organization_id`**, incluso mientras exista una sola organización.
- **Todos los identificadores son UUID v4** generados por la base de datos (`gen_random_uuid()`).
- **Todas las marcas de tiempo son `timestamptz`** y se guardan en UTC.
- **TDD estricto:** ningún paso de implementación se escribe antes de tener su prueba fallando.
- **Commits frecuentes:** un commit por tarea como mínimo, en español, con prefijo convencional (`feat:`, `test:`, `chore:`).
- **Ejecutar la suite completa con `pnpm test` desde la raíz**, nunca con `pnpm -r test` directo. Todos los paquetes comparten la misma base de datos de pruebas y cada prueba la vacía al empezar, así que corriéndolos en paralelo se pisan entre sí. El script de la raíz serializa los paquetes con `--workspace-concurrency=1`. Las de un paquete suelto: `pnpm --filter @gc/<nombre> test`.

---

### Task 1: Andamiaje del monorepo y taxonomía de errores

**Files:**
- Create: `package.json`
- Create: `pnpm-workspace.yaml`
- Create: `tsconfig.base.json`
- Create: `vitest.setup.ts`
- Create: `.gitignore`
- Create: `.github/workflows/ci.yml`
- Create: `packages/shared/package.json`
- Create: `packages/shared/tsconfig.json`
- Create: `packages/shared/vitest.config.ts`
- Create: `packages/shared/src/errores.ts`
- Create: `packages/shared/src/index.ts`
- Test: `packages/shared/src/errores.test.ts`

**Interfaces:**
- Consumes: nada (primera tarea)
- Produces: `ErrorDeDominio`, `ClaseDeError = 'transitorio' | 'permanente' | 'ambiguo'`, `transitorio(mensaje, causa?)`, `permanente(mensaje, causa?)`, `ambiguo(mensaje, causa?)`, `clasificarHttp(status: number): ClaseDeError`, `esTransitorio(e: unknown): boolean`. Todas las tareas posteriores usan esta taxonomía para decidir si reintentar.

- [ ] **Step 1: Crear el workspace**

`package.json`:

```json
{
  "name": "gestor-de-contenido",
  "private": true,
  "type": "module",
  "packageManager": "pnpm@9.15.9",
  "engines": { "node": ">=22" },
  "scripts": {
    "test": "pnpm -r --workspace-concurrency=1 test",
    "typecheck": "pnpm -r typecheck"
  },
  "devDependencies": {
    "typescript": "^5.6.0",
    "vitest": "^2.1.0",
    "dotenv": "^16.4.5",
    "@types/node": "^22.7.0"
  }
}
```

`vitest.setup.ts` (raíz):

```ts
import { config } from 'dotenv'
import { fileURLToPath } from 'node:url'

// pnpm ejecuta cada paquete con su propia carpeta como cwd, así que el .env
// de la raíz no se encuentra solo. Se resuelve desde la ubicación de este archivo.
config({ path: fileURLToPath(new URL('.env', import.meta.url)) })
```

> Existe un único `.env`, en la raíz. Ningún paquete tiene el suyo. Los paquetes que necesiten variables de entorno en sus pruebas apuntan a este archivo con `setupFiles: ['../../vitest.setup.ts']`.

`pnpm-workspace.yaml`:

```yaml
packages:
  - "packages/*"
  - "apps/*"
```

`tsconfig.base.json`:

```json
{
  "compilerOptions": {
    "target": "ES2023",
    "lib": ["ES2023"],
    "module": "ESNext",
    "moduleResolution": "Bundler",
    "strict": true,
    "noUncheckedIndexedAccess": true,
    "exactOptionalPropertyTypes": true,
    "declaration": true,
    "sourceMap": true,
    "skipLibCheck": true,
    "esModuleInterop": true,
    "verbatimModuleSyntax": true
  }
}
```

`.gitignore`:

```
node_modules/
dist/
.env
.env.local
*.tsbuildinfo
coverage/
```

- [ ] **Step 2: Crear el paquete `@gc/shared`**

`packages/shared/package.json`:

```json
{
  "name": "@gc/shared",
  "version": "0.0.0",
  "private": true,
  "type": "module",
  "main": "./src/index.ts",
  "types": "./src/index.ts",
  "scripts": {
    "test": "vitest run",
    "typecheck": "tsc --noEmit"
  }
}
```

`packages/shared/tsconfig.json`:

```json
{
  "extends": "../../tsconfig.base.json",
  "include": ["src"]
}
```

`packages/shared/vitest.config.ts`:

```ts
import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: { environment: 'node', include: ['src/**/*.test.ts'] },
})
```

Luego ejecutar:

```bash
pnpm install
```

- [ ] **Step 3: Escribir la prueba que falla**

`packages/shared/src/errores.test.ts`:

```ts
import { describe, expect, it } from 'vitest'
import {
  ErrorDeDominio,
  ambiguo,
  clasificarHttp,
  esTransitorio,
  permanente,
  transitorio,
} from './errores.js'

describe('taxonomía de errores', () => {
  it('conserva clase y causa original', () => {
    const causa = new Error('socket colgado')
    const e = transitorio('la red falló', causa)
    expect(e).toBeInstanceOf(ErrorDeDominio)
    expect(e.clase).toBe('transitorio')
    expect(e.causa).toBe(causa)
    expect(e.message).toBe('la red falló')
  })

  it('marca los errores permanentes y ambiguos', () => {
    expect(permanente('esquema inválido').clase).toBe('permanente')
    expect(ambiguo('timeout al publicar').clase).toBe('ambiguo')
  })

  it.each([
    [408, 'transitorio'],
    [429, 'transitorio'],
    [500, 'transitorio'],
    [503, 'transitorio'],
    [400, 'permanente'],
    [401, 'permanente'],
    [404, 'permanente'],
  ])('clasifica el estado HTTP %i como %s', (status, esperado) => {
    expect(clasificarHttp(status)).toBe(esperado)
  })

  it('esTransitorio solo acepta ErrorDeDominio transitorios', () => {
    expect(esTransitorio(transitorio('x'))).toBe(true)
    expect(esTransitorio(permanente('x'))).toBe(false)
    expect(esTransitorio(new Error('x'))).toBe(false)
    expect(esTransitorio('x')).toBe(false)
  })
})
```

- [ ] **Step 4: Ejecutar la prueba y verificar que falla**

```bash
pnpm --filter @gc/shared test
```

Esperado: FALLA con `Failed to resolve import "./errores.js"`.

- [ ] **Step 5: Implementar lo mínimo**

`packages/shared/src/errores.ts`:

```ts
/** Cómo debe reaccionar el pipeline ante una falla. */
export type ClaseDeError = 'transitorio' | 'permanente' | 'ambiguo'

export class ErrorDeDominio extends Error {
  constructor(
    mensaje: string,
    readonly clase: ClaseDeError,
    readonly causa?: unknown,
  ) {
    super(mensaje)
    this.name = 'ErrorDeDominio'
  }
}

/** Se reintenta con backoff. */
export const transitorio = (mensaje: string, causa?: unknown) =>
  new ErrorDeDominio(mensaje, 'transitorio', causa)

/** No se reintenta: escala a revisión humana. */
export const permanente = (mensaje: string, causa?: unknown) =>
  new ErrorDeDominio(mensaje, 'permanente', causa)

/** Requiere verificar el estado real antes de decidir. */
export const ambiguo = (mensaje: string, causa?: unknown) =>
  new ErrorDeDominio(mensaje, 'ambiguo', causa)

export function clasificarHttp(status: number): ClaseDeError {
  if (status === 408 || status === 429 || status >= 500) return 'transitorio'
  return 'permanente'
}

export function esTransitorio(e: unknown): boolean {
  return e instanceof ErrorDeDominio && e.clase === 'transitorio'
}
```

`packages/shared/src/index.ts`:

```ts
export * from './errores.js'
```

- [ ] **Step 6: Ejecutar la prueba y verificar que pasa**

```bash
pnpm --filter @gc/shared test
```

Esperado: PASA, 4 pruebas.

- [ ] **Step 7: Agregar CI**

`.github/workflows/ci.yml`:

```yaml
name: CI
on: [push, pull_request]
jobs:
  test:
    runs-on: ubuntu-latest
    services:
      postgres:
        image: postgres:16
        env:
          POSTGRES_PASSWORD: postgres
          POSTGRES_DB: gestor_test
        ports: ["5432:5432"]
        options: >-
          --health-cmd pg_isready --health-interval 10s
          --health-timeout 5s --health-retries 5
    env:
      DATABASE_URL_TEST: postgres://postgres:postgres@localhost:5432/gestor_test
    steps:
      - uses: actions/checkout@v4
      - uses: pnpm/action-setup@v4
        with: { version: 9 }
      - uses: actions/setup-node@v4
        with: { node-version: 22, cache: pnpm }
      - run: pnpm install --frozen-lockfile
      - run: pnpm typecheck
      - run: pnpm test
```

- [ ] **Step 8: Commit**

```bash
git add -A && git commit -m "feat: andamiaje del monorepo y taxonomía de errores"
```

---

### Task 2: Esquema de base de datos y migraciones

**Files:**
- Create: `docker-compose.yml`
- Create: `.env.example`
- Create: `packages/db/package.json`
- Create: `packages/db/tsconfig.json`
- Create: `packages/db/vitest.config.ts`
- Create: `packages/db/drizzle.config.ts`
- Create: `packages/db/src/esquema.ts`
- Create: `packages/db/src/cliente.ts`
- Create: `packages/db/src/index.ts`
- Create: `packages/db/src/pruebas/entorno.ts`
- Test: `packages/db/src/esquema.test.ts`

**Interfaces:**
- Consumes: nada de tareas previas
- Produces: `crearConexion(url: string): BaseDeDatos` (alias de `PostgresJsDatabase<typeof esquema>`), el objeto `esquema` con las tablas `organizations`, `brands`, `brandProfiles`, `channelAccounts`, `approvalPolicies`, `strategies`, `contentPlans`, `planSlots`, `pipelineRuns`, `pipelineSteps`, `aiCalls`, los tipos `Canal`, `PoliticaDeAprobacion`, y el helper de pruebas `conBaseDeDatosDePrueba(fn)`.

- [ ] **Step 1: Levantar Postgres local**

`docker-compose.yml`:

```yaml
services:
  postgres:
    image: postgres:16
    environment:
      POSTGRES_PASSWORD: postgres
      POSTGRES_DB: gestor
    ports: ["5432:5432"]
    volumes: ["pgdata:/var/lib/postgresql/data"]
volumes:
  pgdata:
```

`.env.example`:

```
DATABASE_URL=postgres://postgres:postgres@localhost:5432/gestor
DATABASE_URL_TEST=postgres://postgres:postgres@localhost:5432/gestor_test

# Modelos de OpenRouter por nivel (Task 3)
OPENROUTER_API_KEY=
MODELO_RAZONAMIENTO=
MODELO_RAZONAMIENTO_RESPALDO=
MODELO_REDACCION=
MODELO_REDACCION_RESPALDO=
MODELO_UTILITARIO=
MODELO_UTILITARIO_RESPALDO=

# Modo seco: usa el cliente falso, no gasta tokens (Task 4)
IA_EN_SECO=false
```

Ejecutar:

```bash
docker compose up -d && cp .env.example .env
```

Crear la base de pruebas:

```bash
docker compose exec postgres psql -U postgres -c "CREATE DATABASE gestor_test"
```

- [ ] **Step 2: Crear el paquete `@gc/db`**

`packages/db/package.json`:

```json
{
  "name": "@gc/db",
  "version": "0.0.0",
  "private": true,
  "type": "module",
  "main": "./src/index.ts",
  "types": "./src/index.ts",
  "scripts": {
    "test": "vitest run",
    "typecheck": "tsc --noEmit",
    "migraciones:generar": "drizzle-kit generate",
    "migraciones:aplicar": "drizzle-kit migrate"
  },
  "dependencies": {
    "drizzle-orm": "^0.36.0",
    "postgres": "^3.4.4"
  },
  "devDependencies": {
    "drizzle-kit": "^0.28.0",
    "dotenv": "^16.4.5"
  }
}
```

`packages/db/tsconfig.json`:

```json
{
  "extends": "../../tsconfig.base.json",
  "include": ["src", "drizzle.config.ts"]
}
```

`packages/db/vitest.config.ts`:

```ts
import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    environment: 'node',
    include: ['src/**/*.test.ts'],
    setupFiles: ['../../vitest.setup.ts'],
    fileParallelism: false,
  },
})
```

`packages/db/drizzle.config.ts`:

```ts
import { config } from 'dotenv'
import { fileURLToPath } from 'node:url'
import { defineConfig } from 'drizzle-kit'

// pnpm ejecuta este script con cwd en packages/db; el .env vive en la raíz.
config({ path: fileURLToPath(new URL('../../.env', import.meta.url)) })

export default defineConfig({
  schema: './src/esquema.ts',
  out: './migraciones',
  dialect: 'postgresql',
  dbCredentials: { url: process.env.DATABASE_URL! },
})
```

Instalar:

```bash
pnpm install
```

- [ ] **Step 3: Escribir la prueba que falla**

`packages/db/src/esquema.test.ts`:

```ts
import { eq } from 'drizzle-orm'
import { describe, expect, it } from 'vitest'
import { esquema } from './esquema.js'
import { conBaseDeDatosDePrueba } from './pruebas/entorno.js'

describe('esquema', () => {
  it('crea organización, marca y perfil versionado', async () => {
    await conBaseDeDatosDePrueba(async (db) => {
      const [org] = await db
        .insert(esquema.organizations)
        .values({ name: 'Mis Startups' })
        .returning()

      const [marca] = await db
        .insert(esquema.brands)
        .values({
          organizationId: org!.id,
          slug: 'parcelas',
          name: 'Compra Tu Parcela',
          monthlyBudgetUsd: '50.00',
        })
        .returning()

      await db.insert(esquema.brandProfiles).values([
        { organizationId: org!.id, brandId: marca!.id, version: 1, data: { tono: 'v1' } },
        { organizationId: org!.id, brandId: marca!.id, version: 2, data: { tono: 'v2' } },
      ])

      const perfiles = await db
        .select()
        .from(esquema.brandProfiles)
        .where(eq(esquema.brandProfiles.brandId, marca!.id))

      expect(perfiles).toHaveLength(2)
    })
  })

  it('rechaza dos versiones iguales del mismo perfil', async () => {
    await conBaseDeDatosDePrueba(async (db) => {
      const [org] = await db
        .insert(esquema.organizations)
        .values({ name: 'X' })
        .returning()
      const [marca] = await db
        .insert(esquema.brands)
        .values({ organizationId: org!.id, slug: 'a', name: 'A' })
        .returning()

      await db.insert(esquema.brandProfiles).values({
        organizationId: org!.id, brandId: marca!.id, version: 1, data: {},
      })

      await expect(
        db.insert(esquema.brandProfiles).values({
          organizationId: org!.id, brandId: marca!.id, version: 1, data: {},
        }),
      ).rejects.toThrow()
    })
  })

  it('rechaza una política de aprobación inválida', async () => {
    await conBaseDeDatosDePrueba(async (db) => {
      const [org] = await db
        .insert(esquema.organizations)
        .values({ name: 'X' })
        .returning()
      const [marca] = await db
        .insert(esquema.brands)
        .values({ organizationId: org!.id, slug: 'a', name: 'A' })
        .returning()

      await expect(
        db.insert(esquema.approvalPolicies).values({
          organizationId: org!.id,
          brandId: marca!.id,
          channel: 'blog',
          policy: 'lo_que_sea' as never,
        }),
      ).rejects.toThrow()
    })
  })

  it('borra en cascada los slots al borrar la marca', async () => {
    await conBaseDeDatosDePrueba(async (db) => {
      const [org] = await db
        .insert(esquema.organizations)
        .values({ name: 'X' })
        .returning()
      const [marca] = await db
        .insert(esquema.brands)
        .values({ organizationId: org!.id, slug: 'a', name: 'A' })
        .returning()
      const [plan] = await db
        .insert(esquema.contentPlans)
        .values({ organizationId: org!.id, brandId: marca!.id, month: '2026-09-01' })
        .returning()
      await db.insert(esquema.planSlots).values({
        organizationId: org!.id,
        contentPlanId: plan!.id,
        scheduledFor: new Date('2026-09-03T13:00:00Z'),
        channel: 'linkedin',
        format: 'post',
        pillar: 'educacion',
        angle: 'mito común',
        brief: 'Desmontar el mito de que...',
      })

      await db.delete(esquema.brands).where(eq(esquema.brands.id, marca!.id))

      expect(await db.select().from(esquema.planSlots)).toHaveLength(0)
    })
  })
})
```

- [ ] **Step 4: Ejecutar la prueba y verificar que falla**

```bash
pnpm --filter @gc/db test
```

Esperado: FALLA con `Failed to resolve import "./esquema.js"`.

- [ ] **Step 5: Implementar el esquema**

`packages/db/src/esquema.ts`:

```ts
import { sql } from 'drizzle-orm'
import {
  date, index, integer, jsonb, numeric, pgTable, text,
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
}, (t) => ({ politicaPorCanal: unique().on(t.brandId, t.channel) }))

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
  organizationId: uuid('organization_id').notNull()
    .references(() => organizations.id, { onDelete: 'cascade' }),
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
```

`packages/db/src/cliente.ts`:

```ts
import { drizzle, type PostgresJsDatabase } from 'drizzle-orm/postgres-js'
import postgres from 'postgres'
import { esquema } from './esquema.js'

export type BaseDeDatos = PostgresJsDatabase<typeof esquema>

export function crearConexion(url: string): { db: BaseDeDatos; cerrar: () => Promise<void> } {
  const sql = postgres(url, { max: 5 })
  return { db: drizzle(sql, { schema: esquema }), cerrar: () => sql.end() }
}
```

`packages/db/src/index.ts`:

```ts
export * from './esquema.js'
export * from './cliente.js'
```

- [ ] **Step 6: Escribir el helper de pruebas**

`packages/db/src/pruebas/entorno.ts`:

```ts
import { migrate } from 'drizzle-orm/postgres-js/migrator'
import { fileURLToPath } from 'node:url'
import { crearConexion, type BaseDeDatos } from '../cliente.js'
import { esquema } from '../esquema.js'

const CARPETA_MIGRACIONES = fileURLToPath(new URL('../../migraciones', import.meta.url))

/**
 * Abre una conexión a la base de pruebas, aplica migraciones, vacía las tablas
 * y ejecuta `fn`. Siempre cierra la conexión.
 */
export async function conBaseDeDatosDePrueba(
  fn: (db: BaseDeDatos) => Promise<void>,
): Promise<void> {
  const url = process.env.DATABASE_URL_TEST
  if (!url) throw new Error('Falta DATABASE_URL_TEST')

  const { db, cerrar } = crearConexion(url)
  try {
    await migrate(db, { migrationsFolder: CARPETA_MIGRACIONES })
    await db.delete(esquema.organizations)
    await fn(db)
  } finally {
    await cerrar()
  }
}
```

> `organizations` está en cascada sobre todas las demás tablas, así que borrarla vacía la base entera.

- [ ] **Step 7: Generar y aplicar las migraciones**

```bash
pnpm --filter @gc/db migraciones:generar
```

Esperado: se crea `packages/db/migraciones/0000_*.sql` con las 11 tablas.

```bash
pnpm --filter @gc/db migraciones:aplicar
```

- [ ] **Step 8: Ejecutar las pruebas y verificar que pasan**

```bash
pnpm --filter @gc/db test
```

Esperado: PASA, 4 pruebas.

- [ ] **Step 9: Commit**

```bash
git add -A && git commit -m "feat: esquema de base de datos y migraciones"
```

---

### Task 3: Niveles de modelo y definición de tareas de IA

**Files:**
- Create: `packages/ai/package.json`
- Create: `packages/ai/tsconfig.json`
- Create: `packages/ai/vitest.config.ts`
- Create: `packages/ai/src/niveles.ts`
- Create: `packages/ai/src/tarea.ts`
- Create: `packages/ai/src/index.ts`
- Test: `packages/ai/src/niveles.test.ts`
- Test: `packages/ai/src/tarea.test.ts`

**Interfaces:**
- Consumes: `permanente` de `@gc/shared`
- Produces: `NivelDeModelo = 'razonamiento' | 'redaccion' | 'utilitario'`, `ModelosDelNivel { principal: string; respaldo: string }`, `resolverNivel(nivel: NivelDeModelo, env?: Record<string, string | undefined>): ModelosDelNivel`, `DefinicionDeTarea<S extends z.ZodTypeAny> { nombre, nivel, esquema, temperatura, maxTokensSalida }`, `definirTarea<S>(d: DefinicionDeTarea<S>): DefinicionDeTarea<S>`. Las Tasks 8 y 9 declaran sus tareas con `definirTarea`.

- [ ] **Step 1: Crear el paquete `@gc/ai`**

`packages/ai/package.json`:

```json
{
  "name": "@gc/ai",
  "version": "0.0.0",
  "private": true,
  "type": "module",
  "main": "./src/index.ts",
  "types": "./src/index.ts",
  "scripts": {
    "test": "vitest run",
    "typecheck": "tsc --noEmit"
  },
  "dependencies": {
    "@gc/db": "workspace:*",
    "@gc/shared": "workspace:*",
    "zod": "^3.23.8",
    "zod-to-json-schema": "^3.23.3"
  }
}
```

`packages/ai/tsconfig.json`:

```json
{
  "extends": "../../tsconfig.base.json",
  "include": ["src"]
}
```

`packages/ai/vitest.config.ts`:

```ts
import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: { environment: 'node', include: ['src/**/*.test.ts'] },
})
```

```bash
pnpm install
```

- [ ] **Step 2: Escribir la prueba que falla**

`packages/ai/src/niveles.test.ts`:

```ts
import { describe, expect, it } from 'vitest'
import { resolverNivel } from './niveles.js'

const ENTORNO = {
  MODELO_RAZONAMIENTO: 'proveedor/modelo-fuerte',
  MODELO_RAZONAMIENTO_RESPALDO: 'proveedor/modelo-fuerte-alt',
  MODELO_REDACCION: 'proveedor/modelo-medio',
  MODELO_REDACCION_RESPALDO: 'proveedor/modelo-medio-alt',
  MODELO_UTILITARIO: 'proveedor/modelo-barato',
  MODELO_UTILITARIO_RESPALDO: 'proveedor/modelo-barato-alt',
}

describe('resolverNivel', () => {
  it('resuelve principal y respaldo de cada nivel', () => {
    expect(resolverNivel('razonamiento', ENTORNO)).toEqual({
      principal: 'proveedor/modelo-fuerte',
      respaldo: 'proveedor/modelo-fuerte-alt',
    })
    expect(resolverNivel('utilitario', ENTORNO).principal).toBe('proveedor/modelo-barato')
  })

  it('falla de inmediato si falta la variable de entorno', () => {
    expect(() => resolverNivel('redaccion', {})).toThrow(/MODELO_REDACCION/)
  })

  it('usa el principal como respaldo si no hay respaldo configurado', () => {
    const parcial = { MODELO_REDACCION: 'proveedor/uno' }
    expect(resolverNivel('redaccion', parcial)).toEqual({
      principal: 'proveedor/uno',
      respaldo: 'proveedor/uno',
    })
  })
})
```

`packages/ai/src/tarea.test.ts`:

```ts
import { describe, expect, it } from 'vitest'
import { z } from 'zod'
import { definirTarea } from './tarea.js'

const esquema = z.object({ titulo: z.string() })

describe('definirTarea', () => {
  it('devuelve la definición cuando es válida', () => {
    const t = definirTarea({
      nombre: 'generar_copy',
      nivel: 'redaccion',
      esquema,
      temperatura: 0.7,
      maxTokensSalida: 1200,
    })
    expect(t.nombre).toBe('generar_copy')
    expect(t.nivel).toBe('redaccion')
  })

  it('rechaza nombres que no sean snake_case', () => {
    expect(() =>
      definirTarea({
        nombre: 'GenerarCopy',
        nivel: 'redaccion',
        esquema,
        temperatura: 0.7,
        maxTokensSalida: 1200,
      }),
    ).toThrow(/snake_case/)
  })

  it('rechaza temperatura fuera de rango', () => {
    expect(() =>
      definirTarea({
        nombre: 'generar_copy',
        nivel: 'redaccion',
        esquema,
        temperatura: 3,
        maxTokensSalida: 1200,
      }),
    ).toThrow(/temperatura/)
  })

  it('rechaza esquemas que no sean objetos', () => {
    expect(() =>
      definirTarea({
        nombre: 'generar_copy',
        nivel: 'redaccion',
        esquema: z.string() as never,
        temperatura: 0.7,
        maxTokensSalida: 1200,
      }),
    ).toThrow(/objeto/)
  })
})
```

- [ ] **Step 3: Ejecutar las pruebas y verificar que fallan**

```bash
pnpm --filter @gc/ai test
```

Esperado: FALLA con `Failed to resolve import "./niveles.js"`.

- [ ] **Step 4: Implementar lo mínimo**

`packages/ai/src/niveles.ts`:

```ts
import { permanente } from '@gc/shared'

export type NivelDeModelo = 'razonamiento' | 'redaccion' | 'utilitario'

export interface ModelosDelNivel {
  principal: string
  respaldo: string
}

const VARIABLE_POR_NIVEL: Record<NivelDeModelo, string> = {
  razonamiento: 'MODELO_RAZONAMIENTO',
  redaccion: 'MODELO_REDACCION',
  utilitario: 'MODELO_UTILITARIO',
}

/**
 * Los identificadores de modelo nunca se escriben en el código: se configuran
 * por entorno y se cambian tras correr los evals.
 */
export function resolverNivel(
  nivel: NivelDeModelo,
  env: Record<string, string | undefined> = process.env,
): ModelosDelNivel {
  const variable = VARIABLE_POR_NIVEL[nivel]
  const principal = env[variable]
  if (!principal) {
    throw permanente(`Falta la variable de entorno ${variable} para el nivel "${nivel}"`)
  }
  return { principal, respaldo: env[`${variable}_RESPALDO`] ?? principal }
}
```

`packages/ai/src/tarea.ts`:

```ts
import { permanente } from '@gc/shared'
import { z } from 'zod'
import type { NivelDeModelo } from './niveles.js'

export interface DefinicionDeTarea<S extends z.ZodTypeAny = z.ZodTypeAny> {
  /** Identificador estable en snake_case; se guarda en `ai_calls.task`. */
  nombre: string
  nivel: NivelDeModelo
  /** Debe ser un ZodObject: los proveedores exigen un objeto en la raíz. */
  esquema: S
  temperatura: number
  maxTokensSalida: number
}

const SNAKE_CASE = /^[a-z][a-z0-9_]*$/

export function definirTarea<S extends z.ZodTypeAny>(
  d: DefinicionDeTarea<S>,
): DefinicionDeTarea<S> {
  if (!SNAKE_CASE.test(d.nombre)) {
    throw permanente(`El nombre de tarea "${d.nombre}" debe estar en snake_case`)
  }
  if (d.temperatura < 0 || d.temperatura > 2) {
    throw permanente(`temperatura fuera de rango en "${d.nombre}": ${d.temperatura}`)
  }
  if (d.maxTokensSalida < 1) {
    throw permanente(`maxTokensSalida inválido en "${d.nombre}"`)
  }
  if (!(d.esquema instanceof z.ZodObject)) {
    throw permanente(`El esquema de "${d.nombre}" debe ser un objeto`)
  }
  return d
}
```

`packages/ai/src/index.ts`:

```ts
export * from './niveles.js'
export * from './tarea.js'
```

- [ ] **Step 5: Ejecutar las pruebas y verificar que pasan**

```bash
pnpm --filter @gc/ai test
```

Esperado: PASA, 7 pruebas.

- [ ] **Step 6: Commit**

```bash
git add -A && git commit -m "feat: niveles de modelo y definición de tareas de IA"
```

---

### Task 4: Cliente de IA con salidas estructuradas y modo seco

**Files:**
- Create: `packages/ai/src/cliente.ts`
- Create: `packages/ai/src/openrouter.ts`
- Create: `packages/ai/src/falso.ts`
- Create: `packages/ai/src/ejecutar.ts`
- Modify: `packages/ai/src/index.ts`
- Test: `packages/ai/src/ejecutar.test.ts`
- Test: `packages/ai/src/openrouter.test.ts`

**Interfaces:**
- Consumes: `DefinicionDeTarea`, `resolverNivel` (Task 3); `transitorio`, `permanente`, `clasificarHttp` (Task 1)
- Produces:
  - `MensajeLlm { rol: 'sistema' | 'usuario' | 'asistente'; texto: string }`
  - `PeticionLlm { modelos: string[]; mensajes: MensajeLlm[]; esquemaJson: unknown; nombreEsquema: string; temperatura: number; maxTokens: number }`
  - `RespuestaLlm { texto: string; modelo: string; tokensEntrada: number; tokensSalida: number; costoUsd: number }`
  - `interface ClienteLlm { completar(p: PeticionLlm): Promise<RespuestaLlm> }`
  - `ClienteOpenRouter`, `ClienteFalso`, `ClienteDeMuestra`, `crearCliente(env?): ClienteLlm`
  - `ejecutarTarea<S>(tarea, mensajes, ctx): Promise<ResultadoDeTarea<z.infer<S>>>` con `ResultadoDeTarea { datos, uso }` y `uso: UsoDeLlamada { tarea, modelo, tokensEntrada, tokensSalida, costoUsd, latenciaMs, hashDePrompt }`

- [ ] **Step 1: Escribir la prueba que falla**

`packages/ai/src/ejecutar.test.ts`:

```ts
import { describe, expect, it } from 'vitest'
import { z } from 'zod'
import { ejecutarTarea } from './ejecutar.js'
import { ClienteFalso } from './falso.js'
import { definirTarea } from './tarea.js'

const TAREA = definirTarea({
  nombre: 'tarea_de_prueba',
  nivel: 'utilitario',
  esquema: z.object({ titulo: z.string(), puntaje: z.number() }),
  temperatura: 0.2,
  maxTokensSalida: 500,
})

const ENTORNO = { MODELO_UTILITARIO: 'proveedor/barato' }
const MENSAJES = [{ rol: 'usuario' as const, texto: 'hola' }]

describe('ejecutarTarea', () => {
  it('valida y devuelve los datos cuando el modelo responde bien', async () => {
    const cliente = new ClienteFalso(['{"titulo":"Hola","puntaje":8}'])
    const { datos, uso } = await ejecutarTarea(TAREA, MENSAJES, { cliente, env: ENTORNO })

    expect(datos).toEqual({ titulo: 'Hola', puntaje: 8 })
    expect(uso.tarea).toBe('tarea_de_prueba')
    expect(uso.hashDePrompt).toMatch(/^[a-f0-9]{16}$/)
  })

  it('repara una sola vez cuando la salida no valida', async () => {
    const cliente = new ClienteFalso([
      '{"titulo":"Hola"}',
      '{"titulo":"Hola","puntaje":8}',
    ])
    const { datos } = await ejecutarTarea(TAREA, MENSAJES, { cliente, env: ENTORNO })

    expect(datos.puntaje).toBe(8)
    expect(cliente.peticiones).toHaveLength(2)
    const segunda = cliente.peticiones[1]!
    expect(segunda.mensajes.at(-1)!.texto).toContain('puntaje')
  })

  it('falla de forma permanente si la reparación tampoco valida', async () => {
    const cliente = new ClienteFalso(['{"titulo":"a"}', '{"titulo":"b"}'])
    await expect(
      ejecutarTarea(TAREA, MENSAJES, { cliente, env: ENTORNO }),
    ).rejects.toMatchObject({ clase: 'permanente' })
    expect(cliente.peticiones).toHaveLength(2)
  })

  it('falla de forma permanente si la respuesta no es JSON', async () => {
    const cliente = new ClienteFalso(['no soy json', 'tampoco'])
    await expect(
      ejecutarTarea(TAREA, MENSAJES, { cliente, env: ENTORNO }),
    ).rejects.toMatchObject({ clase: 'permanente' })
  })

  it('envía el modelo principal y el de respaldo', async () => {
    const cliente = new ClienteFalso(['{"titulo":"a","puntaje":1}'])
    await ejecutarTarea(TAREA, MENSAJES, {
      cliente,
      env: { ...ENTORNO, MODELO_UTILITARIO_RESPALDO: 'proveedor/barato-alt' },
    })
    expect(cliente.peticiones[0]!.modelos).toEqual([
      'proveedor/barato',
      'proveedor/barato-alt',
    ])
  })

  it('entrega el uso al registrador cuando se provee', async () => {
    const registrado: unknown[] = []
    const cliente = new ClienteFalso(['{"titulo":"a","puntaje":1}'])
    await ejecutarTarea(TAREA, MENSAJES, {
      cliente,
      env: ENTORNO,
      registrarUso: async (u) => void registrado.push(u),
    })
    expect(registrado).toHaveLength(1)
  })
})
```

- [ ] **Step 2: Ejecutar la prueba y verificar que falla**

```bash
pnpm --filter @gc/ai test ejecutar
```

Esperado: FALLA con `Failed to resolve import "./ejecutar.js"`.

- [ ] **Step 3: Implementar los contratos y el cliente falso**

`packages/ai/src/cliente.ts`:

```ts
export interface MensajeLlm {
  rol: 'sistema' | 'usuario' | 'asistente'
  texto: string
}

export interface PeticionLlm {
  /** Principal primero; el proveedor cae al siguiente si el primero falla. */
  modelos: string[]
  mensajes: MensajeLlm[]
  esquemaJson: unknown
  nombreEsquema: string
  temperatura: number
  maxTokens: number
}

export interface RespuestaLlm {
  texto: string
  modelo: string
  tokensEntrada: number
  tokensSalida: number
  costoUsd: number
}

export interface ClienteLlm {
  completar(peticion: PeticionLlm): Promise<RespuestaLlm>
}
```

`packages/ai/src/falso.ts`:

```ts
import { permanente } from '@gc/shared'
import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import type { ClienteLlm, PeticionLlm, RespuestaLlm } from './cliente.js'

/** Cliente para pruebas: devuelve respuestas predefinidas en orden. */
export class ClienteFalso implements ClienteLlm {
  readonly peticiones: PeticionLlm[] = []
  private pendientes: string[]

  constructor(respuestas: string[]) {
    this.pendientes = [...respuestas]
  }

  async completar(peticion: PeticionLlm): Promise<RespuestaLlm> {
    this.peticiones.push(peticion)
    const texto = this.pendientes.shift()
    if (texto === undefined) {
      throw permanente('ClienteFalso se quedó sin respuestas predefinidas')
    }
    return {
      texto,
      modelo: peticion.modelos[0] ?? 'falso',
      tokensEntrada: 0,
      tokensSalida: 0,
      costoUsd: 0,
    }
  }
}

/**
 * Cliente de marcha en seco: lee la muestra `<carpeta>/<nombreEsquema>.json`.
 * Permite correr los flujos completos sin gastar tokens.
 */
export class ClienteDeMuestra implements ClienteLlm {
  constructor(private readonly carpeta: string) {}

  async completar(peticion: PeticionLlm): Promise<RespuestaLlm> {
    const ruta = join(this.carpeta, `${peticion.nombreEsquema}.json`)
    let texto: string
    try {
      texto = await readFile(ruta, 'utf8')
    } catch (causa) {
      throw permanente(`Falta la muestra de marcha en seco: ${ruta}`, causa)
    }
    return {
      texto,
      modelo: 'muestra',
      tokensEntrada: 0,
      tokensSalida: 0,
      costoUsd: 0,
    }
  }
}
```

- [ ] **Step 4: Implementar `ejecutarTarea`**

`packages/ai/src/ejecutar.ts`:

```ts
import { permanente } from '@gc/shared'
import { createHash } from 'node:crypto'
import type { z } from 'zod'
import { zodToJsonSchema } from 'zod-to-json-schema'
import type { ClienteLlm, MensajeLlm } from './cliente.js'
import { resolverNivel } from './niveles.js'
import type { DefinicionDeTarea } from './tarea.js'

export interface UsoDeLlamada {
  tarea: string
  modelo: string
  tokensEntrada: number
  tokensSalida: number
  costoUsd: number
  latenciaMs: number
  hashDePrompt: string
}

export interface ResultadoDeTarea<T> {
  datos: T
  uso: UsoDeLlamada
}

export interface ContextoDeEjecucion {
  cliente: ClienteLlm
  env?: Record<string, string | undefined>
  registrarUso?: (uso: UsoDeLlamada) => Promise<void>
}

function hashDePrompt(mensajes: MensajeLlm[]): string {
  return createHash('sha256')
    .update(mensajes.map((m) => `${m.rol}:${m.texto}`).join('\n'))
    .digest('hex')
    .slice(0, 16)
}

/**
 * Única puerta de entrada a un modelo. Valida contra el esquema de la tarea y
 * concede exactamente un intento de reparación antes de rendirse.
 */
export async function ejecutarTarea<S extends z.ZodTypeAny>(
  tarea: DefinicionDeTarea<S>,
  mensajes: MensajeLlm[],
  ctx: ContextoDeEjecucion,
): Promise<ResultadoDeTarea<z.infer<S>>> {
  const { principal, respaldo } = resolverNivel(tarea.nivel, ctx.env)
  const modelos = principal === respaldo ? [principal] : [principal, respaldo]
  const esquemaJson = zodToJsonSchema(tarea.esquema, {
    name: tarea.nombre,
    $refStrategy: 'none',
  })

  let conversacion = [...mensajes]
  let ultimoProblema = ''
  const inicio = Date.now()

  for (let intento = 1; intento <= 2; intento++) {
    const respuesta = await ctx.cliente.completar({
      modelos,
      mensajes: conversacion,
      esquemaJson,
      nombreEsquema: tarea.nombre,
      temperatura: tarea.temperatura,
      maxTokens: tarea.maxTokensSalida,
    })

    const analisis = analizar(tarea.esquema, respuesta.texto)
    if (analisis.ok) {
      const uso: UsoDeLlamada = {
        tarea: tarea.nombre,
        modelo: respuesta.modelo,
        tokensEntrada: respuesta.tokensEntrada,
        tokensSalida: respuesta.tokensSalida,
        costoUsd: respuesta.costoUsd,
        latenciaMs: Date.now() - inicio,
        hashDePrompt: hashDePrompt(mensajes),
      }
      await ctx.registrarUso?.(uso)
      return { datos: analisis.datos, uso }
    }

    ultimoProblema = analisis.problema
    conversacion = [
      ...conversacion,
      { rol: 'asistente', texto: respuesta.texto },
      {
        rol: 'usuario',
        texto:
          `Tu respuesta anterior no cumple el esquema requerido:\n${analisis.problema}\n` +
          'Devuelve únicamente el JSON corregido, sin explicaciones.',
      },
    ]
  }

  throw permanente(
    `La tarea "${tarea.nombre}" no produjo una salida válida tras la reparación: ${ultimoProblema}`,
  )
}

type Analisis<T> = { ok: true; datos: T } | { ok: false; problema: string }

function analizar<S extends z.ZodTypeAny>(esquema: S, texto: string): Analisis<z.infer<S>> {
  let crudo: unknown
  try {
    crudo = JSON.parse(texto)
  } catch {
    return { ok: false, problema: 'La respuesta no es JSON válido.' }
  }
  const r = esquema.safeParse(crudo)
  if (!r.success) {
    const problema = r.error.issues
      .map((i) => `- ${i.path.join('.') || '(raíz)'}: ${i.message}`)
      .join('\n')
    return { ok: false, problema }
  }
  return { ok: true, datos: r.data }
}
```

- [ ] **Step 5: Ejecutar las pruebas y verificar que pasan**

```bash
pnpm --filter @gc/ai test ejecutar
```

Esperado: PASA, 6 pruebas.

- [ ] **Step 6: Escribir la prueba del cliente de OpenRouter**

`packages/ai/src/openrouter.test.ts`:

```ts
import { afterEach, describe, expect, it, vi } from 'vitest'
import { ClienteOpenRouter } from './openrouter.js'

const PETICION = {
  modelos: ['proveedor/uno', 'proveedor/dos'],
  mensajes: [{ rol: 'usuario' as const, texto: 'hola' }],
  esquemaJson: { type: 'object' },
  nombreEsquema: 'tarea_de_prueba',
  temperatura: 0.3,
  maxTokens: 100,
}

afterEach(() => vi.unstubAllGlobals())

function respuestaHttp(cuerpo: unknown, status = 200) {
  return new Response(JSON.stringify(cuerpo), {
    status,
    headers: { 'content-type': 'application/json' },
  })
}

describe('ClienteOpenRouter', () => {
  it('traduce la respuesta del proveedor al contrato interno', async () => {
    const fetchFalso = vi.fn(async () =>
      respuestaHttp({
        model: 'proveedor/uno',
        choices: [{ message: { content: '{"a":1}' } }],
        usage: { prompt_tokens: 120, completion_tokens: 30, cost: 0.00042 },
      }),
    )
    vi.stubGlobal('fetch', fetchFalso)

    const cliente = new ClienteOpenRouter('clave-secreta')
    const r = await cliente.completar(PETICION)

    expect(r).toEqual({
      texto: '{"a":1}',
      modelo: 'proveedor/uno',
      tokensEntrada: 120,
      tokensSalida: 30,
      costoUsd: 0.00042,
    })

    const cuerpo = JSON.parse(fetchFalso.mock.calls[0]![1]!.body as string)
    expect(cuerpo.models).toEqual(['proveedor/uno', 'proveedor/dos'])
    expect(cuerpo.response_format.json_schema.name).toBe('tarea_de_prueba')
    expect(cuerpo.usage).toEqual({ include: true })
  })

  it('clasifica 429 como transitorio', async () => {
    vi.stubGlobal('fetch', async () => respuestaHttp({ error: 'límite' }, 429))
    const cliente = new ClienteOpenRouter('clave')
    await expect(cliente.completar(PETICION)).rejects.toMatchObject({
      clase: 'transitorio',
    })
  })

  it('clasifica 400 como permanente', async () => {
    vi.stubGlobal('fetch', async () => respuestaHttp({ error: 'malo' }, 400))
    const cliente = new ClienteOpenRouter('clave')
    await expect(cliente.completar(PETICION)).rejects.toMatchObject({
      clase: 'permanente',
    })
  })

  it('clasifica una falla de red como transitoria', async () => {
    vi.stubGlobal('fetch', async () => {
      throw new Error('ECONNRESET')
    })
    const cliente = new ClienteOpenRouter('clave')
    await expect(cliente.completar(PETICION)).rejects.toMatchObject({
      clase: 'transitorio',
    })
  })
})
```

- [ ] **Step 7: Ejecutar la prueba y verificar que falla**

```bash
pnpm --filter @gc/ai test openrouter
```

Esperado: FALLA con `Failed to resolve import "./openrouter.js"`.

- [ ] **Step 8: Implementar el cliente de OpenRouter y la fábrica**

`packages/ai/src/openrouter.ts`:

```ts
import { clasificarHttp, ErrorDeDominio, permanente, transitorio } from '@gc/shared'
import type { ClienteLlm, MensajeLlm, PeticionLlm, RespuestaLlm } from './cliente.js'
import { ClienteDeMuestra } from './falso.js'

const URL_BASE = 'https://openrouter.ai/api/v1/chat/completions'

const ROL_EXTERNO: Record<MensajeLlm['rol'], string> = {
  sistema: 'system',
  usuario: 'user',
  asistente: 'assistant',
}

export class ClienteOpenRouter implements ClienteLlm {
  constructor(private readonly clave: string) {}

  async completar(p: PeticionLlm): Promise<RespuestaLlm> {
    let http: Response
    try {
      http = await fetch(URL_BASE, {
        method: 'POST',
        headers: {
          authorization: `Bearer ${this.clave}`,
          'content-type': 'application/json',
        },
        body: JSON.stringify({
          models: p.modelos,
          messages: p.mensajes.map((m) => ({ role: ROL_EXTERNO[m.rol], content: m.texto })),
          temperature: p.temperatura,
          max_tokens: p.maxTokens,
          usage: { include: true },
          response_format: {
            type: 'json_schema',
            json_schema: { name: p.nombreEsquema, strict: true, schema: p.esquemaJson },
          },
        }),
      })
    } catch (causa) {
      throw transitorio('No se pudo contactar a OpenRouter', causa)
    }

    if (!http.ok) {
      const detalle = await http.text().catch(() => '')
      const clase = clasificarHttp(http.status)
      throw new ErrorDeDominio(`OpenRouter respondió ${http.status}: ${detalle}`, clase)
    }

    const cuerpo = (await http.json()) as {
      model?: string
      choices?: Array<{ message?: { content?: string } }>
      usage?: { prompt_tokens?: number; completion_tokens?: number; cost?: number }
    }

    const texto = cuerpo.choices?.[0]?.message?.content
    if (typeof texto !== 'string') {
      throw permanente('OpenRouter devolvió una respuesta sin contenido')
    }

    return {
      texto,
      modelo: cuerpo.model ?? p.modelos[0]!,
      tokensEntrada: cuerpo.usage?.prompt_tokens ?? 0,
      tokensSalida: cuerpo.usage?.completion_tokens ?? 0,
      costoUsd: cuerpo.usage?.cost ?? 0,
    }
  }
}

export interface OpcionesDeCliente {
  env?: Record<string, string | undefined>
  carpetaDeMuestras?: string
}

/** Devuelve el cliente de muestra si IA_EN_SECO está activo; si no, el real. */
export function crearCliente(opciones: OpcionesDeCliente = {}): ClienteLlm {
  const env = opciones.env ?? process.env
  if (env.IA_EN_SECO === 'true') {
    const carpeta = opciones.carpetaDeMuestras ?? env.CARPETA_DE_MUESTRAS
    if (!carpeta) throw permanente('IA_EN_SECO requiere CARPETA_DE_MUESTRAS')
    return new ClienteDeMuestra(carpeta)
  }
  const clave = env.OPENROUTER_API_KEY
  if (!clave) throw permanente('Falta OPENROUTER_API_KEY')
  return new ClienteOpenRouter(clave)
}
```

`packages/ai/src/index.ts` (reemplazar el contenido):

```ts
export * from './cliente.js'
export * from './ejecutar.js'
export * from './falso.js'
export * from './niveles.js'
export * from './openrouter.js'
export * from './tarea.js'
```

- [ ] **Step 9: Ejecutar todas las pruebas del paquete**

```bash
pnpm --filter @gc/ai test
```

Esperado: PASA, 17 pruebas.

- [ ] **Step 10: Commit**

```bash
git add -A && git commit -m "feat: cliente de IA con salidas estructuradas y modo seco"
```

---

### Task 5: Registro de costos y guardia de presupuesto

**Files:**
- Modify: `packages/db/package.json` (agregar mapa `exports`)
- Modify: `packages/ai/package.json` (agregar `drizzle-orm` y `dotenv`)
- Modify: `packages/ai/vitest.config.ts` (cargar `.env`, sin paralelismo de archivos)
- Create: `packages/ai/src/costos.ts`
- Modify: `packages/ai/src/index.ts`
- Test: `packages/ai/src/costos.test.ts`

**Interfaces:**
- Consumes: `UsoDeLlamada` (Task 4); `esquema`, `BaseDeDatos`, `conBaseDeDatosDePrueba` (Task 2)
- Produces:
  - `registrarLlamada(db, datos: DatosDeLlamada): Promise<void>` con `DatosDeLlamada { organizationId, brandId?, runId?, uso, brandProfileVersion? }`
  - `gastoDelMes(db, brandId: string, mes: Date): Promise<number>`
  - `EstadoDePresupuesto { gastadoUsd, presupuestoUsd, porcentaje, estado: 'ok' | 'aviso' | 'agotado' }`
  - `verificarPresupuesto(db, brandId, mes): Promise<EstadoDePresupuesto>`
  - `exigirPresupuesto(db, brandId, mes): Promise<EstadoDePresupuesto>` — lanza `permanente` si está agotado
  - `crearRegistrador(db, datos): (uso: UsoDeLlamada) => Promise<void>` — se pasa como `registrarUso` a `ejecutarTarea`

- [ ] **Step 1: Exponer el helper de pruebas de `@gc/db`**

Reemplazar en `packages/db/package.json` las claves `main` y `types` por:

```json
  "main": "./src/index.ts",
  "types": "./src/index.ts",
  "exports": {
    ".": "./src/index.ts",
    "./pruebas": "./src/pruebas/entorno.ts"
  },
```

En `packages/ai/package.json`, agregar a `dependencies`:

```json
    "drizzle-orm": "^0.36.0"
```

> `dotenv` no se agrega aquí: el `vitest.setup.ts` de la raíz ya carga el único `.env` del repositorio.

Reemplazar `packages/ai/vitest.config.ts`:

```ts
import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    environment: 'node',
    include: ['src/**/*.test.ts'],
    setupFiles: ['../../vitest.setup.ts'],
    fileParallelism: false,
  },
})
```

```bash
pnpm install
```

- [ ] **Step 2: Escribir la prueba que falla**

`packages/ai/src/costos.test.ts`:

```ts
import { esquema } from '@gc/db'
import { conBaseDeDatosDePrueba } from '@gc/db/pruebas'
import { describe, expect, it } from 'vitest'
import { crearRegistrador, exigirPresupuesto, gastoDelMes, registrarLlamada, verificarPresupuesto } from './costos.js'
import type { UsoDeLlamada } from './ejecutar.js'

const USO = (costoUsd: number): UsoDeLlamada => ({
  tarea: 'generar_copy',
  modelo: 'proveedor/uno',
  tokensEntrada: 100,
  tokensSalida: 50,
  costoUsd,
  latenciaMs: 900,
  hashDePrompt: 'abc123',
})

const MES = new Date('2026-09-15T00:00:00Z')

async function sembrar(db: Parameters<Parameters<typeof conBaseDeDatosDePrueba>[0]>[0], presupuesto = '10.00') {
  const [org] = await db.insert(esquema.organizations).values({ name: 'X' }).returning()
  const [marca] = await db
    .insert(esquema.brands)
    .values({ organizationId: org!.id, slug: 'a', name: 'A', monthlyBudgetUsd: presupuesto })
    .returning()
  return { orgId: org!.id, marcaId: marca!.id }
}

describe('costos y presupuesto', () => {
  it('registra la llamada con su costo y hash', async () => {
    await conBaseDeDatosDePrueba(async (db) => {
      const { orgId, marcaId } = await sembrar(db)
      await registrarLlamada(db, {
        organizationId: orgId,
        brandId: marcaId,
        uso: USO(0.0125),
        brandProfileVersion: 3,
      })

      const filas = await db.select().from(esquema.aiCalls)
      expect(filas).toHaveLength(1)
      expect(filas[0]!.task).toBe('generar_copy')
      expect(Number(filas[0]!.costUsd)).toBeCloseTo(0.0125, 6)
      expect(filas[0]!.brandProfileVersion).toBe(3)
    })
  })

  it('suma solo el gasto del mes consultado', async () => {
    await conBaseDeDatosDePrueba(async (db) => {
      const { orgId, marcaId } = await sembrar(db)
      await db.insert(esquema.aiCalls).values([
        { organizationId: orgId, brandId: marcaId, task: 't', model: 'm', costUsd: '1.00', promptHash: 'h', createdAt: new Date('2026-09-02T00:00:00Z') },
        { organizationId: orgId, brandId: marcaId, task: 't', model: 'm', costUsd: '2.50', promptHash: 'h', createdAt: new Date('2026-09-28T00:00:00Z') },
        { organizationId: orgId, brandId: marcaId, task: 't', model: 'm', costUsd: '9.00', promptHash: 'h', createdAt: new Date('2026-10-01T00:00:00Z') },
      ])

      expect(await gastoDelMes(db, marcaId, MES)).toBeCloseTo(3.5, 6)
    })
  })

  it.each([
    ['1.00', 'ok'],
    ['8.50', 'aviso'],
    ['10.00', 'agotado'],
    ['12.00', 'agotado'],
  ])('con %s gastado el estado es %s', async (gasto, esperado) => {
    await conBaseDeDatosDePrueba(async (db) => {
      const { orgId, marcaId } = await sembrar(db, '10.00')
      await db.insert(esquema.aiCalls).values({
        organizationId: orgId, brandId: marcaId, task: 't', model: 'm',
        costUsd: gasto, promptHash: 'h', createdAt: MES,
      })

      const estado = await verificarPresupuesto(db, marcaId, MES)
      expect(estado.estado).toBe(esperado)
      expect(estado.presupuestoUsd).toBe(10)
    })
  })

  it('exigirPresupuesto lanza un error permanente cuando está agotado', async () => {
    await conBaseDeDatosDePrueba(async (db) => {
      const { orgId, marcaId } = await sembrar(db, '5.00')
      await db.insert(esquema.aiCalls).values({
        organizationId: orgId, brandId: marcaId, task: 't', model: 'm',
        costUsd: '5.00', promptHash: 'h', createdAt: MES,
      })

      await expect(exigirPresupuesto(db, marcaId, MES)).rejects.toMatchObject({
        clase: 'permanente',
      })
    })
  })

  it('crearRegistrador produce una función compatible con ejecutarTarea', async () => {
    await conBaseDeDatosDePrueba(async (db) => {
      const { orgId, marcaId } = await sembrar(db)
      const registrar = crearRegistrador(db, { organizationId: orgId, brandId: marcaId })
      await registrar(USO(0.002))

      expect(await db.select().from(esquema.aiCalls)).toHaveLength(1)
    })
  })
})
```

- [ ] **Step 3: Ejecutar la prueba y verificar que falla**

```bash
pnpm --filter @gc/ai test costos
```

Esperado: FALLA con `Failed to resolve import "./costos.js"`.

- [ ] **Step 4: Implementar**

`packages/ai/src/costos.ts`:

```ts
import { esquema, type BaseDeDatos } from '@gc/db'
import { permanente } from '@gc/shared'
import { and, eq, gte, lt, sql } from 'drizzle-orm'
import type { UsoDeLlamada } from './ejecutar.js'

export interface DatosDeLlamada {
  organizationId: string
  brandId?: string
  runId?: string
  uso: UsoDeLlamada
  brandProfileVersion?: number
}

export async function registrarLlamada(db: BaseDeDatos, d: DatosDeLlamada): Promise<void> {
  await db.insert(esquema.aiCalls).values({
    organizationId: d.organizationId,
    brandId: d.brandId ?? null,
    runId: d.runId ?? null,
    task: d.uso.tarea,
    model: d.uso.modelo,
    tokensIn: d.uso.tokensEntrada,
    tokensOut: d.uso.tokensSalida,
    costUsd: d.uso.costoUsd.toFixed(6),
    latencyMs: d.uso.latenciaMs,
    promptHash: d.uso.hashDePrompt,
    brandProfileVersion: d.brandProfileVersion ?? null,
  })
}

/** Devuelve una función lista para pasar como `registrarUso` a `ejecutarTarea`. */
export function crearRegistrador(
  db: BaseDeDatos,
  base: Omit<DatosDeLlamada, 'uso'>,
): (uso: UsoDeLlamada) => Promise<void> {
  return (uso) => registrarLlamada(db, { ...base, uso })
}

function limitesDelMes(mes: Date): { desde: Date; hasta: Date } {
  const desde = new Date(Date.UTC(mes.getUTCFullYear(), mes.getUTCMonth(), 1))
  const hasta = new Date(Date.UTC(mes.getUTCFullYear(), mes.getUTCMonth() + 1, 1))
  return { desde, hasta }
}

export async function gastoDelMes(
  db: BaseDeDatos,
  brandId: string,
  mes: Date,
): Promise<number> {
  const { desde, hasta } = limitesDelMes(mes)
  const [fila] = await db
    .select({ total: sql<string>`coalesce(sum(${esquema.aiCalls.costUsd}), 0)` })
    .from(esquema.aiCalls)
    .where(
      and(
        eq(esquema.aiCalls.brandId, brandId),
        gte(esquema.aiCalls.createdAt, desde),
        lt(esquema.aiCalls.createdAt, hasta),
      ),
    )
  return Number(fila?.total ?? 0)
}

export interface EstadoDePresupuesto {
  gastadoUsd: number
  presupuestoUsd: number
  porcentaje: number
  estado: 'ok' | 'aviso' | 'agotado'
}

const UMBRAL_DE_AVISO = 0.8

export async function verificarPresupuesto(
  db: BaseDeDatos,
  brandId: string,
  mes: Date,
): Promise<EstadoDePresupuesto> {
  const [marca] = await db
    .select({ presupuesto: esquema.brands.monthlyBudgetUsd })
    .from(esquema.brands)
    .where(eq(esquema.brands.id, brandId))
  if (!marca) throw permanente(`No existe la marca ${brandId}`)

  const presupuestoUsd = Number(marca.presupuesto)
  const gastadoUsd = await gastoDelMes(db, brandId, mes)
  const porcentaje = presupuestoUsd === 0 ? 1 : gastadoUsd / presupuestoUsd

  const estado =
    porcentaje >= 1 ? 'agotado' : porcentaje >= UMBRAL_DE_AVISO ? 'aviso' : 'ok'

  return { gastadoUsd, presupuestoUsd, porcentaje, estado }
}

/**
 * Compuerta previa a cualquier tarea de IA. Al agotarse el presupuesto el flujo
 * se detiene con un error permanente: escala a revisión humana, no se reintenta.
 */
export async function exigirPresupuesto(
  db: BaseDeDatos,
  brandId: string,
  mes: Date,
): Promise<EstadoDePresupuesto> {
  const estado = await verificarPresupuesto(db, brandId, mes)
  if (estado.estado === 'agotado') {
    throw permanente(
      `Presupuesto mensual agotado para la marca ${brandId}: ` +
        `${estado.gastadoUsd.toFixed(2)} de ${estado.presupuestoUsd.toFixed(2)} USD`,
    )
  }
  return estado
}
```

Agregar a `packages/ai/src/index.ts`:

```ts
export * from './costos.js'
```

- [ ] **Step 5: Ejecutar las pruebas y verificar que pasan**

```bash
pnpm --filter @gc/ai test
```

Esperado: PASA, 25 pruebas.

- [ ] **Step 6: Commit**

```bash
git add -A && git commit -m "feat: registro de costos de IA y guardia de presupuesto por marca"
```

---

### Task 6: Motor de pipeline con reintentos e idempotencia

**Files:**
- Create: `packages/pipeline/package.json`
- Create: `packages/pipeline/tsconfig.json`
- Create: `packages/pipeline/vitest.config.ts`
- Create: `packages/pipeline/src/espera.ts`
- Create: `packages/pipeline/src/motor.ts`
- Create: `packages/pipeline/src/index.ts`
- Test: `packages/pipeline/src/espera.test.ts`
- Test: `packages/pipeline/src/motor.test.ts`

**Interfaces:**
- Consumes: `esquema`, `BaseDeDatos`, `conBaseDeDatosDePrueba` (Task 2); `ErrorDeDominio`, `esTransitorio` (Task 1)
- Produces:
  - `ContextoDePaso { db, runId, organizationId, brandId? }`
  - `DefinicionDePaso<E, S> { nombre: string; ejecutar(entrada: E, ctx: ContextoDePaso): Promise<S> }`
  - `definirPaso<E, S>(p: DefinicionDePaso<E, S>): DefinicionDePaso<E, S>`
  - `DefinicionDeFlujo { nombre: string; pasos: DefinicionDePaso<any, any>[] }`
  - `ejecutarFlujo(db, flujo, entrada, ctx: ContextoDeFlujo, opciones?): Promise<ResultadoDeFlujo>` con `ContextoDeFlujo { organizationId, brandId?, runId? }` y `ResultadoDeFlujo { runId, estado: 'completado' | 'fallido', salida: unknown }`
  - `calcularEspera(intento: number, aleatorio?: () => number): number`

- [ ] **Step 1: Crear el paquete `@gc/pipeline`**

`packages/pipeline/package.json`:

```json
{
  "name": "@gc/pipeline",
  "version": "0.0.0",
  "private": true,
  "type": "module",
  "main": "./src/index.ts",
  "types": "./src/index.ts",
  "scripts": {
    "test": "vitest run",
    "typecheck": "tsc --noEmit"
  },
  "dependencies": {
    "@gc/db": "workspace:*",
    "@gc/shared": "workspace:*",
    "drizzle-orm": "^0.36.0"
  }
}
```

`packages/pipeline/tsconfig.json`:

```json
{
  "extends": "../../tsconfig.base.json",
  "include": ["src"]
}
```

`packages/pipeline/vitest.config.ts`:

```ts
import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    environment: 'node',
    include: ['src/**/*.test.ts'],
    setupFiles: ['../../vitest.setup.ts'],
    fileParallelism: false,
  },
})
```

```bash
pnpm install
```

- [ ] **Step 2: Escribir la prueba del backoff**

`packages/pipeline/src/espera.test.ts`:

```ts
import { describe, expect, it } from 'vitest'
import { calcularEspera } from './espera.js'

const SIN_JITTER = () => 0

describe('calcularEspera', () => {
  it('duplica la espera en cada intento', () => {
    expect(calcularEspera(1, SIN_JITTER)).toBe(1000)
    expect(calcularEspera(2, SIN_JITTER)).toBe(2000)
    expect(calcularEspera(3, SIN_JITTER)).toBe(4000)
    expect(calcularEspera(4, SIN_JITTER)).toBe(8000)
  })

  it('nunca supera el techo de 30 segundos de base', () => {
    expect(calcularEspera(10, SIN_JITTER)).toBe(30_000)
  })

  it('suma hasta 25% de jitter', () => {
    expect(calcularEspera(1, () => 1)).toBe(1250)
    expect(calcularEspera(1, () => 0.5)).toBe(1125)
  })
})
```

- [ ] **Step 3: Ejecutar y verificar que falla**

```bash
pnpm --filter @gc/pipeline test espera
```

Esperado: FALLA con `Failed to resolve import "./espera.js"`.

- [ ] **Step 4: Implementar el backoff**

`packages/pipeline/src/espera.ts`:

```ts
const BASE_MS = 1000
const TECHO_MS = 30_000
const JITTER = 0.25

/** Backoff exponencial con jitter aditivo, en milisegundos. */
export function calcularEspera(intento: number, aleatorio: () => number = Math.random): number {
  const base = Math.min(BASE_MS * 2 ** (intento - 1), TECHO_MS)
  return Math.round(base * (1 + JITTER * aleatorio()))
}
```

- [ ] **Step 5: Escribir la prueba del motor**

`packages/pipeline/src/motor.test.ts`:

```ts
import { esquema } from '@gc/db'
import { conBaseDeDatosDePrueba } from '@gc/db/pruebas'
import { permanente, transitorio } from '@gc/shared'
import { eq } from 'drizzle-orm'
import { describe, expect, it } from 'vitest'
import { definirPaso, ejecutarFlujo } from './motor.js'

const SIN_ESPERA = { dormir: async () => {}, aleatorio: () => 0 }

async function sembrarOrg(db: Parameters<Parameters<typeof conBaseDeDatosDePrueba>[0]>[0]) {
  const [org] = await db.insert(esquema.organizations).values({ name: 'X' }).returning()
  return org!.id
}

describe('ejecutarFlujo', () => {
  it('encadena la salida de cada paso al siguiente', async () => {
    await conBaseDeDatosDePrueba(async (db) => {
      const organizationId = await sembrarOrg(db)
      const flujo = {
        nombre: 'prueba',
        pasos: [
          definirPaso<{ n: number }, { n: number }>({
            nombre: 'doblar',
            ejecutar: async (e) => ({ n: e.n * 2 }),
          }),
          definirPaso<{ n: number }, { n: number }>({
            nombre: 'sumar_uno',
            ejecutar: async (e) => ({ n: e.n + 1 }),
          }),
        ],
      }

      const r = await ejecutarFlujo(db, flujo, { n: 5 }, { organizationId }, SIN_ESPERA)

      expect(r.estado).toBe('completado')
      expect(r.salida).toEqual({ n: 11 })

      // Postgres no garantiza el orden de filas sin ORDER BY, así que aquí se
      // comparan como conjunto. El encadenamiento ya quedó probado por
      // `salida`: 5*2+1 = 11, mientras que invertir los pasos daría 12.
      const pasos = await db.select().from(esquema.pipelineSteps)
      expect(pasos.map((p) => p.name).sort()).toEqual(['doblar', 'sumar_uno'])
      expect(pasos.every((p) => p.status === 'completado')).toBe(true)
    })
  })

  it('reintenta los errores transitorios y registra el intento', async () => {
    await conBaseDeDatosDePrueba(async (db) => {
      const organizationId = await sembrarOrg(db)
      let llamadas = 0
      const flujo = {
        nombre: 'prueba',
        pasos: [
          definirPaso<{ n: number }, { n: number }>({
            nombre: 'inestable',
            ejecutar: async (e) => {
              llamadas++
              if (llamadas < 3) throw transitorio('la red falló')
              return { n: e.n }
            },
          }),
        ],
      }

      const r = await ejecutarFlujo(db, flujo, { n: 1 }, { organizationId }, SIN_ESPERA)

      expect(r.estado).toBe('completado')
      expect(llamadas).toBe(3)
      const [paso] = await db.select().from(esquema.pipelineSteps)
      expect(paso!.attempt).toBe(3)
    })
  })

  it('no reintenta los errores permanentes y marca la corrida como fallida', async () => {
    await conBaseDeDatosDePrueba(async (db) => {
      const organizationId = await sembrarOrg(db)
      let llamadas = 0
      const flujo = {
        nombre: 'prueba',
        pasos: [
          definirPaso<unknown, unknown>({
            nombre: 'invalido',
            ejecutar: async () => {
              llamadas++
              throw permanente('esquema inválido')
            },
          }),
        ],
      }

      await expect(
        ejecutarFlujo(db, flujo, {}, { organizationId }, SIN_ESPERA),
      ).rejects.toMatchObject({ clase: 'permanente' })

      expect(llamadas).toBe(1)
      const [corrida] = await db.select().from(esquema.pipelineRuns)
      expect(corrida!.status).toBe('fallido')
      expect(corrida!.error).toContain('esquema inválido')
    })
  })

  it('se rinde tras agotar los intentos de un error transitorio', async () => {
    await conBaseDeDatosDePrueba(async (db) => {
      const organizationId = await sembrarOrg(db)
      let llamadas = 0
      const flujo = {
        nombre: 'prueba',
        pasos: [
          definirPaso<unknown, unknown>({
            nombre: 'siempre_falla',
            ejecutar: async () => {
              llamadas++
              throw transitorio('502')
            },
          }),
        ],
      }

      await expect(
        ejecutarFlujo(db, flujo, {}, { organizationId }, { ...SIN_ESPERA, maxIntentos: 3 }),
      ).rejects.toMatchObject({ clase: 'transitorio' })

      expect(llamadas).toBe(3)
    })
  })

  it('es idempotente: reanudar una corrida no reejecuta los pasos completados', async () => {
    await conBaseDeDatosDePrueba(async (db) => {
      const organizationId = await sembrarOrg(db)
      let ejecucionesDelPrimero = 0
      let debeFallarElSegundo = true

      const flujo = {
        nombre: 'prueba',
        pasos: [
          definirPaso<{ n: number }, { n: number }>({
            nombre: 'caro',
            ejecutar: async (e) => {
              ejecucionesDelPrimero++
              return { n: e.n * 10 }
            },
          }),
          definirPaso<{ n: number }, { n: number }>({
            nombre: 'fragil',
            ejecutar: async (e) => {
              if (debeFallarElSegundo) throw permanente('todavía no')
              return { n: e.n + 1 }
            },
          }),
        ],
      }

      const primera = await ejecutarFlujo(
        db, flujo, { n: 2 }, { organizationId }, SIN_ESPERA,
      ).catch((e: unknown) => e)
      expect(primera).toBeInstanceOf(Error)
      expect(ejecucionesDelPrimero).toBe(1)

      const [corrida] = await db.select().from(esquema.pipelineRuns)
      debeFallarElSegundo = false

      const segunda = await ejecutarFlujo(
        db, flujo, { n: 2 }, { organizationId, runId: corrida!.id }, SIN_ESPERA,
      )

      expect(segunda.estado).toBe('completado')
      expect(segunda.salida).toEqual({ n: 21 })
      expect(ejecucionesDelPrimero).toBe(1)

      const corridas = await db
        .select()
        .from(esquema.pipelineRuns)
        .where(eq(esquema.pipelineRuns.id, corrida!.id))
      expect(corridas[0]!.status).toBe('completado')
    })
  })

  it('no reejecuta un paso completado cuya salida fue null', async () => {
    await conBaseDeDatosDePrueba(async (db) => {
      const organizationId = await sembrarOrg(db)
      let efectos = 0
      let debeFallarElSegundo = true

      const flujo = {
        nombre: 'prueba',
        pasos: [
          definirPaso<unknown, null>({
            nombre: 'efecto_sin_retorno',
            ejecutar: async () => {
              efectos++
              return null
            },
          }),
          definirPaso<null, { ok: boolean }>({
            nombre: 'fragil',
            ejecutar: async () => {
              if (debeFallarElSegundo) throw permanente('todavía no')
              return { ok: true }
            },
          }),
        ],
      }

      await expect(
        ejecutarFlujo(db, flujo, {}, { organizationId }, SIN_ESPERA),
      ).rejects.toThrow()
      expect(efectos).toBe(1)

      const [corrida] = await db.select().from(esquema.pipelineRuns)
      debeFallarElSegundo = false
      await ejecutarFlujo(db, flujo, {}, { organizationId, runId: corrida!.id }, SIN_ESPERA)

      // Un paso que devuelve null sigue estando completado: no se repite.
      expect(efectos).toBe(1)

      const [fragil] = await db
        .select()
        .from(esquema.pipelineSteps)
        .where(eq(esquema.pipelineSteps.name, 'fragil'))
      expect(fragil!.status).toBe('completado')
      expect(fragil!.error).toBeNull()
      expect(fragil!.finishedAt).not.toBeNull()
    })
  })

  it('espera con backoff exponencial entre reintentos', async () => {
    await conBaseDeDatosDePrueba(async (db) => {
      const organizationId = await sembrarOrg(db)
      const esperas: number[] = []
      let llamadas = 0

      const flujo = {
        nombre: 'prueba',
        pasos: [
          definirPaso<unknown, unknown>({
            nombre: 'inestable',
            ejecutar: async () => {
              llamadas++
              if (llamadas < 3) throw transitorio('502')
              return {}
            },
          }),
        ],
      }

      await ejecutarFlujo(db, flujo, {}, { organizationId }, {
        dormir: async (ms) => void esperas.push(ms),
        aleatorio: () => 0,
      })

      expect(esperas).toEqual([1000, 2000])
    })
  })

  it('rechaza reanudar una corrida de otra organización', async () => {
    await conBaseDeDatosDePrueba(async (db) => {
      const organizationId = await sembrarOrg(db)
      const [otra] = await db
        .insert(esquema.organizations)
        .values({ name: 'Otra' })
        .returning()

      const flujo = {
        nombre: 'prueba',
        pasos: [
          definirPaso<unknown, unknown>({ nombre: 'trivial', ejecutar: async () => ({}) }),
        ],
      }
      const r = await ejecutarFlujo(db, flujo, {}, { organizationId }, SIN_ESPERA)

      await expect(
        ejecutarFlujo(db, flujo, {}, { organizationId: otra!.id, runId: r.runId }, SIN_ESPERA),
      ).rejects.toMatchObject({ clase: 'permanente' })
    })
  })
})
```

- [ ] **Step 6: Ejecutar y verificar que falla**

```bash
pnpm --filter @gc/pipeline test motor
```

Esperado: FALLA con `Failed to resolve import "./motor.js"`.

- [ ] **Step 7: Implementar el motor**

`packages/pipeline/src/motor.ts`:

```ts
import { esquema, type BaseDeDatos } from '@gc/db'
import { ErrorDeDominio, esTransitorio, permanente } from '@gc/shared'
import { and, eq } from 'drizzle-orm'
import { calcularEspera } from './espera.js'

export interface ContextoDePaso {
  db: BaseDeDatos
  runId: string
  organizationId: string
  brandId?: string
}

export interface DefinicionDePaso<E, S> {
  nombre: string
  ejecutar(entrada: E, ctx: ContextoDePaso): Promise<S>
}

export function definirPaso<E, S>(p: DefinicionDePaso<E, S>): DefinicionDePaso<E, S> {
  return p
}

export interface DefinicionDeFlujo {
  nombre: string
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  pasos: DefinicionDePaso<any, any>[]
}

export interface ContextoDeFlujo {
  organizationId: string
  brandId?: string
  /** Si se indica, se reanuda esa corrida en vez de crear una nueva. */
  runId?: string
}

export interface OpcionesDeEjecucion {
  maxIntentos?: number
  dormir?: (ms: number) => Promise<void>
  aleatorio?: () => number
}

export interface ResultadoDeFlujo {
  runId: string
  estado: 'completado' | 'fallido'
  salida: unknown
}

const MAX_INTENTOS_POR_DEFECTO = 5
const dormirDeVerdad = (ms: number) => new Promise<void>((r) => setTimeout(r, ms))

export async function ejecutarFlujo(
  db: BaseDeDatos,
  flujo: DefinicionDeFlujo,
  entrada: unknown,
  ctx: ContextoDeFlujo,
  opciones: OpcionesDeEjecucion = {},
): Promise<ResultadoDeFlujo> {
  const maxIntentos = opciones.maxIntentos ?? MAX_INTENTOS_POR_DEFECTO
  const dormir = opciones.dormir ?? dormirDeVerdad
  const aleatorio = opciones.aleatorio ?? Math.random

  const runId = ctx.runId
    ? await reanudarCorrida(db, ctx.runId, ctx.organizationId)
    : await crearCorrida(db, flujo, entrada, ctx)

  const ctxPaso: ContextoDePaso = {
    db,
    runId,
    organizationId: ctx.organizationId,
    ...(ctx.brandId !== undefined ? { brandId: ctx.brandId } : {}),
  }

  let valor: unknown = entrada

  for (const paso of flujo.pasos) {
    const clave = `${runId}:${paso.nombre}`

    // Se pregunta por la existencia de la fila, no por su contenido: un paso
    // completado puede haber devuelto null o void y aun así no debe reejecutarse.
    const previo = await pasoCompletado(db, clave)
    if (previo) {
      valor = previo.output
      continue
    }

    try {
      valor = await ejecutarPaso(db, paso, valor, ctxPaso, clave, {
        maxIntentos, dormir, aleatorio,
      })
    } catch (error) {
      await marcarCorridaFallida(db, runId, error)
      throw error
    }
  }

  await db
    .update(esquema.pipelineRuns)
    .set({ status: 'completado', error: null, finishedAt: new Date() })
    .where(eq(esquema.pipelineRuns.id, runId))

  return { runId, estado: 'completado', salida: valor }
}

async function crearCorrida(
  db: BaseDeDatos,
  flujo: DefinicionDeFlujo,
  entrada: unknown,
  ctx: ContextoDeFlujo,
): Promise<string> {
  const [corrida] = await db
    .insert(esquema.pipelineRuns)
    .values({
      organizationId: ctx.organizationId,
      brandId: ctx.brandId ?? null,
      flow: flujo.nombre,
      input: entrada as object,
    })
    .returning()
  return corrida!.id
}

/** Devuelve la fila completa, no su salida: distinguir "no hay fila" de
 *  "hay fila cuya salida es null" es lo que sostiene la idempotencia. */
async function pasoCompletado(db: BaseDeDatos, clave: string) {
  const [fila] = await db
    .select()
    .from(esquema.pipelineSteps)
    .where(
      and(
        eq(esquema.pipelineSteps.idempotencyKey, clave),
        eq(esquema.pipelineSteps.status, 'completado'),
      ),
    )
  return fila ?? null
}

/** Reanudar exige que la corrida exista y pertenezca a la organización.
 *  Además vuelve a marcarla en curso: dejarla 'fallido' mientras se reejecuta
 *  la mostraría como fallada y corriendo al mismo tiempo. */
async function reanudarCorrida(
  db: BaseDeDatos,
  runId: string,
  organizationId: string,
): Promise<string> {
  const [corrida] = await db
    .select({ id: esquema.pipelineRuns.id })
    .from(esquema.pipelineRuns)
    .where(
      and(
        eq(esquema.pipelineRuns.id, runId),
        eq(esquema.pipelineRuns.organizationId, organizationId),
      ),
    )
  if (!corrida) throw permanente(`No existe la corrida ${runId} en esta organización`)

  await db
    .update(esquema.pipelineRuns)
    .set({ status: 'en_curso', error: null, finishedAt: null })
    .where(eq(esquema.pipelineRuns.id, runId))

  return corrida.id
}

async function marcarCorridaFallida(
  db: BaseDeDatos,
  runId: string,
  error: unknown,
): Promise<void> {
  try {
    await db
      .update(esquema.pipelineRuns)
      .set({ status: 'fallido', error: mensaje(error), finishedAt: new Date() })
      .where(eq(esquema.pipelineRuns.id, runId))
  } catch {
    // Se descarta a propósito: el error del paso es el que le importa a quien
    // llama, y reemplazarlo por uno de la base perdería su clasificación.
  }
}

async function ejecutarPaso(
  db: BaseDeDatos,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  paso: DefinicionDePaso<any, any>,
  entrada: unknown,
  ctx: ContextoDePaso,
  clave: string,
  o: Required<OpcionesDeEjecucion>,
): Promise<unknown> {
  const [fila] = await db
    .insert(esquema.pipelineSteps)
    .values({
      organizationId: ctx.organizationId,
      runId: ctx.runId,
      name: paso.nombre,
      status: 'en_curso',
      idempotencyKey: clave,
      input: entrada as object,
    })
    .onConflictDoUpdate({
      target: esquema.pipelineSteps.idempotencyKey,
      // Se reescribe la fila entera del intento anterior: conservar su `input`
      // o su `finished_at` dejaría un registro que miente sobre qué se ejecutó.
      set: {
        status: 'en_curso',
        attempt: 1,
        error: null,
        input: entrada as object,
        startedAt: new Date(),
        finishedAt: null,
      },
    })
    .returning()

  const idPaso = fila!.id
  let ultimoError: unknown

  for (let intento = 1; intento <= o.maxIntentos; intento++) {
    try {
      const salida = await paso.ejecutar(entrada, ctx)
      await db
        .update(esquema.pipelineSteps)
        .set({
          status: 'completado',
          attempt: intento,
          output: salida as object,
          error: null,
          finishedAt: new Date(),
        })
        .where(eq(esquema.pipelineSteps.id, idPaso))
      return salida
    } catch (error) {
      ultimoError = error
      const puedeReintentar = esTransitorio(error) && intento < o.maxIntentos
      await db
        .update(esquema.pipelineSteps)
        .set({
          status: puedeReintentar ? 'en_curso' : 'fallido',
          attempt: intento,
          error: mensaje(error),
          ...(puedeReintentar ? {} : { finishedAt: new Date() }),
        })
        .where(eq(esquema.pipelineSteps.id, idPaso))

      if (!puedeReintentar) throw error
      await o.dormir(calcularEspera(intento, o.aleatorio))
    }
  }

  throw ultimoError
}

function mensaje(error: unknown): string {
  if (error instanceof ErrorDeDominio) return `[${error.clase}] ${error.message}`
  if (error instanceof Error) return error.message
  return String(error)
}
```

`packages/pipeline/src/index.ts`:

```ts
export * from './espera.js'
export * from './motor.js'
```

- [ ] **Step 8: Ejecutar todas las pruebas del paquete**

```bash
pnpm --filter @gc/pipeline test
```

Esperado: PASA, 8 pruebas.

- [ ] **Step 9: Commit**

```bash
git add -A && git commit -m "feat: motor de pipeline con reintentos, backoff e idempotencia"
```

---

### Task 7: Perfil de marca versionado

**Files:**
- Create: `packages/brand/package.json`
- Create: `packages/brand/tsconfig.json`
- Create: `packages/brand/vitest.config.ts`
- Create: `packages/brand/src/perfil.ts`
- Create: `packages/brand/src/repositorio.ts`
- Create: `packages/brand/src/index.ts`
- Test: `packages/brand/src/perfil.test.ts`
- Test: `packages/brand/src/repositorio.test.ts`

**Interfaces:**
- Consumes: `esquema`, `BaseDeDatos`, `conBaseDeDatosDePrueba` (Task 2); `permanente` (Task 1)
- Produces:
  - `PerfilDeMarca` (esquema Zod) y el tipo `TipoPerfilDeMarca`
  - `validarPerfil(crudo: unknown): TipoPerfilDeMarca` — lanza `permanente` con el detalle
  - `guardarPerfil(db, { organizationId, brandId }, perfil): Promise<number>` — devuelve la versión creada
  - `PerfilVigente { version: number; perfil: TipoPerfilDeMarca }`
  - `cargarPerfilVigente(db, brandId): Promise<PerfilVigente>`
  - `contextoDeMarca(perfil: TipoPerfilDeMarca): string` — bloque de texto para la capa 2 del prompt

- [ ] **Step 1: Crear el paquete `@gc/brand`**

`packages/brand/package.json`:

```json
{
  "name": "@gc/brand",
  "version": "0.0.0",
  "private": true,
  "type": "module",
  "main": "./src/index.ts",
  "types": "./src/index.ts",
  "scripts": {
    "test": "vitest run",
    "typecheck": "tsc --noEmit"
  },
  "dependencies": {
    "@gc/db": "workspace:*",
    "@gc/shared": "workspace:*",
    "drizzle-orm": "^0.36.0",
    "zod": "^3.23.8"
  }
}
```

`packages/brand/tsconfig.json`:

```json
{
  "extends": "../../tsconfig.base.json",
  "include": ["src"]
}
```

`packages/brand/vitest.config.ts`:

```ts
import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    environment: 'node',
    include: ['src/**/*.test.ts'],
    setupFiles: ['../../vitest.setup.ts'],
    fileParallelism: false,
  },
})
```

```bash
pnpm install
```

- [ ] **Step 2: Escribir la prueba del esquema y del contexto**

`packages/brand/src/perfil.test.ts`:

```ts
import { describe, expect, it } from 'vitest'
import { contextoDeMarca, validarPerfil } from './perfil.js'
import { PERFIL_VALIDO } from './perfil.fixture.js'

describe('validarPerfil', () => {
  it('acepta un perfil completo', () => {
    expect(validarPerfil(PERFIL_VALIDO).pilares).toHaveLength(3)
  })

  // Las descripciones de estos pilares son válidas a propósito: con
  // `descripcion: 'x'` Zod fallaría por forma y el test pasaría sin llegar
  // nunca a la regla que dice verificar.
  it('rechaza pilares cuyas proporciones no suman 1', () => {
    const malo = {
      ...PERFIL_VALIDO,
      pilares: [
        { nombre: 'educacion', descripcion: 'Cómo evaluar', proporcion: 0.5 },
        { nombre: 'producto', descripcion: 'Proyectos disponibles', proporcion: 0.2 },
      ],
    }
    expect(() => validarPerfil(malo)).toThrow(/proporciones/i)
  })

  it('rechaza nombres de pilar repetidos', () => {
    const malo = {
      ...PERFIL_VALIDO,
      pilares: [
        { nombre: 'educacion', descripcion: 'Cómo evaluar', proporcion: 0.5 },
        { nombre: 'educacion', descripcion: 'Otra cosa distinta', proporcion: 0.5 },
      ],
    }
    expect(() => validarPerfil(malo)).toThrow(/repetid/i)
  })

  it('rechaza nombres de pilar que no sean snake_case', () => {
    const malo = {
      ...PERFIL_VALIDO,
      pilares: [
        { nombre: 'Educación Financiera', descripcion: 'Cómo evaluar', proporcion: 0.5 },
        { nombre: 'producto', descripcion: 'Proyectos disponibles', proporcion: 0.5 },
      ],
    }
    expect(() => validarPerfil(malo)).toThrow(/snake_case/)
  })

  it('rechaza un perfil sin públicos', () => {
    expect(() => validarPerfil({ ...PERFIL_VALIDO, publicos: [] })).toThrow()
  })
})

describe('contextoDeMarca', () => {
  it('incluye promesa, pilares con su proporción y léxico prohibido', () => {
    const texto = contextoDeMarca(validarPerfil(PERFIL_VALIDO))

    expect(texto).toContain('Parcelas con factibilidad garantizada')
    expect(texto).toContain('educacion (40%)')
    expect(texto).toContain('Preferido: factibilidad, rol, trazabilidad')
    expect(texto).toContain('PROHIBIDO usar: Rentabilidad garantizada')
  })
})
```

`packages/brand/src/perfil.fixture.ts`:

```ts
/** Perfil de ejemplo usado por las pruebas y por la marcha en seco. */
export const PERFIL_VALIDO = {
  posicionamiento: {
    categoria: 'Venta de parcelas de agrado',
    promesa: 'Parcelas con factibilidad garantizada y trazabilidad legal completa',
    diferenciadores: ['Factibilidad verificada', 'Financiamiento directo'],
  },
  publicos: [
    {
      nombre: 'Inversionista primerizo',
      dolor: 'Teme comprar un terreno sin agua ni acceso legal',
      objecion: 'No sabe distinguir una parcela regularizada de una que no lo está',
    },
  ],
  tono: {
    atributos: ['claro', 'didáctico', 'sin humo'],
    hacer: ['Explicar con datos concretos', 'Reconocer los riesgos reales'],
    noHacer: ['Prometer retornos', 'Usar urgencia artificial'],
  },
  lexico: {
    preferido: ['factibilidad', 'rol', 'trazabilidad'],
    prohibido: ['Rentabilidad garantizada', 'oportunidad única'],
  },
  pilares: [
    { nombre: 'educacion', descripcion: 'Cómo evaluar una parcela', proporcion: 0.4 },
    { nombre: 'confianza', descripcion: 'Casos y respaldo legal', proporcion: 0.35 },
    { nombre: 'producto', descripcion: 'Proyectos disponibles', proporcion: 0.25 },
  ],
  ofertas: [
    {
      nombre: 'Asesoría de factibilidad',
      descripcion: 'Revisión legal previa a la compra',
      url: 'https://compratuparcela.cl/asesoria',
    },
  ],
  restricciones: {
    disclaimers: ['Las imágenes son referenciales.'],
  },
} as const
```

- [ ] **Step 3: Ejecutar y verificar que falla**

```bash
pnpm --filter @gc/brand test perfil
```

Esperado: FALLA con `Failed to resolve import "./perfil.js"`.

- [ ] **Step 4: Implementar el esquema y el contexto**

`packages/brand/src/perfil.ts`:

```ts
import { permanente } from '@gc/shared'
import { z } from 'zod'

const SNAKE_CASE = /^[a-z][a-z0-9_]*$/

export const PerfilDeMarca = z.object({
  posicionamiento: z.object({
    categoria: z.string().min(3),
    promesa: z.string().min(10),
    diferenciadores: z.array(z.string().min(3)).min(1),
  }),
  publicos: z
    .array(
      z.object({
        nombre: z.string().min(3),
        dolor: z.string().min(10),
        objecion: z.string().min(10),
      }),
    )
    .min(1),
  tono: z.object({
    atributos: z.array(z.string().min(3)).min(1),
    hacer: z.array(z.string().min(3)),
    noHacer: z.array(z.string().min(3)),
  }),
  lexico: z.object({
    preferido: z.array(z.string()),
    prohibido: z.array(z.string()),
  }),
  pilares: z
    .array(
      z.object({
        nombre: z.string().regex(SNAKE_CASE, 'el nombre del pilar debe ser snake_case'),
        descripcion: z.string().min(5),
        proporcion: z.number().min(0).max(1),
      }),
    )
    .min(2),
  ofertas: z.array(
    z.object({
      nombre: z.string().min(3),
      descripcion: z.string().min(5),
      url: z.string().url().optional(),
    }),
  ),
  restricciones: z.object({
    disclaimers: z.array(z.string()),
  }),
})

export type TipoPerfilDeMarca = z.infer<typeof PerfilDeMarca>

const TOLERANCIA = 0.01

export function validarPerfil(crudo: unknown): TipoPerfilDeMarca {
  const r = PerfilDeMarca.safeParse(crudo)
  if (!r.success) {
    const detalle = r.error.issues
      .map((i) => `- ${i.path.join('.') || '(raíz)'}: ${i.message}`)
      .join('\n')
    throw permanente(`Perfil de marca inválido:\n${detalle}`)
  }

  const perfil = r.data
  const suma = perfil.pilares.reduce((t, p) => t + p.proporcion, 0)
  if (Math.abs(suma - 1) > TOLERANCIA) {
    throw permanente(
      `Las proporciones de los pilares deben sumar 1; suman ${suma.toFixed(2)}`,
    )
  }

  const nombres = perfil.pilares.map((p) => p.nombre)
  if (new Set(nombres).size !== nombres.length) {
    throw permanente('Hay nombres de pilar repetidos')
  }

  return perfil
}

/** Capa 2 del prompt: el contexto de marca, idéntico para todas las tareas. */
export function contextoDeMarca(perfil: TipoPerfilDeMarca): string {
  const lista = (xs: readonly string[]) => xs.map((x) => `- ${x}`).join('\n')

  return [
    '## Posicionamiento',
    `Categoría: ${perfil.posicionamiento.categoria}`,
    `Promesa: ${perfil.posicionamiento.promesa}`,
    'Diferenciadores:',
    lista(perfil.posicionamiento.diferenciadores),
    '',
    '## Públicos',
    perfil.publicos
      .map((p) => `- ${p.nombre} — dolor: ${p.dolor} — objeción: ${p.objecion}`)
      .join('\n'),
    '',
    '## Tono',
    `Atributos: ${perfil.tono.atributos.join(', ')}`,
    'Hacer:',
    lista(perfil.tono.hacer),
    'No hacer:',
    lista(perfil.tono.noHacer),
    '',
    '## Léxico',
    `Preferido: ${perfil.lexico.preferido.join(', ') || '(sin definir)'}`,
    `PROHIBIDO usar: ${perfil.lexico.prohibido.join(', ') || '(sin restricciones)'}`,
    '',
    '## Pilares de contenido',
    perfil.pilares
      .map((p) => `- ${p.nombre} (${Math.round(p.proporcion * 100)}%): ${p.descripcion}`)
      .join('\n'),
    '',
    '## Ofertas',
    perfil.ofertas
      .map((o) => `- ${o.nombre}: ${o.descripcion}${o.url ? ` (${o.url})` : ''}`)
      .join('\n'),
    '',
    '## Disclaimers obligatorios',
    lista(perfil.restricciones.disclaimers),
  ].join('\n')
}
```

- [ ] **Step 5: Ejecutar y verificar que pasa**

```bash
pnpm --filter @gc/brand test perfil
```

Esperado: PASA, 6 pruebas.

- [ ] **Step 6: Escribir la prueba del repositorio**

`packages/brand/src/repositorio.test.ts`:

```ts
import { esquema } from '@gc/db'
import { conBaseDeDatosDePrueba } from '@gc/db/pruebas'
import { describe, expect, it } from 'vitest'
import { PERFIL_VALIDO } from './perfil.fixture.js'
import { cargarPerfilVigente, guardarPerfil } from './repositorio.js'

async function sembrar(db: Parameters<Parameters<typeof conBaseDeDatosDePrueba>[0]>[0]) {
  const [org] = await db.insert(esquema.organizations).values({ name: 'X' }).returning()
  const [marca] = await db
    .insert(esquema.brands)
    .values({ organizationId: org!.id, slug: 'parcelas', name: 'CTP' })
    .returning()
  return { organizationId: org!.id, brandId: marca!.id }
}

describe('repositorio de perfiles', () => {
  it('crea versiones incrementales en vez de sobrescribir', async () => {
    await conBaseDeDatosDePrueba(async (db) => {
      const ref = await sembrar(db)

      expect(await guardarPerfil(db, ref, PERFIL_VALIDO)).toBe(1)

      const v2 = {
        ...PERFIL_VALIDO,
        posicionamiento: { ...PERFIL_VALIDO.posicionamiento, promesa: 'Otra promesa distinta' },
      }
      expect(await guardarPerfil(db, ref, v2)).toBe(2)

      const vigente = await cargarPerfilVigente(db, ref.brandId)
      expect(vigente.version).toBe(2)
      expect(vigente.perfil.posicionamiento.promesa).toBe('Otra promesa distinta')
      expect(await db.select().from(esquema.brandProfiles)).toHaveLength(2)
    })
  })

  it('rechaza guardar un perfil inválido', async () => {
    await conBaseDeDatosDePrueba(async (db) => {
      const ref = await sembrar(db)
      await expect(
        guardarPerfil(db, ref, { ...PERFIL_VALIDO, publicos: [] }),
      ).rejects.toMatchObject({ clase: 'permanente' })
    })
  })

  it('falla de forma permanente si la marca no tiene perfil', async () => {
    await conBaseDeDatosDePrueba(async (db) => {
      const ref = await sembrar(db)
      await expect(cargarPerfilVigente(db, ref.brandId)).rejects.toMatchObject({
        clase: 'permanente',
      })
    })
  })

  it('falla de forma permanente si la marca no existe', async () => {
    await conBaseDeDatosDePrueba(async (db) => {
      const ref = await sembrar(db)
      const inexistente = { ...ref, brandId: '00000000-0000-4000-8000-000000000000' }
      await expect(
        guardarPerfil(db, inexistente, PERFIL_VALIDO),
      ).rejects.toMatchObject({ clase: 'permanente' })
    })
  })

  // Verifica el comportamiento correcto bajo concurrencia, pero NO es una
  // prueba de regresión confiable de la carrera: sin el FOR UPDATE también
  // pasa, porque un Postgres local responde antes de que las dos operaciones
  // alcancen a solaparse. La garantía real está en el bloqueo de
  // repositorio.ts, no aquí. Que este test esté verde no prueba que el
  // bloqueo siga puesto.
  it('dos guardados simultáneos producen versiones distintas', async () => {
    await conBaseDeDatosDePrueba(async (db) => {
      const ref = await sembrar(db)

      const versiones = await Promise.all([
        guardarPerfil(db, ref, PERFIL_VALIDO),
        guardarPerfil(db, ref, PERFIL_VALIDO),
      ])

      expect([...versiones].sort()).toEqual([1, 2])
      expect(await db.select().from(esquema.brandProfiles)).toHaveLength(2)
    })
  })
})
```

- [ ] **Step 7: Ejecutar y verificar que falla**

```bash
pnpm --filter @gc/brand test repositorio
```

Esperado: FALLA con `Failed to resolve import "./repositorio.js"`.

- [ ] **Step 8: Implementar el repositorio**

`packages/brand/src/repositorio.ts`:

```ts
import { esquema, type BaseDeDatos } from '@gc/db'
import { permanente } from '@gc/shared'
import { desc, eq, sql } from 'drizzle-orm'
import { validarPerfil, type TipoPerfilDeMarca } from './perfil.js'

export interface ReferenciaDeMarca {
  organizationId: string
  brandId: string
}

export interface PerfilVigente {
  version: number
  perfil: TipoPerfilDeMarca
}

/** Nunca actualiza: cada guardado crea una versión nueva. */
export async function guardarPerfil(
  db: BaseDeDatos,
  ref: ReferenciaDeMarca,
  crudo: unknown,
): Promise<number> {
  const perfil = validarPerfil(crudo)

  return db.transaction(async (tx) => {
    // Se bloquea la fila de la marca antes de calcular la versión: sin esto,
    // dos guardados simultáneos leen el mismo máximo, calculan la misma
    // versión y el segundo choca contra la restricción única con un error
    // crudo del driver, fuera de la taxonomía del sistema.
    const [marca] = await tx
      .select({ id: esquema.brands.id })
      .from(esquema.brands)
      .where(eq(esquema.brands.id, ref.brandId))
      .for('update')

    if (!marca) throw permanente(`No existe la marca ${ref.brandId}`)

    const [ultimo] = await tx
      .select({ maximo: sql<number | null>`max(${esquema.brandProfiles.version})` })
      .from(esquema.brandProfiles)
      .where(eq(esquema.brandProfiles.brandId, ref.brandId))

    const version = (ultimo?.maximo ?? 0) + 1

    await tx.insert(esquema.brandProfiles).values({
      organizationId: ref.organizationId,
      brandId: ref.brandId,
      version,
      data: perfil,
    })

    return version
  })
}

export async function cargarPerfilVigente(
  db: BaseDeDatos,
  brandId: string,
): Promise<PerfilVigente> {
  const [fila] = await db
    .select()
    .from(esquema.brandProfiles)
    .where(eq(esquema.brandProfiles.brandId, brandId))
    .orderBy(desc(esquema.brandProfiles.version))
    .limit(1)

  if (!fila) throw permanente(`La marca ${brandId} no tiene perfil cargado`)

  return { version: fila.version, perfil: validarPerfil(fila.data) }
}
```

`packages/brand/src/index.ts`:

```ts
export * from './perfil.js'
export * from './perfil.fixture.js'
export * from './repositorio.js'
```

> `PERFIL_VALIDO` se exporta desde el índice a propósito: las Tasks 8, 9 y 11 lo usan como marca de referencia en sus pruebas y en la marcha en seco.
>
> `contextoDeMarca` vive en `perfil.ts`, junto al esquema que describe. No crees un módulo `contexto.ts` que solo lo reexporte: cuando la Fase 2 agregue capas de contexto (ejemplos, histórico), ese módulo se crea con contenido real.

- [ ] **Step 9: Ejecutar todas las pruebas del paquete**

```bash
pnpm --filter @gc/brand test
```

Esperado: PASA, 9 pruebas.

- [ ] **Step 10: Commit**

```bash
git add -A && git commit -m "feat: perfil de marca versionado y contexto para prompts"
```

---

### Task 8: Flujo P1 — generación de estrategia

**Files:**
- Create: `packages/strategy/package.json`
- Create: `packages/strategy/tsconfig.json`
- Create: `packages/strategy/vitest.config.ts`
- Create: `packages/strategy/src/esquemas.ts`
- Create: `packages/strategy/src/tipos.ts`
- Create: `packages/strategy/src/prompts/generar-estrategia.md`
- Create: `packages/strategy/src/p1.ts`
- Create: `packages/strategy/src/index.ts`
- Create: `packages/strategy/muestras/generar_estrategia.json`
- Test: `packages/strategy/src/p1.test.ts`

**Interfaces:**
- Consumes: `definirTarea`, `ejecutarTarea`, `ClienteLlm`, `ClienteFalso`, `crearRegistrador`, `exigirPresupuesto` (Tasks 3–5); `definirPaso`, `ejecutarFlujo` (Task 6); `cargarPerfilVigente`, `contextoDeMarca` (Task 7)
- Produces:
  - `Estrategia` (esquema Zod) y `TipoEstrategia`
  - `TAREA_ESTRATEGIA: DefinicionDeTarea<typeof Estrategia>`
  - `Dependencias { cliente: ClienteLlm; env?: Record<string, string | undefined> }` en `src/tipos.ts` — compartida por P1 y P2, para que ningún flujo dependa del otro
  - `crearFlujoEstrategia(deps: Dependencias): DefinicionDeFlujo`
  - `EntradaP1 { brandId: string; period: string }`, `SalidaP1 { strategyId: string; estrategia: TipoEstrategia }`

- [ ] **Step 1: Crear el paquete `@gc/strategy`**

`packages/strategy/package.json`:

```json
{
  "name": "@gc/strategy",
  "version": "0.0.0",
  "private": true,
  "type": "module",
  "main": "./src/index.ts",
  "types": "./src/index.ts",
  "scripts": {
    "test": "vitest run",
    "typecheck": "tsc --noEmit"
  },
  "dependencies": {
    "@gc/ai": "workspace:*",
    "@gc/brand": "workspace:*",
    "@gc/db": "workspace:*",
    "@gc/pipeline": "workspace:*",
    "@gc/shared": "workspace:*",
    "drizzle-orm": "^0.36.0",
    "zod": "^3.23.8"
  }
}
```

`packages/strategy/tsconfig.json`:

```json
{
  "extends": "../../tsconfig.base.json",
  "include": ["src"]
}
```

`packages/strategy/vitest.config.ts`:

```ts
import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    environment: 'node',
    include: ['src/**/*.test.ts'],
    setupFiles: ['../../vitest.setup.ts'],
    fileParallelism: false,
  },
})
```

```bash
pnpm install
```

- [ ] **Step 2: Escribir la prueba que falla**

`packages/strategy/src/p1.test.ts`:

```ts
import { ClienteFalso } from '@gc/ai'
import { PERFIL_VALIDO, guardarPerfil } from '@gc/brand'
import { esquema } from '@gc/db'
import { conBaseDeDatosDePrueba } from '@gc/db/pruebas'
import { ejecutarFlujo } from '@gc/pipeline'
import { describe, expect, it } from 'vitest'
import { crearFlujoEstrategia } from './p1.js'

const ENV = { MODELO_RAZONAMIENTO: 'proveedor/fuerte' }
const SIN_ESPERA = { dormir: async () => {}, aleatorio: () => 0 }

const ESTRATEGIA_JSON = JSON.stringify({
  objetivos: [{ nombre: 'Autoridad', metrica: 'alcance', meta: '+30% trimestral' }],
  mensajesClave: ['La factibilidad se verifica antes de comprar', 'Trazabilidad legal completa'],
  mixDeCanales: [
    { canal: 'blog', publicacionesPorSemana: 1 },
    { canal: 'linkedin', publicacionesPorSemana: 2 },
  ],
  reciclaje: [{ desde: 'blog', hacia: ['linkedin'], diasDespues: 2 }],
  temasPrioritarios: ['Factibilidad de agua', 'Regularización de roles'],
})

async function sembrar(db: Parameters<Parameters<typeof conBaseDeDatosDePrueba>[0]>[0]) {
  const [org] = await db.insert(esquema.organizations).values({ name: 'X' }).returning()
  const [marca] = await db
    .insert(esquema.brands)
    .values({ organizationId: org!.id, slug: 'parcelas', name: 'CTP' })
    .returning()
  const ref = { organizationId: org!.id, brandId: marca!.id }
  await guardarPerfil(db, ref, PERFIL_VALIDO)
  return ref
}

describe('flujo P1 · estrategia', () => {
  it('genera y persiste la estrategia fijando la versión del perfil', async () => {
    await conBaseDeDatosDePrueba(async (db) => {
      const ref = await sembrar(db)
      const cliente = new ClienteFalso([ESTRATEGIA_JSON])
      const flujo = crearFlujoEstrategia({ cliente, env: ENV })

      const r = await ejecutarFlujo(
        db, flujo, { brandId: ref.brandId, period: '2026-Q4' }, ref, SIN_ESPERA,
      )

      expect(r.estado).toBe('completado')
      const [fila] = await db.select().from(esquema.strategies)
      expect(fila!.period).toBe('2026-Q4')
      expect(fila!.status).toBe('borrador')
      expect(fila!.brandProfileVersion).toBe(1)
    })
  })

  it('envía el contexto de marca al modelo', async () => {
    await conBaseDeDatosDePrueba(async (db) => {
      const ref = await sembrar(db)
      const cliente = new ClienteFalso([ESTRATEGIA_JSON])
      const flujo = crearFlujoEstrategia({ cliente, env: ENV })

      await ejecutarFlujo(db, flujo, { brandId: ref.brandId, period: '2026-Q4' }, ref, SIN_ESPERA)

      const enviado = cliente.peticiones[0]!.mensajes.map((m) => m.texto).join('\n')
      expect(enviado).toContain('Pilares de contenido')
      expect(enviado).toContain('PROHIBIDO usar: Rentabilidad garantizada')
      expect(enviado).toContain('2026-Q4')
    })
  })

  it('registra el costo de la llamada', async () => {
    await conBaseDeDatosDePrueba(async (db) => {
      const ref = await sembrar(db)
      const flujo = crearFlujoEstrategia({ cliente: new ClienteFalso([ESTRATEGIA_JSON]), env: ENV })

      await ejecutarFlujo(db, flujo, { brandId: ref.brandId, period: '2026-Q4' }, ref, SIN_ESPERA)

      const llamadas = await db.select().from(esquema.aiCalls)
      expect(llamadas).toHaveLength(1)
      expect(llamadas[0]!.task).toBe('generar_estrategia')
      expect(llamadas[0]!.brandProfileVersion).toBe(1)
    })
  })

  it('se detiene si el presupuesto está agotado', async () => {
    await conBaseDeDatosDePrueba(async (db) => {
      const ref = await sembrar(db)
      await db.insert(esquema.aiCalls).values({
        organizationId: ref.organizationId, brandId: ref.brandId,
        task: 't', model: 'm', costUsd: '999.00', promptHash: 'h',
      })
      const flujo = crearFlujoEstrategia({ cliente: new ClienteFalso([ESTRATEGIA_JSON]), env: ENV })

      await expect(
        ejecutarFlujo(db, flujo, { brandId: ref.brandId, period: '2026-Q4' }, ref, SIN_ESPERA),
      ).rejects.toMatchObject({ clase: 'permanente' })
    })
  })

  it('reejecutar el mismo periodo reemplaza la estrategia en borrador', async () => {
    await conBaseDeDatosDePrueba(async (db) => {
      const ref = await sembrar(db)
      const entrada = { brandId: ref.brandId, period: '2026-Q4' }

      for (const _ of [1, 2]) {
        const flujo = crearFlujoEstrategia({ cliente: new ClienteFalso([ESTRATEGIA_JSON]), env: ENV })
        await ejecutarFlujo(db, flujo, entrada, ref, SIN_ESPERA)
      }

      expect(await db.select().from(esquema.strategies)).toHaveLength(1)
    })
  })
})
```

- [ ] **Step 3: Ejecutar y verificar que falla**

```bash
pnpm --filter @gc/strategy test
```

Esperado: FALLA con `Failed to resolve import "./p1.js"`.

- [ ] **Step 4: Escribir el esquema y el prompt**

`packages/strategy/src/esquemas.ts`:

```ts
import { CANALES } from '@gc/db'
import { z } from 'zod'

const Canal = z.enum(CANALES)

export const Estrategia = z.object({
  objetivos: z
    .array(
      z.object({
        nombre: z.string().min(3),
        metrica: z.string().min(3),
        meta: z.string().min(1),
      }),
    )
    .min(1)
    .max(4),
  mensajesClave: z.array(z.string().min(10)).min(2).max(6),
  mixDeCanales: z
    .array(
      z.object({
        canal: Canal,
        publicacionesPorSemana: z.number().int().min(0).max(21),
      }),
    )
    .min(1),
  /** Reglas deterministas de reciclaje que consume `expandirDerivados` (Task 9). */
  reciclaje: z.array(
    z.object({
      desde: Canal,
      hacia: z.array(Canal).min(1),
      diasDespues: z.number().int().min(0).max(30),
    }),
  ),
  temasPrioritarios: z.array(z.string().min(5)).min(1).max(10),
})

export type TipoEstrategia = z.infer<typeof Estrategia>
```

`packages/strategy/src/prompts/generar-estrategia.md`:

```markdown
Eres estratega de contenido. Produces la estrategia trimestral de UNA marca.

Reglas:

- Trabaja únicamente con el contexto de marca entregado. No inventes datos,
  cifras, premios ni casos de éxito.
- Los objetivos deben ser medibles con métricas que una red social o una
  herramienta de analítica web entregue realmente.
- Los mensajes clave son afirmaciones que la marca puede sostener con lo que
  aparece en su posicionamiento. Si no puede sostenerlo, no lo escribas.
- El mix de canales debe ser sostenible: prefiere una cadencia baja y constante
  antes que uno alta e irreal.
- Respeta el léxico prohibido de la marca sin excepción.
- Las reglas de reciclaje describen cómo una pieza de un canal se reutiliza en
  otros. Solo incluye canales presentes en el mix.

Responde únicamente con el JSON que cumple el esquema solicitado.
```

`packages/strategy/muestras/generar_estrategia.json`:

```json
{
  "objetivos": [
    { "nombre": "Autoridad en factibilidad", "metrica": "alcance", "meta": "+30% en el trimestre" }
  ],
  "mensajesClave": [
    "La factibilidad se verifica antes de comprar, no después",
    "Cada parcela tiene rol propio y trazabilidad legal completa"
  ],
  "mixDeCanales": [
    { "canal": "blog", "publicacionesPorSemana": 1 },
    { "canal": "linkedin", "publicacionesPorSemana": 2 },
    { "canal": "instagram", "publicacionesPorSemana": 3 }
  ],
  "reciclaje": [
    { "desde": "blog", "hacia": ["linkedin", "instagram"], "diasDespues": 2 }
  ],
  "temasPrioritarios": [
    "Cómo verificar la factibilidad de agua",
    "Qué significa que una parcela tenga rol propio"
  ]
}
```

- [ ] **Step 5: Implementar el flujo P1**

`packages/strategy/src/tipos.ts`:

```ts
import type { ClienteLlm } from '@gc/ai'

/** Dependencias inyectadas a los flujos P1 y P2. */
export interface Dependencias {
  cliente: ClienteLlm
  env?: Record<string, string | undefined>
}
```

`packages/strategy/src/p1.ts`:

```ts
import {
  crearRegistrador, definirTarea, ejecutarTarea, exigirPresupuesto,
  type MensajeLlm,
} from '@gc/ai'
import { cargarPerfilVigente, contextoDeMarca } from '@gc/brand'
import { esquema } from '@gc/db'
import { definirPaso, type DefinicionDeFlujo } from '@gc/pipeline'
import { readFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import { Estrategia, type TipoEstrategia } from './esquemas.js'
import type { Dependencias } from './tipos.js'

export const TAREA_ESTRATEGIA = definirTarea({
  nombre: 'generar_estrategia',
  nivel: 'razonamiento',
  esquema: Estrategia,
  temperatura: 0.6,
  maxTokensSalida: 3000,
})

const RUTA_PROMPT = fileURLToPath(new URL('./prompts/generar-estrategia.md', import.meta.url))

export interface EntradaP1 {
  brandId: string
  period: string
}

export interface SalidaP1 {
  strategyId: string
  estrategia: TipoEstrategia
}

export function crearFlujoEstrategia(deps: Dependencias): DefinicionDeFlujo {
  const paso = definirPaso<EntradaP1, SalidaP1>({
    nombre: 'generar_estrategia',
    ejecutar: async (entrada, ctx) => {
      await exigirPresupuesto(ctx.db, entrada.brandId, new Date())

      const { version, perfil } = await cargarPerfilVigente(ctx.db, entrada.brandId)
      const instrucciones = await readFile(RUTA_PROMPT, 'utf8')

      const mensajes: MensajeLlm[] = [
        { rol: 'sistema', texto: instrucciones },
        {
          rol: 'usuario',
          texto: [
            contextoDeMarca(perfil),
            '',
            `## Encargo`,
            `Genera la estrategia de contenido para el periodo ${entrada.period}.`,
          ].join('\n'),
        },
      ]

      const { datos } = await ejecutarTarea(TAREA_ESTRATEGIA, mensajes, {
        cliente: deps.cliente,
        ...(deps.env !== undefined ? { env: deps.env } : {}),
        registrarUso: crearRegistrador(ctx.db, {
          organizationId: ctx.organizationId,
          brandId: entrada.brandId,
          runId: ctx.runId,
          brandProfileVersion: version,
        }),
      })

      const [fila] = await ctx.db
        .insert(esquema.strategies)
        .values({
          organizationId: ctx.organizationId,
          brandId: entrada.brandId,
          period: entrada.period,
          data: datos,
          brandProfileVersion: version,
        })
        .onConflictDoUpdate({
          target: [esquema.strategies.brandId, esquema.strategies.period],
          set: { data: datos, brandProfileVersion: version, status: 'borrador' },
        })
        .returning()

      return { strategyId: fila!.id, estrategia: datos }
    },
  })

  return { nombre: 'p1_estrategia', pasos: [paso] }
}
```

`packages/strategy/src/index.ts`:

```ts
export * from './esquemas.js'
export * from './p1.js'
export * from './tipos.js'
```

- [ ] **Step 6: Ejecutar las pruebas y verificar que pasan**

```bash
pnpm --filter @gc/strategy test
```

Esperado: PASA, 5 pruebas.

- [ ] **Step 7: Commit**

```bash
git add -A && git commit -m "feat: flujo P1 de generación de estrategia trimestral"
```

---

### Task 9: Validación de grilla y expansión de derivados

**Files:**
- Modify: `packages/strategy/src/esquemas.ts`
- Create: `packages/strategy/src/validacion.ts`
- Create: `packages/strategy/src/derivados.ts`
- Test: `packages/strategy/src/validacion.test.ts`
- Test: `packages/strategy/src/derivados.test.ts`

**Interfaces:**
- Consumes: `TipoEstrategia` (Task 8); `TipoPerfilDeMarca` (Task 7); `CANALES` (Task 2)
- Produces:
  - `GrillaPropuesta` (esquema Zod) y `SlotPropuesto { fecha, hora, canal, formato, pilar, angulo, brief }`
  - `Problema { severidad: 'bloqueante' | 'aviso'; regla: string; detalle: string }`
  - `validarGrilla(slots: SlotPropuesto[], ctx: ContextoDeValidacion): Problema[]` con `ContextoDeValidacion { mes: string; perfil: TipoPerfilDeMarca; estrategia: TipoEstrategia }`
  - `hayBloqueantes(problemas: Problema[]): boolean`
  - `expandirDerivados(slots: SlotPropuesto[], estrategia: TipoEstrategia, mes: string): SlotDerivado[]` con `SlotDerivado extends SlotPropuesto { indiceDelPadre: number }`

- [ ] **Step 1: Agregar el esquema de la grilla**

Agregar al final de `packages/strategy/src/esquemas.ts`:

```ts
export const SlotPropuesto = z.object({
  fecha: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'formato esperado AAAA-MM-DD'),
  hora: z.string().regex(/^\d{2}:\d{2}$/, 'formato esperado HH:MM (UTC)'),
  canal: Canal,
  formato: z.string().min(2),
  pilar: z.string().min(2),
  angulo: z.string().min(5),
  brief: z.string().min(20),
})

export const GrillaPropuesta = z.object({
  slots: z.array(SlotPropuesto).min(1).max(120),
})

export type TipoSlotPropuesto = z.infer<typeof SlotPropuesto>
export type TipoGrillaPropuesta = z.infer<typeof GrillaPropuesta>
```

- [ ] **Step 2: Escribir la prueba de validación**

`packages/strategy/src/validacion.test.ts`:

```ts
import { PERFIL_VALIDO, validarPerfil } from '@gc/brand'
import { describe, expect, it } from 'vitest'
import type { TipoEstrategia } from './esquemas.js'
import { hayBloqueantes, validarGrilla, type ContextoDeValidacion } from './validacion.js'

const ESTRATEGIA: TipoEstrategia = {
  objetivos: [{ nombre: 'A', metrica: 'alcance', meta: '+10%' }],
  mensajesClave: ['uno que es largo', 'otro que es largo'],
  mixDeCanales: [
    { canal: 'blog', publicacionesPorSemana: 1 },
    { canal: 'linkedin', publicacionesPorSemana: 2 },
  ],
  reciclaje: [],
  temasPrioritarios: ['tema uno'],
}

const CTX: ContextoDeValidacion = {
  mes: '2026-09',
  perfil: validarPerfil(PERFIL_VALIDO),
  estrategia: ESTRATEGIA,
}

const slot = (p: Partial<Parameters<typeof validarGrilla>[0][number]> = {}) => ({
  fecha: '2026-09-03',
  hora: '13:00',
  canal: 'linkedin' as const,
  formato: 'post',
  pilar: 'educacion',
  angulo: 'mito común',
  brief: 'Desmontar el mito de que toda parcela tiene agua asegurada.',
  ...p,
})

describe('validarGrilla', () => {
  it('marca como bloqueante una fecha fuera del mes', () => {
    const p = validarGrilla([slot({ fecha: '2026-10-01' })], CTX)
    expect(p).toContainEqual(expect.objectContaining({ regla: 'fuera_de_mes', severidad: 'bloqueante' }))
  })

  it('marca como bloqueante un canal ausente del mix', () => {
    const p = validarGrilla([slot({ canal: 'tiktok' })], CTX)
    expect(p).toContainEqual(expect.objectContaining({ regla: 'canal_fuera_de_mix' }))
  })

  it('marca como bloqueante un pilar que no existe en el perfil', () => {
    const p = validarGrilla([slot({ pilar: 'inventado' })], CTX)
    expect(p).toContainEqual(expect.objectContaining({ regla: 'pilar_desconocido' }))
  })

  it('marca como bloqueante dos publicaciones del mismo canal el mismo día', () => {
    const p = validarGrilla([slot(), slot({ hora: '18:00' })], CTX)
    expect(p).toContainEqual(expect.objectContaining({ regla: 'duplicado_por_dia' }))
  })

  it('avisa cuando la cadencia se aleja de la estrategia', () => {
    const p = validarGrilla([slot()], CTX)
    const cadencia = p.filter((x) => x.regla === 'cadencia')
    expect(cadencia.length).toBeGreaterThan(0)
    expect(cadencia.every((x) => x.severidad === 'aviso')).toBe(true)
  })

  it('avisa cuando la distribución de pilares se desvía más de 10 puntos', () => {
    const slots = Array.from({ length: 10 }, (_, i) => ({
      ...slot({ fecha: `2026-09-${String(i + 1).padStart(2, '0')}` }),
      pilar: 'educacion',
    }))
    const p = validarGrilla(slots, CTX)
    expect(p).toContainEqual(
      expect.objectContaining({ regla: 'distribucion_de_pilares', severidad: 'aviso' }),
    )
  })

  it('hayBloqueantes distingue avisos de bloqueantes', () => {
    expect(hayBloqueantes([{ severidad: 'aviso', regla: 'x', detalle: 'y' }])).toBe(false)
    expect(hayBloqueantes([{ severidad: 'bloqueante', regla: 'x', detalle: 'y' }])).toBe(true)
  })
})
```

- [ ] **Step 3: Ejecutar y verificar que falla**

```bash
pnpm --filter @gc/strategy test validacion
```

Esperado: FALLA con `Failed to resolve import "./validacion.js"`.

- [ ] **Step 4: Implementar la validación**

`packages/strategy/src/validacion.ts`:

```ts
import type { TipoPerfilDeMarca } from '@gc/brand'
import type { TipoEstrategia, TipoSlotPropuesto } from './esquemas.js'

export interface Problema {
  severidad: 'bloqueante' | 'aviso'
  regla: string
  detalle: string
}

export interface ContextoDeValidacion {
  /** Mes objetivo en formato AAAA-MM. */
  mes: string
  perfil: TipoPerfilDeMarca
  estrategia: TipoEstrategia
}

const TOLERANCIA_DE_CADENCIA = 1
const TOLERANCIA_DE_PILAR = 0.1

export function hayBloqueantes(problemas: Problema[]): boolean {
  return problemas.some((p) => p.severidad === 'bloqueante')
}

function diasDelMes(mes: string): number {
  const [anio, m] = mes.split('-').map(Number)
  return new Date(Date.UTC(anio!, m!, 0)).getUTCDate()
}

export function validarGrilla(
  slots: TipoSlotPropuesto[],
  ctx: ContextoDeValidacion,
): Problema[] {
  const problemas: Problema[] = []
  const bloqueante = (regla: string, detalle: string) =>
    problemas.push({ severidad: 'bloqueante', regla, detalle })
  const aviso = (regla: string, detalle: string) =>
    problemas.push({ severidad: 'aviso', regla, detalle })

  const canalesDelMix = new Set(ctx.estrategia.mixDeCanales.map((c) => c.canal))
  const pilaresConocidos = new Set(ctx.perfil.pilares.map((p) => p.nombre))
  const vistos = new Set<string>()

  for (const s of slots) {
    if (!s.fecha.startsWith(`${ctx.mes}-`)) {
      bloqueante('fuera_de_mes', `El slot del ${s.fecha} no pertenece al mes ${ctx.mes}`)
    }
    if (!canalesDelMix.has(s.canal)) {
      bloqueante('canal_fuera_de_mix', `El canal "${s.canal}" no está en el mix de la estrategia`)
    }
    if (!pilaresConocidos.has(s.pilar)) {
      bloqueante(
        'pilar_desconocido',
        `El pilar "${s.pilar}" no existe en el perfil (válidos: ${[...pilaresConocidos].join(', ')})`,
      )
    }
    const clave = `${s.canal}|${s.fecha}`
    if (vistos.has(clave)) {
      bloqueante('duplicado_por_dia', `Hay dos publicaciones de ${s.canal} el ${s.fecha}`)
    }
    vistos.add(clave)
  }

  const semanas = diasDelMes(ctx.mes) / 7
  for (const c of ctx.estrategia.mixDeCanales) {
    const esperado = Math.round(c.publicacionesPorSemana * semanas)
    const real = slots.filter((s) => s.canal === c.canal).length
    if (Math.abs(real - esperado) > TOLERANCIA_DE_CADENCIA) {
      aviso(
        'cadencia',
        `${c.canal}: se planificaron ${real} publicaciones y la estrategia espera ~${esperado}`,
      )
    }
  }

  if (slots.length > 0) {
    for (const pilar of ctx.perfil.pilares) {
      const real = slots.filter((s) => s.pilar === pilar.nombre).length / slots.length
      if (Math.abs(real - pilar.proporcion) > TOLERANCIA_DE_PILAR) {
        aviso(
          'distribucion_de_pilares',
          `${pilar.nombre}: ${Math.round(real * 100)}% de la grilla frente al ${Math.round(pilar.proporcion * 100)}% esperado`,
        )
      }
    }
  }

  return problemas
}
```

- [ ] **Step 5: Ejecutar y verificar que pasa**

```bash
pnpm --filter @gc/strategy test validacion
```

Esperado: PASA, 7 pruebas.

- [ ] **Step 6: Escribir la prueba de derivados**

`packages/strategy/src/derivados.test.ts`:

```ts
import { describe, expect, it } from 'vitest'
import { expandirDerivados } from './derivados.js'
import type { TipoEstrategia, TipoSlotPropuesto } from './esquemas.js'

const BASE: TipoSlotPropuesto = {
  fecha: '2026-09-10',
  hora: '12:00',
  canal: 'blog',
  formato: 'articulo',
  pilar: 'educacion',
  angulo: 'guía práctica',
  brief: 'Guía completa para verificar la factibilidad de agua antes de comprar.',
}

const ESTRATEGIA = {
  reciclaje: [{ desde: 'blog', hacia: ['linkedin', 'instagram'], diasDespues: 2 }],
} as unknown as TipoEstrategia

describe('expandirDerivados', () => {
  it('crea un derivado por canal destino, desplazado en el tiempo', () => {
    const d = expandirDerivados([BASE], ESTRATEGIA, '2026-09')

    expect(d).toHaveLength(2)
    expect(d.map((x) => x.canal).sort()).toEqual(['instagram', 'linkedin'])
    expect(d.every((x) => x.fecha === '2026-09-12')).toBe(true)
    expect(d.every((x) => x.indiceDelPadre === 0)).toBe(true)
    expect(d[0]!.pilar).toBe('educacion')
    expect(d[0]!.brief).toContain('Guía completa')
  })

  it('descarta los derivados que caerían fuera del mes', () => {
    const alFinal = { ...BASE, fecha: '2026-09-30' }
    expect(expandirDerivados([alFinal], ESTRATEGIA, '2026-09')).toHaveLength(0)
  })

  it('ignora los slots cuyo canal no tiene regla de reciclaje', () => {
    const post = { ...BASE, canal: 'linkedin' as const, formato: 'post' }
    expect(expandirDerivados([post], ESTRATEGIA, '2026-09')).toHaveLength(0)
  })

  it('no genera derivados si la estrategia no define reciclaje', () => {
    const sinReglas = { reciclaje: [] } as unknown as TipoEstrategia
    expect(expandirDerivados([BASE], sinReglas, '2026-09')).toHaveLength(0)
  })
})
```

- [ ] **Step 7: Ejecutar y verificar que falla**

```bash
pnpm --filter @gc/strategy test derivados
```

Esperado: FALLA con `Failed to resolve import "./derivados.js"`.

- [ ] **Step 8: Implementar la expansión**

`packages/strategy/src/derivados.ts`:

```ts
import type { TipoEstrategia, TipoSlotPropuesto } from './esquemas.js'

export interface SlotDerivado extends TipoSlotPropuesto {
  /** Posición del slot padre dentro del arreglo original. */
  indiceDelPadre: number
}

function sumarDias(fecha: string, dias: number): string {
  const d = new Date(`${fecha}T00:00:00Z`)
  d.setUTCDate(d.getUTCDate() + dias)
  return d.toISOString().slice(0, 10)
}

/**
 * Paso determinístico: aplica las reglas de reciclaje de la estrategia sin
 * consultar al modelo. Los derivados que caen fuera del mes se descartan.
 */
export function expandirDerivados(
  slots: TipoSlotPropuesto[],
  estrategia: TipoEstrategia,
  mes: string,
): SlotDerivado[] {
  const derivados: SlotDerivado[] = []

  slots.forEach((padre, indiceDelPadre) => {
    for (const regla of estrategia.reciclaje) {
      if (regla.desde !== padre.canal) continue

      for (const canal of regla.hacia) {
        const fecha = sumarDias(padre.fecha, regla.diasDespues)
        if (!fecha.startsWith(`${mes}-`)) continue

        derivados.push({
          ...padre,
          indiceDelPadre,
          canal,
          formato: 'derivado',
          fecha,
          angulo: `Adaptación para ${canal}: ${padre.angulo}`,
          brief: `Adaptar al formato de ${canal} la pieza original.\n\n${padre.brief}`,
        })
      }
    }
  })

  return derivados
}
```

- [ ] **Step 9: Ejecutar y verificar que pasa**

```bash
pnpm --filter @gc/strategy test derivados
```

Esperado: PASA, 4 pruebas.

- [ ] **Step 10: Commit**

```bash
git add -A && git commit -m "feat: validación de grilla y expansión de derivados"
```

---

### Task 10: Flujo P2 — generación de la grilla mensual

**Files:**
- Create: `packages/strategy/src/prompts/proponer-grilla.md`
- Create: `packages/strategy/src/p2.ts`
- Modify: `packages/strategy/src/index.ts`
- Create: `packages/strategy/muestras/proponer_grilla.json`
- Test: `packages/strategy/src/p2.test.ts`

**Interfaces:**
- Consumes: todo lo anterior de `@gc/strategy`, `@gc/ai`, `@gc/brand`, `@gc/pipeline`
- Produces:
  - `TAREA_GRILLA: DefinicionDeTarea<typeof GrillaPropuesta>`
  - `crearFlujoGrilla(deps: Dependencias): DefinicionDeFlujo`
  - `EntradaP2 { brandId: string; mes: string }`, `SalidaP2 { contentPlanId: string; totalSlots: number; avisos: Problema[] }`

- [ ] **Step 1: Escribir la prueba que falla**

`packages/strategy/src/p2.test.ts`:

```ts
import { ClienteFalso } from '@gc/ai'
import { PERFIL_VALIDO, guardarPerfil } from '@gc/brand'
import { esquema } from '@gc/db'
import { conBaseDeDatosDePrueba } from '@gc/db/pruebas'
import { ejecutarFlujo } from '@gc/pipeline'
import { eq, isNotNull } from 'drizzle-orm'
import { describe, expect, it } from 'vitest'
import { crearFlujoGrilla } from './p2.js'

const ENV = { MODELO_RAZONAMIENTO: 'proveedor/fuerte' }
const SIN_ESPERA = { dormir: async () => {}, aleatorio: () => 0 }

const ESTRATEGIA = {
  objetivos: [{ nombre: 'A', metrica: 'alcance', meta: '+10%' }],
  mensajesClave: ['mensaje uno largo', 'mensaje dos largo'],
  mixDeCanales: [{ canal: 'blog', publicacionesPorSemana: 1 }],
  reciclaje: [{ desde: 'blog', hacia: ['linkedin'], diasDespues: 2 }],
  temasPrioritarios: ['factibilidad de agua'],
}

const grilla = (slots: unknown[]) => JSON.stringify({ slots })

const SLOT = (fecha: string, pilar: string) => ({
  fecha,
  hora: '12:00',
  canal: 'blog',
  formato: 'articulo',
  pilar,
  angulo: 'guía práctica',
  brief: 'Explicar paso a paso cómo verificar la factibilidad antes de comprar.',
})

const GRILLA_VALIDA = grilla([
  SLOT('2026-09-02', 'educacion'),
  SLOT('2026-09-09', 'educacion'),
  SLOT('2026-09-16', 'confianza'),
  SLOT('2026-09-23', 'producto'),
])

async function sembrar(db: Parameters<Parameters<typeof conBaseDeDatosDePrueba>[0]>[0]) {
  const [org] = await db.insert(esquema.organizations).values({ name: 'X' }).returning()
  const [marca] = await db
    .insert(esquema.brands)
    .values({ organizationId: org!.id, slug: 'parcelas', name: 'CTP' })
    .returning()
  const ref = { organizationId: org!.id, brandId: marca!.id }
  await guardarPerfil(db, ref, PERFIL_VALIDO)
  await db.insert(esquema.strategies).values({
    organizationId: ref.organizationId,
    brandId: ref.brandId,
    period: '2026-Q3',
    data: ESTRATEGIA,
    brandProfileVersion: 1,
  })
  return ref
}

describe('flujo P2 · grilla', () => {
  it('persiste el plan, los slots y sus derivados enlazados', async () => {
    await conBaseDeDatosDePrueba(async (db) => {
      const ref = await sembrar(db)
      const flujo = crearFlujoGrilla({ cliente: new ClienteFalso([GRILLA_VALIDA]), env: ENV })

      const r = await ejecutarFlujo(
        db, flujo, { brandId: ref.brandId, mes: '2026-09' }, ref, SIN_ESPERA,
      )
      expect(r.estado).toBe('completado')

      const [plan] = await db.select().from(esquema.contentPlans)
      expect(plan!.status).toBe('borrador')

      const slots = await db.select().from(esquema.planSlots)
      expect(slots).toHaveLength(8)

      const derivados = await db
        .select()
        .from(esquema.planSlots)
        .where(isNotNull(esquema.planSlots.sourceSlotId))
      expect(derivados).toHaveLength(4)
      expect(derivados.every((d) => d.channel === 'linkedin')).toBe(true)
    })
  })

  it('repara una sola vez cuando la grilla tiene problemas bloqueantes', async () => {
    await conBaseDeDatosDePrueba(async (db) => {
      const ref = await sembrar(db)
      const invalida = grilla([SLOT('2026-10-05', 'educacion')])
      const cliente = new ClienteFalso([invalida, GRILLA_VALIDA])
      const flujo = crearFlujoGrilla({ cliente, env: ENV })

      await ejecutarFlujo(db, flujo, { brandId: ref.brandId, mes: '2026-09' }, ref, SIN_ESPERA)

      expect(cliente.peticiones).toHaveLength(2)
      const reintento = cliente.peticiones[1]!.mensajes.at(-1)!.texto
      expect(reintento).toContain('fuera_de_mes')
    })
  })

  it('falla de forma permanente si la reparación sigue siendo inválida', async () => {
    await conBaseDeDatosDePrueba(async (db) => {
      const ref = await sembrar(db)
      const invalida = grilla([SLOT('2026-10-05', 'educacion')])
      const flujo = crearFlujoGrilla({
        cliente: new ClienteFalso([invalida, invalida]),
        env: ENV,
      })

      await expect(
        ejecutarFlujo(db, flujo, { brandId: ref.brandId, mes: '2026-09' }, ref, SIN_ESPERA),
      ).rejects.toMatchObject({ clase: 'permanente' })

      expect(await db.select().from(esquema.planSlots)).toHaveLength(0)
    })
  })

  it('devuelve los avisos sin bloquear', async () => {
    await conBaseDeDatosDePrueba(async (db) => {
      const ref = await sembrar(db)
      const pocos = grilla([SLOT('2026-09-02', 'educacion')])
      const flujo = crearFlujoGrilla({ cliente: new ClienteFalso([pocos]), env: ENV })

      const r = await ejecutarFlujo(
        db, flujo, { brandId: ref.brandId, mes: '2026-09' }, ref, SIN_ESPERA,
      )
      const salida = r.salida as { avisos: Array<{ regla: string }> }
      expect(salida.avisos.map((a) => a.regla)).toContain('cadencia')
    })
  })

  it('regenerar el mismo mes reemplaza los slots anteriores', async () => {
    await conBaseDeDatosDePrueba(async (db) => {
      const ref = await sembrar(db)
      const entrada = { brandId: ref.brandId, mes: '2026-09' }

      for (const _ of [1, 2]) {
        const flujo = crearFlujoGrilla({ cliente: new ClienteFalso([GRILLA_VALIDA]), env: ENV })
        await ejecutarFlujo(db, flujo, entrada, ref, SIN_ESPERA)
      }

      expect(await db.select().from(esquema.contentPlans)).toHaveLength(1)
      expect(await db.select().from(esquema.planSlots)).toHaveLength(8)
    })
  })

  it('falla si la marca no tiene estrategia', async () => {
    await conBaseDeDatosDePrueba(async (db) => {
      const [org] = await db.insert(esquema.organizations).values({ name: 'X' }).returning()
      const [marca] = await db
        .insert(esquema.brands)
        .values({ organizationId: org!.id, slug: 'sin', name: 'Sin' })
        .returning()
      const ref = { organizationId: org!.id, brandId: marca!.id }
      await guardarPerfil(db, ref, PERFIL_VALIDO)

      const flujo = crearFlujoGrilla({ cliente: new ClienteFalso([GRILLA_VALIDA]), env: ENV })
      await expect(
        ejecutarFlujo(db, flujo, { brandId: ref.brandId, mes: '2026-09' }, ref, SIN_ESPERA),
      ).rejects.toMatchObject({ clase: 'permanente' })
    })
  })
})
```

- [ ] **Step 2: Ejecutar y verificar que falla**

```bash
pnpm --filter @gc/strategy test p2
```

Esperado: FALLA con `Failed to resolve import "./p2.js"`.

- [ ] **Step 3: Escribir el prompt y la muestra**

`packages/strategy/src/prompts/proponer-grilla.md`:

```markdown
Eres planificador editorial. Produces la grilla de contenido de UN mes para
UNA marca.

Reglas obligatorias:

- Todas las fechas deben caer dentro del mes solicitado.
- Usa únicamente canales presentes en el mix de la estrategia.
- Usa únicamente los nombres de pilar declarados en el perfil, tal cual están
  escritos.
- No planifiques dos publicaciones del mismo canal el mismo día.
- Respeta la cadencia semanal de cada canal y la proporción de cada pilar.
- El `brief` describe qué debe decir la pieza y para quién, en dos o tres
  frases. No escribas el copy final: eso ocurre en otra etapa.
- El `angulo` es el enfoque específico, no un título genérico.
- No planifiques adaptaciones a otros canales: el reciclaje se aplica después
  de forma automática.
- La hora va en UTC.

Responde únicamente con el JSON que cumple el esquema solicitado.
```

`packages/strategy/muestras/proponer_grilla.json`:

```json
{
  "slots": [
    {
      "fecha": "2026-09-02",
      "hora": "13:00",
      "canal": "blog",
      "formato": "articulo",
      "pilar": "educacion",
      "angulo": "Checklist previo a la compra",
      "brief": "Explicar los cinco documentos que un comprador debe exigir antes de firmar una promesa de compraventa."
    },
    {
      "fecha": "2026-09-09",
      "hora": "13:00",
      "canal": "blog",
      "formato": "articulo",
      "pilar": "confianza",
      "angulo": "Cómo se verifica la factibilidad de agua",
      "brief": "Detallar el procedimiento real de verificación de factibilidad, con los organismos involucrados y los plazos habituales."
    },
    {
      "fecha": "2026-09-16",
      "hora": "13:00",
      "canal": "blog",
      "formato": "articulo",
      "pilar": "producto",
      "angulo": "Qué incluye la asesoría de factibilidad",
      "brief": "Describir el alcance concreto de la asesoría y en qué casos conviene contratarla."
    },
    {
      "fecha": "2026-09-23",
      "hora": "13:00",
      "canal": "blog",
      "formato": "articulo",
      "pilar": "educacion",
      "angulo": "Diferencia entre rol propio y rol matriz",
      "brief": "Aclarar en lenguaje simple qué implica cada figura para el comprador y qué riesgos trae la segunda."
    }
  ]
}
```

- [ ] **Step 4: Implementar el flujo P2**

`packages/strategy/src/p2.ts`:

```ts
import {
  crearRegistrador, definirTarea, ejecutarTarea, exigirPresupuesto,
  type MensajeLlm,
} from '@gc/ai'
import { cargarPerfilVigente, contextoDeMarca } from '@gc/brand'
import { esquema, type BaseDeDatos } from '@gc/db'
import { definirPaso, type ContextoDePaso, type DefinicionDeFlujo } from '@gc/pipeline'
import { permanente } from '@gc/shared'
import { desc, eq } from 'drizzle-orm'
import { readFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import { expandirDerivados } from './derivados.js'
import { Estrategia, GrillaPropuesta, type TipoEstrategia, type TipoSlotPropuesto } from './esquemas.js'
import type { Dependencias } from './tipos.js'
import { hayBloqueantes, validarGrilla, type Problema } from './validacion.js'

export const TAREA_GRILLA = definirTarea({
  nombre: 'proponer_grilla',
  nivel: 'razonamiento',
  esquema: GrillaPropuesta,
  temperatura: 0.7,
  maxTokensSalida: 8000,
})

const RUTA_PROMPT = fileURLToPath(new URL('./prompts/proponer-grilla.md', import.meta.url))

export interface EntradaP2 {
  brandId: string
  mes: string
}

export interface SalidaP2 {
  contentPlanId: string
  totalSlots: number
  avisos: Problema[]
}

export function crearFlujoGrilla(deps: Dependencias): DefinicionDeFlujo {
  const paso = definirPaso<EntradaP2, SalidaP2>({
    nombre: 'proponer_grilla',
    ejecutar: async (entrada, ctx) => {
      await exigirPresupuesto(ctx.db, entrada.brandId, new Date())

      const { version, perfil } = await cargarPerfilVigente(ctx.db, entrada.brandId)
      const { id: strategyId, estrategia } = await cargarEstrategiaVigente(ctx.db, entrada.brandId)
      const instrucciones = await readFile(RUTA_PROMPT, 'utf8')

      const registrarUso = crearRegistrador(ctx.db, {
        organizationId: ctx.organizationId,
        brandId: entrada.brandId,
        runId: ctx.runId,
        brandProfileVersion: version,
      })

      let mensajes: MensajeLlm[] = [
        { rol: 'sistema', texto: instrucciones },
        {
          rol: 'usuario',
          texto: [
            contextoDeMarca(perfil),
            '',
            '## Estrategia vigente',
            JSON.stringify(estrategia, null, 2),
            '',
            '## Encargo',
            `Planifica la grilla del mes ${entrada.mes}.`,
          ].join('\n'),
        },
      ]

      let slots: TipoSlotPropuesto[] = []
      let problemas: Problema[] = []

      // Un solo intento de reparación, alimentado con los problemas detectados.
      for (let intento = 1; intento <= 2; intento++) {
        const { datos } = await ejecutarTarea(TAREA_GRILLA, mensajes, {
          cliente: deps.cliente,
          ...(deps.env !== undefined ? { env: deps.env } : {}),
          registrarUso,
        })

        slots = datos.slots
        problemas = validarGrilla(slots, { mes: entrada.mes, perfil, estrategia })
        if (!hayBloqueantes(problemas)) break

        if (intento === 2) {
          throw permanente(
            `La grilla propuesta sigue teniendo problemas bloqueantes:\n` +
              problemas.map((p) => `- [${p.regla}] ${p.detalle}`).join('\n'),
          )
        }

        mensajes = [
          ...mensajes,
          { rol: 'asistente', texto: JSON.stringify(datos) },
          {
            rol: 'usuario',
            texto:
              'La grilla anterior incumple estas reglas:\n' +
              problemas
                .filter((p) => p.severidad === 'bloqueante')
                .map((p) => `- ${p.regla}: ${p.detalle}`)
                .join('\n') +
              '\nDevuelve la grilla corregida completa, sin explicaciones.',
          },
        ]
      }

      const derivados = expandirDerivados(slots, estrategia, entrada.mes)
      const contentPlanId = await persistir(ctx, entrada, strategyId, slots, derivados)

      return {
        contentPlanId,
        totalSlots: slots.length + derivados.length,
        avisos: problemas.filter((p) => p.severidad === 'aviso'),
      }
    },
  })

  return { nombre: 'p2_grilla', pasos: [paso] }
}

async function cargarEstrategiaVigente(
  db: BaseDeDatos,
  brandId: string,
): Promise<{ id: string; estrategia: TipoEstrategia }> {
  const [fila] = await db
    .select()
    .from(esquema.strategies)
    .where(eq(esquema.strategies.brandId, brandId))
    .orderBy(desc(esquema.strategies.createdAt))
    .limit(1)

  if (!fila) throw permanente(`La marca ${brandId} no tiene estrategia generada`)

  const r = Estrategia.safeParse(fila.data)
  if (!r.success) throw permanente(`La estrategia guardada de ${brandId} no valida`)

  return { id: fila.id, estrategia: r.data }
}

async function persistir(
  ctx: ContextoDePaso,
  entrada: EntradaP2,
  strategyId: string,
  slots: TipoSlotPropuesto[],
  derivados: ReturnType<typeof expandirDerivados>,
): Promise<string> {
  const mes = `${entrada.mes}-01`

  const [plan] = await ctx.db
    .insert(esquema.contentPlans)
    .values({
      organizationId: ctx.organizationId,
      brandId: entrada.brandId,
      strategyId,
      month: mes,
    })
    .onConflictDoUpdate({
      target: [esquema.contentPlans.brandId, esquema.contentPlans.month],
      set: { strategyId, status: 'borrador' },
    })
    .returning()

  const contentPlanId = plan!.id

  // Regenerar reemplaza la grilla anterior por completo.
  await ctx.db
    .delete(esquema.planSlots)
    .where(eq(esquema.planSlots.contentPlanId, contentPlanId))

  const aFila = (s: TipoSlotPropuesto, sourceSlotId: string | null) => ({
    organizationId: ctx.organizationId,
    contentPlanId,
    sourceSlotId,
    scheduledFor: new Date(`${s.fecha}T${s.hora}:00Z`),
    channel: s.canal,
    format: s.formato,
    pillar: s.pilar,
    angle: s.angulo,
    brief: s.brief,
  })

  const padres = await ctx.db
    .insert(esquema.planSlots)
    .values(slots.map((s) => aFila(s, null)))
    .returning({ id: esquema.planSlots.id })

  if (derivados.length > 0) {
    await ctx.db
      .insert(esquema.planSlots)
      .values(derivados.map((d) => aFila(d, padres[d.indiceDelPadre]!.id)))
  }

  return contentPlanId
}
```

Agregar a `packages/strategy/src/index.ts`:

```ts
export * from './derivados.js'
export * from './p2.js'
export * from './validacion.js'
```

- [ ] **Step 5: Ejecutar todas las pruebas del paquete**

```bash
pnpm --filter @gc/strategy test
```

Esperado: PASA, 22 pruebas.

- [ ] **Step 6: Commit**

```bash
git add -A && git commit -m "feat: flujo P2 de generación de grilla mensual con validación y derivados"
```

---

### Task 11: CLI de operación y prueba de humo de punta a punta

**Files:**
- Create: `apps/cli/package.json`
- Create: `apps/cli/tsconfig.json`
- Create: `apps/cli/vitest.config.ts`
- Create: `apps/cli/src/comandos.ts`
- Create: `apps/cli/src/entorno.ts`
- Create: `apps/cli/src/main.ts`
- Modify: `package.json` (script `cli`)
- Modify: `.env.example` (`CARPETA_DE_MUESTRAS`)
- Test: `apps/cli/src/humo.test.ts`

**Interfaces:**
- Consumes: todos los paquetes anteriores
- Produces: `crearMarca(db, args)`, `cargarPerfilDeArchivo(db, args)`, `generarEstrategia(db, cliente, args)`, `generarGrilla(db, cliente, args)`, `verGrilla(db, args)`. La app web de la Fase 1 (plan siguiente) reutiliza estas mismas funciones.

- [ ] **Step 1: Crear la app CLI**

`apps/cli/package.json`:

```json
{
  "name": "@gc/cli",
  "version": "0.0.0",
  "private": true,
  "type": "module",
  "scripts": {
    "start": "tsx src/main.ts",
    "test": "vitest run",
    "typecheck": "tsc --noEmit"
  },
  "dependencies": {
    "@gc/ai": "workspace:*",
    "@gc/brand": "workspace:*",
    "@gc/db": "workspace:*",
    "@gc/pipeline": "workspace:*",
    "@gc/shared": "workspace:*",
    "@gc/strategy": "workspace:*",
    "dotenv": "^16.4.5",
    "drizzle-orm": "^0.36.0"
  },
  "devDependencies": {
    "tsx": "^4.19.1"
  }
}
```

> Aquí `dotenv` sí es dependencia de ejecución, no de desarrollo: el CLI lee el `.env` al arrancar.

`apps/cli/tsconfig.json`:

```json
{
  "extends": "../../tsconfig.base.json",
  "include": ["src"]
}
```

`apps/cli/vitest.config.ts`:

```ts
import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    environment: 'node',
    include: ['src/**/*.test.ts'],
    setupFiles: ['../../vitest.setup.ts'],
    fileParallelism: false,
    testTimeout: 30_000,
  },
})
```

Agregar a los `scripts` de `package.json` de la raíz:

```json
    "cli": "pnpm --filter @gc/cli start --"
```

Agregar a `.env.example`:

```
CARPETA_DE_MUESTRAS=packages/strategy/muestras
```

```bash
pnpm install
```

- [ ] **Step 2: Escribir la prueba de humo**

`apps/cli/src/humo.test.ts`:

```ts
import { ClienteDeMuestra } from '@gc/ai'
import { PERFIL_VALIDO } from '@gc/brand'
import { esquema } from '@gc/db'
import { conBaseDeDatosDePrueba } from '@gc/db/pruebas'
import { isNotNull } from 'drizzle-orm'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { cargarPerfilDeObjeto, crearMarca, generarEstrategia, generarGrilla, verGrilla } from './comandos.js'

const MUESTRAS = fileURLToPath(new URL('../../../packages/strategy/muestras', import.meta.url))
const ENV = { MODELO_RAZONAMIENTO: 'proveedor/fuerte' }

describe('marcha en seco de punta a punta', () => {
  it('va del perfil a la grilla sin gastar un solo token', async () => {
    await conBaseDeDatosDePrueba(async (db) => {
      const cliente = new ClienteDeMuestra(MUESTRAS)

      const marca = await crearMarca(db, { slug: 'parcelas', nombre: 'Compra Tu Parcela' })
      await cargarPerfilDeObjeto(db, { slug: 'parcelas', perfil: PERFIL_VALIDO })

      const estrategia = await generarEstrategia(db, cliente, {
        slug: 'parcelas', periodo: '2026-Q3', env: ENV,
      })
      expect(estrategia.strategyId).toBeTruthy()

      const grilla = await generarGrilla(db, cliente, {
        slug: 'parcelas', mes: '2026-09', env: ENV,
      })

      // 4 artículos de blog + 2 derivados por cada uno (linkedin e instagram)
      expect(grilla.totalSlots).toBe(12)

      const derivados = await db
        .select()
        .from(esquema.planSlots)
        .where(isNotNull(esquema.planSlots.sourceSlotId))
      expect(derivados).toHaveLength(8)

      const llamadas = await db.select().from(esquema.aiCalls)
      expect(llamadas).toHaveLength(2)
      expect(llamadas.every((l) => Number(l.costUsd) === 0)).toBe(true)

      const filas = await verGrilla(db, { slug: 'parcelas', mes: '2026-09' })
      expect(filas).toHaveLength(12)
      expect(filas[0]!.fecha <= filas[1]!.fecha).toBe(true)

      expect(marca.brandId).toBeTruthy()
    })
  })

  it('rechaza generar la grilla de una marca inexistente', async () => {
    await conBaseDeDatosDePrueba(async (db) => {
      await expect(
        generarGrilla(db, new ClienteDeMuestra(MUESTRAS), {
          slug: 'no-existe', mes: '2026-09', env: ENV,
        }),
      ).rejects.toMatchObject({ clase: 'permanente' })
    })
  })
})
```

- [ ] **Step 3: Ejecutar y verificar que falla**

```bash
pnpm --filter @gc/cli test
```

Esperado: FALLA con `Failed to resolve import "./comandos.js"`.

- [ ] **Step 4: Implementar los comandos**

`apps/cli/src/comandos.ts`:

```ts
import type { ClienteLlm } from '@gc/ai'
import { guardarPerfil } from '@gc/brand'
import { esquema, type BaseDeDatos } from '@gc/db'
import { ejecutarFlujo } from '@gc/pipeline'
import { permanente } from '@gc/shared'
import { crearFlujoEstrategia, crearFlujoGrilla, type SalidaP1, type SalidaP2 } from '@gc/strategy'
import { and, asc, eq, gte, lt } from 'drizzle-orm'
import { readFile } from 'node:fs/promises'

const ORGANIZACION_POR_DEFECTO = 'Principal'

export interface ReferenciaResuelta {
  organizationId: string
  brandId: string
}

async function asegurarOrganizacion(db: BaseDeDatos): Promise<string> {
  const [existente] = await db.select().from(esquema.organizations).limit(1)
  if (existente) return existente.id

  const [nueva] = await db
    .insert(esquema.organizations)
    .values({ name: ORGANIZACION_POR_DEFECTO })
    .returning()
  return nueva!.id
}

async function resolverMarca(db: BaseDeDatos, slug: string): Promise<ReferenciaResuelta> {
  const [marca] = await db.select().from(esquema.brands).where(eq(esquema.brands.slug, slug))
  if (!marca) throw permanente(`No existe la marca "${slug}"`)
  return { organizationId: marca.organizationId, brandId: marca.id }
}

export async function crearMarca(
  db: BaseDeDatos,
  args: { slug: string; nombre: string; presupuesto?: string },
): Promise<ReferenciaResuelta> {
  const organizationId = await asegurarOrganizacion(db)
  const [marca] = await db
    .insert(esquema.brands)
    .values({
      organizationId,
      slug: args.slug,
      name: args.nombre,
      ...(args.presupuesto !== undefined ? { monthlyBudgetUsd: args.presupuesto } : {}),
    })
    .returning()
  return { organizationId, brandId: marca!.id }
}

export async function cargarPerfilDeObjeto(
  db: BaseDeDatos,
  args: { slug: string; perfil: unknown },
): Promise<number> {
  const ref = await resolverMarca(db, args.slug)
  return guardarPerfil(db, ref, args.perfil)
}

export async function cargarPerfilDeArchivo(
  db: BaseDeDatos,
  args: { slug: string; archivo: string },
): Promise<number> {
  const crudo = JSON.parse(await readFile(args.archivo, 'utf8')) as unknown
  return cargarPerfilDeObjeto(db, { slug: args.slug, perfil: crudo })
}

export async function generarEstrategia(
  db: BaseDeDatos,
  cliente: ClienteLlm,
  args: { slug: string; periodo: string; env?: Record<string, string | undefined> },
): Promise<SalidaP1> {
  const ref = await resolverMarca(db, args.slug)
  const flujo = crearFlujoEstrategia({
    cliente,
    ...(args.env !== undefined ? { env: args.env } : {}),
  })
  const r = await ejecutarFlujo(db, flujo, { brandId: ref.brandId, period: args.periodo }, ref)
  return r.salida as SalidaP1
}

export async function generarGrilla(
  db: BaseDeDatos,
  cliente: ClienteLlm,
  args: { slug: string; mes: string; env?: Record<string, string | undefined> },
): Promise<SalidaP2> {
  const ref = await resolverMarca(db, args.slug)
  const flujo = crearFlujoGrilla({
    cliente,
    ...(args.env !== undefined ? { env: args.env } : {}),
  })
  const r = await ejecutarFlujo(db, flujo, { brandId: ref.brandId, mes: args.mes }, ref)
  return r.salida as SalidaP2
}

export interface FilaDeGrilla {
  fecha: string
  canal: string
  formato: string
  pilar: string
  angulo: string
  derivado: boolean
}

export async function verGrilla(
  db: BaseDeDatos,
  args: { slug: string; mes: string },
): Promise<FilaDeGrilla[]> {
  const ref = await resolverMarca(db, args.slug)
  const [anio, mes] = args.mes.split('-').map(Number)
  const desde = new Date(Date.UTC(anio!, mes! - 1, 1))
  const hasta = new Date(Date.UTC(anio!, mes!, 1))

  const filas = await db
    .select({
      scheduledFor: esquema.planSlots.scheduledFor,
      channel: esquema.planSlots.channel,
      format: esquema.planSlots.format,
      pillar: esquema.planSlots.pillar,
      angle: esquema.planSlots.angle,
      sourceSlotId: esquema.planSlots.sourceSlotId,
    })
    .from(esquema.planSlots)
    .innerJoin(esquema.contentPlans, eq(esquema.planSlots.contentPlanId, esquema.contentPlans.id))
    .where(
      and(
        eq(esquema.contentPlans.brandId, ref.brandId),
        gte(esquema.planSlots.scheduledFor, desde),
        lt(esquema.planSlots.scheduledFor, hasta),
      ),
    )
    .orderBy(asc(esquema.planSlots.scheduledFor))

  return filas.map((f) => ({
    fecha: f.scheduledFor.toISOString().slice(0, 16).replace('T', ' '),
    canal: f.channel,
    formato: f.format,
    pilar: f.pillar,
    angulo: f.angle,
    derivado: f.sourceSlotId !== null,
  }))
}
```

- [ ] **Step 5: Ejecutar la prueba de humo y verificar que pasa**

```bash
pnpm --filter @gc/cli test
```

Esperado: PASA, 2 pruebas.

- [ ] **Step 6: Implementar el punto de entrada**

`apps/cli/src/entorno.ts`:

```ts
import { config } from 'dotenv'
import { fileURLToPath } from 'node:url'

// pnpm ejecuta el CLI con cwd en apps/cli; el .env vive en la raíz.
// Este módulo se importa primero para que las variables existan antes de que
// se evalúe cualquier otro módulo.
config({ path: fileURLToPath(new URL('../../../.env', import.meta.url)) })
```

`apps/cli/src/main.ts`:

```ts
import './entorno.js'
import { crearCliente } from '@gc/ai'
import { crearConexion } from '@gc/db'
import { parseArgs } from 'node:util'
import {
  cargarPerfilDeArchivo, crearMarca, generarEstrategia, generarGrilla, verGrilla,
} from './comandos.js'

const AYUDA = `
Uso: pnpm cli <comando> [opciones]

Comandos:
  marca:crear         --slug <slug> --nombre <nombre> [--presupuesto <usd>]
  perfil:cargar       --marca <slug> --archivo <ruta.json>
  estrategia:generar  --marca <slug> --periodo <2026-Q4>
  grilla:generar      --marca <slug> --mes <2026-09>
  grilla:ver          --marca <slug> --mes <2026-09>

Opción global:
  --seco              usa las muestras locales y no gasta tokens
`

async function principal(): Promise<void> {
  const { values, positionals } = parseArgs({
    allowPositionals: true,
    options: {
      slug: { type: 'string' },
      nombre: { type: 'string' },
      presupuesto: { type: 'string' },
      marca: { type: 'string' },
      archivo: { type: 'string' },
      periodo: { type: 'string' },
      mes: { type: 'string' },
      seco: { type: 'boolean', default: false },
    },
  })

  const comando = positionals[0]
  if (!comando) {
    console.log(AYUDA)
    return
  }

  const url = process.env.DATABASE_URL
  if (!url) throw new Error('Falta DATABASE_URL')

  const env = values.seco ? { ...process.env, IA_EN_SECO: 'true' } : process.env
  const { db, cerrar } = crearConexion(url)

  try {
    switch (comando) {
      case 'marca:crear': {
        const ref = await crearMarca(db, {
          slug: exigir(values.slug, '--slug'),
          nombre: exigir(values.nombre, '--nombre'),
          ...(values.presupuesto !== undefined ? { presupuesto: values.presupuesto } : {}),
        })
        console.log(`Marca creada: ${ref.brandId}`)
        break
      }
      case 'perfil:cargar': {
        const version = await cargarPerfilDeArchivo(db, {
          slug: exigir(values.marca, '--marca'),
          archivo: exigir(values.archivo, '--archivo'),
        })
        console.log(`Perfil guardado como versión ${version}`)
        break
      }
      case 'estrategia:generar': {
        const r = await generarEstrategia(db, crearCliente({ env }), {
          slug: exigir(values.marca, '--marca'),
          periodo: exigir(values.periodo, '--periodo'),
          env,
        })
        console.log(`Estrategia ${r.strategyId} generada en borrador`)
        break
      }
      case 'grilla:generar': {
        const r = await generarGrilla(db, crearCliente({ env }), {
          slug: exigir(values.marca, '--marca'),
          mes: exigir(values.mes, '--mes'),
          env,
        })
        console.log(`Grilla ${r.contentPlanId}: ${r.totalSlots} publicaciones`)
        for (const a of r.avisos) console.log(`  aviso [${a.regla}] ${a.detalle}`)
        break
      }
      case 'grilla:ver': {
        const filas = await verGrilla(db, {
          slug: exigir(values.marca, '--marca'),
          mes: exigir(values.mes, '--mes'),
        })
        console.table(filas)
        break
      }
      default:
        console.log(AYUDA)
    }
  } finally {
    await cerrar()
  }
}

function exigir(valor: string | undefined, bandera: string): string {
  if (!valor) throw new Error(`Falta la opción obligatoria ${bandera}`)
  return valor
}

await principal()
```

- [ ] **Step 7: Verificar el flujo real en seco**

```bash
docker compose up -d
```

```bash
pnpm --filter @gc/db migraciones:aplicar
```

```bash
pnpm cli marca:crear --slug parcelas --nombre "Compra Tu Parcela"
```

Esperado: `Marca creada: <uuid>`.

Guardar el perfil de ejemplo en `perfiles/parcelas.json` (copiar el objeto de `packages/brand/src/perfil.fixture.ts` como JSON) y ejecutar:

```bash
pnpm cli perfil:cargar --marca parcelas --archivo perfiles/parcelas.json
```

Esperado: `Perfil guardado como versión 1`.

```bash
pnpm cli estrategia:generar --marca parcelas --periodo 2026-Q3 --seco
```

Esperado: `Estrategia <uuid> generada en borrador`.

```bash
pnpm cli grilla:generar --marca parcelas --mes 2026-09 --seco
```

Esperado: `Grilla <uuid>: 12 publicaciones` seguido de los avisos de cadencia.

```bash
pnpm cli grilla:ver --marca parcelas --mes 2026-09
```

Esperado: una tabla de 12 filas ordenada por fecha, con 8 marcadas como `derivado: true`.

- [ ] **Step 8: Ejecutar la suite completa**

```bash
pnpm test && pnpm typecheck
```

Esperado: PASA todo — 7 paquetes, 74 pruebas.

- [ ] **Step 9: Commit**

```bash
git add -A && git commit -m "feat: CLI de operación y prueba de humo de punta a punta"
```

---

## Cobertura de la especificación

Qué sección del diseño implementa cada tarea, y qué queda explícitamente fuera de este plan.

| Sección del spec | Tarea | Estado |
|---|---|---|
| §3 Arquitectura — módulos | 1–11 | Cubierto salvo `core/assets`, `core/publish`, `core/metrics`, `core/notify` (Fases 2–4) |
| §3 Regla estructural (nada largo en Vercel) | — | No aplica: este plan no despliega |
| §4 Modelo de datos | 2 | 11 tablas del subconjunto de Fases 0–1. `content_pieces`, `content_revisions`, `assets`, `publications`, `metric_snapshots` llegan con la Fase 2 |
| §4 `plan_slot.source_slot_id` | 2, 9, 10 | Cubierto |
| §4 Secretos en Secret Manager | 2 | Cubierto a nivel de esquema (`secret_ref`); la integración real llega en la Fase 3 |
| §5 P1 Estrategia | 8 | Cubierto |
| §5 P2 Grilla (contexto, proponer, validar, derivados) | 9, 10 | Cubierto |
| §5 P3–P6 | — | Fases 2–4 |
| §5 Invariantes: idempotencia, aislamiento, transiciones | 6 | Cubierto |
| §5 Invariante: clave de idempotencia al publicar | — | Fase 3 |
| §5 Cortacircuitos por canal | — | Fase 3 |
| §5 Nodos agénticos | — | Fase 5, por diseño |
| §6 Interfaz única `ejecutarTarea` | 4 | Cubierto |
| §6 Registro de tareas por nivel | 3, 8, 10 | Cubierto para las tareas de nivel razonamiento; las de redacción y utilitario llegan con la Fase 2 |
| §6 Salidas estructuradas con un reintento de reparación | 4 | Cubierto |
| §6 Ensamblaje de prompts en 5 capas | 7, 8, 10 | Capas 1, 2, 3 y 5. La capa 4 (ejemplos) requiere `content_revisions`: Fase 2 |
| §6 Reproducibilidad y costos | 5 | Cubierto |
| §6 Presupuesto por marca con corte | 5, 8, 10 | Cubierto |
| §6 Evaluaciones (casos dorados) | — | Fase 0 tardía; requiere las tareas de redacción para ser útil. Las muestras de `ClienteDeMuestra` son la semilla del set |
| §6 Imágenes | — | Fase 2 |
| §7 Publicación | — | Fase 3 |
| §8 Métricas | — | Fase 4 |
| §9 Taxonomía de errores | 1, 6 | Cubierto |
| §9 Degradación: presupuesto agotado → manual | 5 | Cubierto como error permanente que escala; la cola manual requiere UI (plan siguiente) |
| §9 Alertas y latido | — | Plan siguiente, junto con `core/notify` |
| §10 Pruebas unitarias y de idempotencia | 1–11 | Cubierto |
| §10 Marcha en seco | 4, 11 | Cubierto como `IA_EN_SECO` + `ClienteDeMuestra` |
| §10 Pruebas de contrato de conectores | — | Fase 3 |

---

## Siguiente plan

`docs/superpowers/plans/<fecha>-interfaz-y-despliegue.md` — app Next.js (calendario editorial, carga de perfiles, aprobación de grilla), worker en Cloud Run, Cloud Scheduler, y despliegue a Vercel + Google Cloud. Reutiliza las funciones de `apps/cli/src/comandos.ts` sin reescribirlas.
