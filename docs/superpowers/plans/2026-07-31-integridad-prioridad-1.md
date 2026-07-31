# Integridad Prioridad 1 — Plan de implementación

> **Para trabajadores agénticos:** SUB-SKILL REQUERIDA: usa `superpowers:subagent-driven-development` (recomendado) o `superpowers:executing-plans` para implementar este plan tarea por tarea. Los pasos usan sintaxis de casilla (`- [ ]`) para seguimiento.

**Goal:** Cerrar los tres defectos de integridad de Prioridad 1: los errores de Postgres entran a la taxonomía de reintentos, la base impide filas cuya organización no coincida con la de su padre, y P2 exige la estrategia del trimestre que corresponde al mes.

**Architecture:** Un cambio en `@gc/shared` cubre la clasificación de errores de todo el repositorio sin envolver llamadas. Dos migraciones en `@gc/db`: una de restricciones sin datos, otra que agrega `slug` a `organizations` con relleno. El CLI pasa a resolver la organización explícitamente y a propagarla a cada comando. `@gc/strategy` gana un módulo de periodos y una selección estricta.

**Tech Stack:** TypeScript 5 (ESM), Node 22+, pnpm workspaces, PostgreSQL 16, Drizzle ORM, Zod v3, Vitest.

**Spec:** [2026-07-31-prioridad-1-integridad-design.md](../specs/2026-07-31-prioridad-1-integridad-design.md)

## Global Constraints

- Node 22+; todos los paquetes son ESM (`"type": "module"`).
- **Idioma:** esquema y columnas en inglés `snake_case`; API de dominio, variables, comentarios y mensajes al usuario en **español**.
- **Un solo `.env`, en la raíz.** Las pruebas lo cargan con `setupFiles: ['../../vitest.setup.ts']`.
- **Ejecutar la suite completa con `pnpm test` desde la raíz**, nunca `pnpm -r test` — los paquetes comparten la base de pruebas y el script de la raíz los serializa. Un paquete suelto: `pnpm --filter @gc/<nombre> test`.
- **Los tipos enumerados del esquema se hacen cumplir en Postgres con `CHECK`**, mediante el helper `chequeoEnum` existente.
- **Toda tabla lleva `organization_id`.**
- Todos los identificadores son UUID generados por la base; todas las marcas de tiempo son `timestamptz` en UTC.
- **Ningún error del modelo se parsea con expresiones regulares.** Validar entrada de usuario con regex sí es válido.
- **Estado inicial: 117 pruebas en verde, 7 paquetes, `pnpm -r typecheck` limpio.** Ninguna tarea puede terminar con menos de las que había.
- TDD estricto: ninguna implementación antes de tener su prueba fallando y haberla visto fallar.
- Commits en español con prefijo convencional (`feat:`, `fix:`, `test:`, `chore:`).

---

### Task 1: Los errores de Postgres entran a la taxonomía

**Files:**
- Modify: `packages/shared/src/errores.ts`
- Test: `packages/shared/src/errores.test.ts`
- Test: `packages/pipeline/src/motor.test.ts`

**Interfaces:**
- Consumes: `ClaseDeError`, `ErrorDeDominio`, `esTransitorio` (ya existen)
- Produces: `clasificarPostgres(codigo: string): ClaseDeError`, `clasificarError(e: unknown): ClaseDeError`. `esTransitorio` pasa a delegar en `clasificarError` y **cambia de comportamiento**: ahora devuelve `true` para errores de Postgres transitorios. Las Tasks 2–5 no lo usan directamente, pero el motor de pipeline sí.

- [ ] **Step 1: Escribir las pruebas unitarias que fallan**

Agregar al final de `packages/shared/src/errores.test.ts`:

```ts
describe('clasificarPostgres', () => {
  it.each([
    ['40001', 'transitorio'],
    ['40P01', 'transitorio'],
    ['08000', 'transitorio'],
    ['08003', 'transitorio'],
    ['08006', 'transitorio'],
    ['08001', 'transitorio'],
    ['08004', 'transitorio'],
    ['53300', 'transitorio'],
    ['55P03', 'transitorio'],
    ['57P01', 'transitorio'],
    ['57014', 'transitorio'],
    ['23505', 'permanente'],
    ['23503', 'permanente'],
    ['23514', 'permanente'],
    ['22007', 'permanente'],
    ['42601', 'permanente'],
    ['', 'permanente'],
  ])('clasifica el código %s como %s', (codigo, esperado) => {
    expect(clasificarPostgres(codigo)).toBe(esperado)
  })

  it('no clasifica por familia: 08999 no es transitorio solo por empezar con 08', () => {
    expect(clasificarPostgres('08999')).toBe('permanente')
  })
})

describe('clasificarError', () => {
  it('respeta la clase de un ErrorDeDominio', () => {
    expect(clasificarError(transitorio('x'))).toBe('transitorio')
    expect(clasificarError(permanente('x'))).toBe('permanente')
    expect(clasificarError(ambiguo('x'))).toBe('ambiguo')
  })

  it('clasifica un error de Postgres por su código', () => {
    const deadlock = Object.assign(new Error('deadlock detected'), { code: '40P01' })
    expect(clasificarError(deadlock)).toBe('transitorio')

    const duplicado = Object.assign(new Error('duplicate key'), { code: '23505' })
    expect(clasificarError(duplicado)).toBe('permanente')
  })

  it('trata como permanente cualquier otra cosa', () => {
    expect(clasificarError(new Error('cualquiera'))).toBe('permanente')
    expect(clasificarError(new TypeError('bug'))).toBe('permanente')
    expect(clasificarError('texto suelto')).toBe('permanente')
    expect(clasificarError(null)).toBe('permanente')
    expect(clasificarError({ code: 42 })).toBe('permanente')
  })

  it('esTransitorio delega en clasificarError', () => {
    const serializacion = Object.assign(new Error('could not serialize'), { code: '40001' })
    expect(esTransitorio(serializacion)).toBe(true)
    expect(esTransitorio(new Error('bug'))).toBe(false)
  })
})
```

Agregar `ambiguo`, `clasificarPostgres` y `clasificarError` a los imports del archivo.

- [ ] **Step 2: Ejecutar y verificar que falla**

```bash
pnpm --filter @gc/shared test
```

Esperado: FALLA con `clasificarPostgres is not a function` (o error de importación no resuelta).

- [ ] **Step 3: Implementar**

Reemplazar `esTransitorio` en `packages/shared/src/errores.ts` y agregar lo nuevo:

```ts
/**
 * Códigos SQLSTATE que ameritan reintento. La lista es explícita a propósito:
 * clasificar por familia (`08*`) arrastraría códigos futuros por accidente.
 */
const CODIGOS_TRANSITORIOS = new Set([
  '40001', // fallo de serialización
  '40P01', // deadlock detectado
  '08000', // excepción de conexión
  '08003', // conexión inexistente
  '08006', // fallo de conexión
  '08001', // el cliente no pudo establecer la conexión
  '08004', // el servidor rechazó la conexión
  '53300', // demasiadas conexiones
  '55P03', // lock no disponible
  '57P01', // apagado administrativo
  '57014', // consulta cancelada
])

export function clasificarPostgres(codigo: string): ClaseDeError {
  return CODIGOS_TRANSITORIOS.has(codigo) ? 'transitorio' : 'permanente'
}

/**
 * Único punto de clasificación del sistema. El motor de pipeline decide aquí
 * si reintentar, así que cubrir este camino cubre toda llamada a la base del
 * repositorio, incluidas las que se escriban después.
 *
 * Lo desconocido se trata como permanente a propósito: un TypeError es un bug,
 * y reintentar un bug solo lo repite.
 */
export function clasificarError(e: unknown): ClaseDeError {
  if (e instanceof ErrorDeDominio) return e.clase

  if (typeof e === 'object' && e !== null && 'code' in e) {
    const codigo = (e as { code: unknown }).code
    if (typeof codigo === 'string') return clasificarPostgres(codigo)
  }

  return 'permanente'
}

export function esTransitorio(e: unknown): boolean {
  return clasificarError(e) === 'transitorio'
}
```

- [ ] **Step 4: Ejecutar y verificar que pasa**

```bash
pnpm --filter @gc/shared test
```

Esperado: PASA. El archivo pasa de 10 a 32 pruebas.

- [ ] **Step 5: Escribir la prueba de integración con el motor**

Esta es la que prueba que el cambio sirve para algo. Agregar a `packages/pipeline/src/motor.test.ts`, dentro del `describe('ejecutarFlujo', ...)`:

```ts
  it('reintenta un fallo de serialización de Postgres y no una violación de única', async () => {
    await conBaseDeDatosDePrueba(async (db) => {
      const organizationId = await sembrarOrg(db)

      const contar = async (codigo: string, maxIntentos: number) => {
        let llamadas = 0
        const flujo = {
          nombre: 'prueba',
          pasos: [
            definirPaso<unknown, unknown>({
              nombre: `falla_${codigo}`,
              ejecutar: async () => {
                llamadas++
                throw Object.assign(new Error(`error ${codigo}`), { code: codigo })
              },
            }),
          ],
        }
        await ejecutarFlujo(db, flujo, {}, { organizationId }, {
          ...SIN_ESPERA, maxIntentos,
        }).catch(() => {})
        return llamadas
      }

      // 40001 es transitorio: se agota el presupuesto de intentos.
      expect(await contar('40001', 3)).toBe(3)
      // 23505 es una violación de única: no tiene sentido reintentarla.
      expect(await contar('23505', 3)).toBe(1)
    })
  })
```

- [ ] **Step 6: Ejecutar y verificar que pasa**

```bash
pnpm --filter @gc/pipeline test motor
```

Esperado: PASA. Sin el cambio de la Step 3 esta prueba daría `1` en el primer caso.

> Verifica que efectivamente falle antes del cambio: si `git stash` sobre `errores.ts` no la pone en rojo, la prueba no está midiendo lo que dice.

- [ ] **Step 7: Suite completa y commit**

```bash
pnpm test && pnpm -r typecheck
```

```bash
git add -A && git commit -m "feat: clasificar los errores de Postgres dentro de la taxonomía de reintentos"
```

---

### Task 2: Migración de integridad multi-tenant

**Files:**
- Modify: `packages/db/src/esquema.ts`
- Create: `packages/db/migraciones/0001_*.sql` (generada)
- Test: `packages/db/src/esquema.test.ts`

**Interfaces:**
- Consumes: el `esquema` existente
- Produces: ningún símbolo nuevo. Cambia el contrato de la base: las tablas hijas rechazan un `organization_id` que no coincida con el de su padre.

- [ ] **Step 1: Escribir las pruebas que fallan**

Agregar a `packages/db/src/esquema.test.ts`:

```ts
  it('rechaza una hija de marca cuya organización no coincide', async () => {
    await conBaseDeDatosDePrueba(async (db) => {
      const [orgA] = await db.insert(esquema.organizations).values({ name: 'A' }).returning()
      const [orgB] = await db.insert(esquema.organizations).values({ name: 'B' }).returning()
      const [marca] = await db
        .insert(esquema.brands)
        .values({ organizationId: orgA!.id, slug: 'a', name: 'A' })
        .returning()

      // La marca es de orgA; el perfil dice ser de orgB.
      await expect(
        db.insert(esquema.brandProfiles).values({
          organizationId: orgB!.id,
          brandId: marca!.id,
          version: 1,
          data: {},
        }),
      ).rejects.toThrow()
    })
  })

  it('rechaza un slot cuya organización no coincide con la de su plan', async () => {
    await conBaseDeDatosDePrueba(async (db) => {
      const [orgA] = await db.insert(esquema.organizations).values({ name: 'A' }).returning()
      const [orgB] = await db.insert(esquema.organizations).values({ name: 'B' }).returning()
      const [marca] = await db
        .insert(esquema.brands)
        .values({ organizationId: orgA!.id, slug: 'a', name: 'A' })
        .returning()
      const [plan] = await db
        .insert(esquema.contentPlans)
        .values({ organizationId: orgA!.id, brandId: marca!.id, month: '2026-09-01' })
        .returning()

      await expect(
        db.insert(esquema.planSlots).values({
          organizationId: orgB!.id,
          contentPlanId: plan!.id,
          scheduledFor: new Date('2026-09-03T13:00:00Z'),
          channel: 'blog',
          format: 'articulo',
          pillar: 'educacion',
          angle: 'x',
          brief: 'Un brief suficientemente largo para pasar la validación.',
        }),
      ).rejects.toThrow()
    })
  })

  it('rechaza un derivado que apunta a un slot de otra organización', async () => {
    await conBaseDeDatosDePrueba(async (db) => {
      const [orgA] = await db.insert(esquema.organizations).values({ name: 'A' }).returning()
      const [orgB] = await db.insert(esquema.organizations).values({ name: 'B' }).returning()

      const crearSlot = async (orgId: string, slug: string) => {
        const [marca] = await db
          .insert(esquema.brands)
          .values({ organizationId: orgId, slug, name: slug })
          .returning()
        const [plan] = await db
          .insert(esquema.contentPlans)
          .values({ organizationId: orgId, brandId: marca!.id, month: '2026-09-01' })
          .returning()
        const [slot] = await db
          .insert(esquema.planSlots)
          .values({
            organizationId: orgId,
            contentPlanId: plan!.id,
            scheduledFor: new Date('2026-09-03T13:00:00Z'),
            channel: 'blog',
            format: 'articulo',
            pillar: 'educacion',
            angle: 'x',
            brief: 'Un brief suficientemente largo para pasar la validación.',
          })
          .returning()
        return { planId: plan!.id, slotId: slot!.id }
      }

      const a = await crearSlot(orgA!.id, 'a')
      const b = await crearSlot(orgB!.id, 'b')

      // Un slot de orgB no puede colgar de un padre de orgA.
      await expect(
        db.insert(esquema.planSlots).values({
          organizationId: orgB!.id,
          contentPlanId: b.planId,
          sourceSlotId: a.slotId,
          scheduledFor: new Date('2026-09-05T13:00:00Z'),
          channel: 'linkedin',
          format: 'derivado',
          pillar: 'educacion',
          angle: 'x',
          brief: 'Un brief suficientemente largo para pasar la validación.',
        }),
      ).rejects.toThrow()
    })
  })

  it('acepta las filas cuya organización sí coincide', async () => {
    await conBaseDeDatosDePrueba(async (db) => {
      const [org] = await db.insert(esquema.organizations).values({ name: 'A' }).returning()
      const [marca] = await db
        .insert(esquema.brands)
        .values({ organizationId: org!.id, slug: 'a', name: 'A' })
        .returning()
      const [plan] = await db
        .insert(esquema.contentPlans)
        .values({ organizationId: org!.id, brandId: marca!.id, month: '2026-09-01' })
        .returning()
      const [padre] = await db
        .insert(esquema.planSlots)
        .values({
          organizationId: org!.id,
          contentPlanId: plan!.id,
          scheduledFor: new Date('2026-09-03T13:00:00Z'),
          channel: 'blog',
          format: 'articulo',
          pillar: 'educacion',
          angle: 'x',
          brief: 'Un brief suficientemente largo para pasar la validación.',
        })
        .returning()

      await db.insert(esquema.planSlots).values({
        organizationId: org!.id,
        contentPlanId: plan!.id,
        sourceSlotId: padre!.id,
        scheduledFor: new Date('2026-09-05T13:00:00Z'),
        channel: 'linkedin',
        format: 'derivado',
        pillar: 'educacion',
        angle: 'x',
        brief: 'Un brief suficientemente largo para pasar la validación.',
      })

      expect(await db.select().from(esquema.planSlots)).toHaveLength(2)
    })
  })
```

- [ ] **Step 2: Ejecutar y verificar que falla**

```bash
pnpm --filter @gc/db test
```

Esperado: FALLAN las tres primeras (`rejects.toThrow()` no se cumple: hoy la base **acepta** esas filas). La cuarta pasa desde ya — es el control de que la migración no rompe el camino feliz.

- [ ] **Step 3: Declarar las restricciones en el esquema**

En `packages/db/src/esquema.ts`, importar `foreignKey` desde `drizzle-orm/pg-core` y aplicar el patrón siguiente. **Al pasar a clave compuesta hay que quitar el `.references()` de la columna**, o quedan las dos.

En `brands`, agregar la única que sirve de destino:

```ts
}, (t) => ({
  slugPorOrg: unique().on(t.organizationId, t.slug),
  idPorOrg: unique('brands_id_organization_id_unique').on(t.id, t.organizationId),
}))
```

Lo mismo (`idPorOrg`) en `contentPlans`, `pipelineRuns` y `planSlots`, con el nombre `<tabla>_id_organization_id_unique`.

Para cada hija, quitar `.references(...)` de la columna padre y declarar:

```ts
}, (t) => ({
  // ...restricciones existentes...
  marcaPorOrg: foreignKey({
    columns: [t.brandId, t.organizationId],
    foreignColumns: [brands.id, brands.organizationId],
    name: 'brand_profiles_brand_org_fk',
  }).onDelete('cascade'),
}))
```

Tabla por tabla:

| Tabla | Columnas | Destino | Nombre |
|---|---|---|---|
| `brandProfiles` | `brandId, organizationId` | `brands` | `brand_profiles_brand_org_fk` |
| `channelAccounts` | `brandId, organizationId` | `brands` | `channel_accounts_brand_org_fk` |
| `approvalPolicies` | `brandId, organizationId` | `brands` | `approval_policies_brand_org_fk` |
| `strategies` | `brandId, organizationId` | `brands` | `strategies_brand_org_fk` |
| `contentPlans` | `brandId, organizationId` | `brands` | `content_plans_brand_org_fk` |
| `pipelineRuns` | `brandId, organizationId` | `brands` | `pipeline_runs_brand_org_fk` |
| `aiCalls` | `brandId, organizationId` | `brands` | `ai_calls_brand_org_fk` |
| `aiCalls` | `runId, organizationId` | `pipelineRuns` | `ai_calls_run_org_fk` |
| `planSlots` | `contentPlanId, organizationId` | `contentPlans` | `plan_slots_plan_org_fk` |
| `planSlots` | `sourceSlotId, organizationId` | `planSlots` (auto) | `plan_slots_source_org_fk` |
| `pipelineSteps` | `runId, organizationId` | `pipelineRuns` | `pipeline_steps_run_org_fk` |
| `contentPlans` | `strategyId, organizationId` | `strategies` | `content_plans_strategy_org_fk` |

> `strategies` necesita entonces su propia única `(id, organization_id)`: son cinco únicas y doce compuestas, no cuatro y once. Esta última se omitió en la primera redacción del plan y la detectó la revisión: sin ella, un `content_plan` de una organización puede apuntar a la estrategia de otra, y cualquier lectura que haga join plan → estrategia sirve datos de la organización equivocada.

Notas que importan:

- Las que hoy usan `onDelete: 'set null'` (`contentPlans.strategyId`, `aiCalls.runId`) conservan esa semántica; las demás, `cascade`.
- **`ai_calls_run_org_fk` es la excepción y necesita edición manual.** Postgres anula *todas* las columnas de una clave compuesta con `SET NULL`, incluida `organization_id`, que es `NOT NULL`: borrar una corrida con llamadas asociadas fallaría con `23502` en vez de conservar el registro de gasto. El registro de costos debe sobrevivir a la corrida — es lo que suma la guardia de presupuesto. Se usa la sintaxis de Postgres 15+ que anula una sola columna, que drizzle-kit 0.28 no sabe generar:

  ```sql
  ALTER TABLE "ai_calls" ADD CONSTRAINT "ai_calls_run_org_fk"
    FOREIGN KEY ("run_id","organization_id") REFERENCES "pipeline_runs"("id","organization_id")
    ON DELETE SET NULL ("run_id");
  ```

  El esquema de Drizzle declara `.onDelete('set null')` a secas, así que el SQL diverge del esquema en este único punto. Va comentado en `esquema.ts` para que la próxima migración generada no lo revierta por descuido.
- **El orden de los statements importa:** drizzle-kit emite las claves foráneas antes que las restricciones únicas a las que apuntan, y la migración aborta con `there is no unique constraint matching given keys`. Mover las cuatro `UNIQUE` arriba del bloque de claves foráneas, sin cambiar ningún statement.
- `planSlots.sourceSlotId` **hoy no tiene clave foránea alguna** — se declaró como un `uuid` suelto. Esta compuesta le da integridad referencial que nunca tuvo. Usa `onDelete('cascade')`.
- La autorreferencia de `planSlots` se declara dentro de su propio callback de configuración usando `[t.id, t.organizationId]` como `foreignColumns`. Si drizzle-kit no la genera correctamente, **detente y repórtalo** en vez de improvisar un rodeo.
- Las columnas nullable (`brandId` en `pipelineRuns` y `aiCalls`, `runId` en `aiCalls`, `sourceSlotId` en `planSlots`) no requieren nada especial: Postgres no exige la clave cuando hay `NULL`.

- [ ] **Step 4: Generar la migración y revisarla a mano**

```bash
pnpm --filter @gc/db migraciones:generar
```

Abrir el `.sql` generado y verificar, columna por columna:

1. Que cada `ALTER TABLE ... DROP CONSTRAINT` de una FK simple tenga su `ADD CONSTRAINT` compuesto correspondiente.
2. Que las cuatro restricciones únicas `(id, organization_id)` existan.
3. Que no aparezca ningún `DROP TABLE` ni `DROP COLUMN`.
4. Que las once claves foráneas de la tabla de arriba estén todas presentes, con el `ON DELETE` correcto.

**Si algo no calza con lo esperado, detente y repórtalo.** Este es el riesgo que el spec identifica como principal.

- [ ] **Step 5: Aplicar y ejecutar las pruebas**

```bash
pnpm --filter @gc/db migraciones:aplicar
```

```bash
pnpm --filter @gc/db test
```

Esperado: PASAN las cuatro. `@gc/db` pasa de 8 a 12 pruebas.

- [ ] **Step 6: Suite completa y commit**

```bash
pnpm test && pnpm -r typecheck
```

Si alguna prueba de otro paquete se pone roja aquí, es señal de que sembraba datos con organizaciones inconsistentes — arréglala en el fixture, no relajando la restricción.

```bash
git add -A && git commit -m "feat: claves foráneas compuestas que hacen exigible la multi-tenencia"
```

---

### Task 3: `slug` en `organizations`

**Files:**
- Modify: `packages/db/src/esquema.ts`
- Create: `packages/db/migraciones/0002_*.sql` (generada y **editada a mano**)
- Test: `packages/db/src/esquema.test.ts`

**Interfaces:**
- Produces: `organizations.slug`, `text NOT NULL UNIQUE`. La Task 4 lo usa para nombrar una organización sin pedir un UUID.

- [ ] **Step 1: Escribir las pruebas que fallan**

Agregar a `packages/db/src/esquema.test.ts`:

```ts
  it('exige slug único en organizations', async () => {
    await conBaseDeDatosDePrueba(async (db) => {
      await db.insert(esquema.organizations).values({ name: 'A', slug: 'a' })

      await expect(
        db.insert(esquema.organizations).values({ name: 'Otra', slug: 'a' }),
      ).rejects.toThrow()
    })
  })

  it('no acepta una organización sin slug', async () => {
    await conBaseDeDatosDePrueba(async (db) => {
      await expect(
        db.insert(esquema.organizations).values({ name: 'Sin slug' } as never),
      ).rejects.toThrow()
    })
  })
```

Las pruebas existentes de otras tablas insertan organizaciones sin `slug` — actualízalas para que lo incluyan. Usa slugs distintos por prueba (`'a'`, `'b'`, …) para no chocar con la nueva restricción única.

- [ ] **Step 2: Ejecutar y verificar que falla**

```bash
pnpm --filter @gc/db test
```

Esperado: FALLA con error de tipos y/o `column "slug" does not exist`.

- [ ] **Step 3: Declarar la columna**

En `packages/db/src/esquema.ts`:

```ts
export const organizations = pgTable('organizations', {
  id: id(),
  name: text('name').notNull(),
  slug: text('slug').notNull().unique(),
  createdAt: creadoEn(),
})
```

- [ ] **Step 4: Generar la migración y convertirla en tres pasos**

```bash
pnpm --filter @gc/db migraciones:generar
```

drizzle-kit va a producir un `ADD COLUMN "slug" text NOT NULL`, que **falla contra la base local** porque ya tiene una fila. Edita el `.sql` generado y reemplaza ese statement por:

```sql
ALTER TABLE "organizations" ADD COLUMN "slug" text;
--> statement-breakpoint
UPDATE "organizations" SET "slug" = 'principal'
  WHERE "id" = (SELECT "id" FROM "organizations" ORDER BY "created_at" LIMIT 1);
--> statement-breakpoint
UPDATE "organizations" SET "slug" = 'org-' || left(replace("id"::text, '-', ''), 8)
  WHERE "slug" IS NULL;
--> statement-breakpoint
ALTER TABLE "organizations" ALTER COLUMN "slug" SET NOT NULL;
```

Deja intacto el `ADD CONSTRAINT ... UNIQUE("slug")` que drizzle-kit haya generado; si no lo generó, agrégalo al final.

El segundo `UPDATE` existe para el caso de más de una organización preexistente: sin él todas quedarían con `'principal'` y la única fallaría. Es defensivo, no decorativo.

- [ ] **Step 5: Aplicar y verificar el relleno**

```bash
pnpm --filter @gc/db migraciones:aplicar
```

```bash
docker compose exec postgres psql -U postgres -d gestor -c "SELECT id, name, slug FROM organizations"
```

Esperado: la organización existente aparece con `slug = principal`. **Reporta la salida literal** — es el único punto de este plan que toca datos preexistentes.

- [ ] **Step 6: Ejecutar las pruebas**

```bash
pnpm --filter @gc/db test
```

Esperado: PASA. `@gc/db` pasa de 12 a 14 pruebas.

- [ ] **Step 7: Suite completa y commit**

```bash
pnpm test && pnpm -r typecheck
```

```bash
git add -A && git commit -m "feat: slug único en organizations con relleno de las existentes"
```

---

### Task 4: El CLI resuelve la organización explícitamente

**Files:**
- Modify: `apps/cli/src/comandos.ts`
- Modify: `apps/cli/src/main.ts`
- Modify: `apps/cli/src/humo.test.ts`
- Create: `apps/cli/src/organizacion.test.ts`

**Interfaces:**
- Consumes: `organizations.slug` (Task 3); `clasificarError` no se usa aquí — la detección de la violación de única es local
- Produces:
  - `resolverOrganizacion(db, opciones?: { org?: string; env?: Record<string, string | undefined> }): Promise<string>`
  - Todas las funciones de comando cambian de firma para recibir `organizationId` como segundo parámetro (tercero en las que llevan `cliente`): `crearMarca(db, organizationId, args)`, `cargarPerfilDeObjeto(db, organizationId, args)`, `cargarPerfilDeArchivo(db, organizationId, args)`, `generarEstrategia(db, cliente, organizationId, args)`, `generarGrilla(db, cliente, organizationId, args)`, `verGrilla(db, organizationId, args)`

- [ ] **Step 1: Escribir las pruebas que fallan**

`apps/cli/src/organizacion.test.ts`:

```ts
import { esquema } from '@gc/db'
import { conBaseDeDatosDePrueba } from '@gc/db/pruebas'
import { describe, expect, it } from 'vitest'
import { crearMarca, resolverOrganizacion } from './comandos.js'

const SIN_ENV = {}

describe('resolverOrganizacion', () => {
  it('crea la organización por defecto cuando no hay ninguna', async () => {
    await conBaseDeDatosDePrueba(async (db) => {
      const id = await resolverOrganizacion(db, { env: SIN_ENV })

      const [org] = await db.select().from(esquema.organizations)
      expect(org!.id).toBe(id)
      expect(org!.slug).toBe('principal')
    })
  })

  it('usa la única organización que exista', async () => {
    await conBaseDeDatosDePrueba(async (db) => {
      const [org] = await db
        .insert(esquema.organizations)
        .values({ name: 'Sola', slug: 'sola' })
        .returning()

      expect(await resolverOrganizacion(db, { env: SIN_ENV })).toBe(org!.id)
    })
  })

  it('falla listando los slugs cuando hay varias y no se indicó cuál', async () => {
    await conBaseDeDatosDePrueba(async (db) => {
      await db.insert(esquema.organizations).values([
        { name: 'A', slug: 'alfa' },
        { name: 'B', slug: 'beta' },
      ])

      const error = await resolverOrganizacion(db, { env: SIN_ENV }).catch((e: unknown) => e)

      expect(error).toMatchObject({ clase: 'permanente' })
      expect((error as Error).message).toContain('alfa')
      expect((error as Error).message).toContain('beta')
    })
  })

  it('la bandera desempata', async () => {
    await conBaseDeDatosDePrueba(async (db) => {
      const filas = await db
        .insert(esquema.organizations)
        .values([{ name: 'A', slug: 'alfa' }, { name: 'B', slug: 'beta' }])
        .returning()
      const beta = filas.find((o) => o.slug === 'beta')!

      expect(await resolverOrganizacion(db, { org: 'beta', env: SIN_ENV })).toBe(beta.id)
    })
  })

  it('la variable de entorno desempata cuando no hay bandera', async () => {
    await conBaseDeDatosDePrueba(async (db) => {
      const filas = await db
        .insert(esquema.organizations)
        .values([{ name: 'A', slug: 'alfa' }, { name: 'B', slug: 'beta' }])
        .returning()
      const alfa = filas.find((o) => o.slug === 'alfa')!

      expect(await resolverOrganizacion(db, { env: { ORGANIZACION: 'alfa' } })).toBe(alfa.id)
    })
  })

  it('la bandera gana sobre la variable de entorno', async () => {
    await conBaseDeDatosDePrueba(async (db) => {
      const filas = await db
        .insert(esquema.organizations)
        .values([{ name: 'A', slug: 'alfa' }, { name: 'B', slug: 'beta' }])
        .returning()
      const beta = filas.find((o) => o.slug === 'beta')!

      expect(
        await resolverOrganizacion(db, { org: 'beta', env: { ORGANIZACION: 'alfa' } }),
      ).toBe(beta.id)
    })
  })

  it('falla si la organización pedida no existe', async () => {
    await conBaseDeDatosDePrueba(async (db) => {
      await db.insert(esquema.organizations).values({ name: 'A', slug: 'alfa' })

      await expect(
        resolverOrganizacion(db, { org: 'inventada', env: SIN_ENV }),
      ).rejects.toMatchObject({ clase: 'permanente' })
    })
  })
})

describe('marcas por organización', () => {
  it('dos organizaciones pueden tener el mismo slug de marca', async () => {
    await conBaseDeDatosDePrueba(async (db) => {
      const filas = await db
        .insert(esquema.organizations)
        .values([{ name: 'A', slug: 'alfa' }, { name: 'B', slug: 'beta' }])
        .returning()
      const alfa = filas.find((o) => o.slug === 'alfa')!
      const beta = filas.find((o) => o.slug === 'beta')!

      const enAlfa = await crearMarca(db, alfa.id, { slug: 'parcelas', nombre: 'En alfa' })
      const enBeta = await crearMarca(db, beta.id, { slug: 'parcelas', nombre: 'En beta' })

      expect(enAlfa.brandId).not.toBe(enBeta.brandId)
      expect(enAlfa.organizationId).toBe(alfa.id)
      expect(enBeta.organizationId).toBe(beta.id)
    })
  })

  it('un slug repetido dentro de la misma organización da un error legible', async () => {
    await conBaseDeDatosDePrueba(async (db) => {
      const [org] = await db
        .insert(esquema.organizations)
        .values({ name: 'A', slug: 'alfa' })
        .returning()

      await crearMarca(db, org!.id, { slug: 'parcelas', nombre: 'Primera' })

      const error = await crearMarca(db, org!.id, { slug: 'parcelas', nombre: 'Segunda' })
        .catch((e: unknown) => e)

      expect(error).toMatchObject({ clase: 'permanente' })
      expect((error as Error).message).toContain('parcelas')
    })
  })
})
```

- [ ] **Step 2: Ejecutar y verificar que falla**

```bash
pnpm --filter @gc/cli test organizacion
```

Esperado: FALLA con `resolverOrganizacion is not exported` y errores de aridad en `crearMarca`.

- [ ] **Step 3: Reescribir la resolución en `comandos.ts`**

Reemplazar `ORGANIZACION_POR_DEFECTO`, `asegurarOrganizacion` y `resolverMarca` por:

```ts
const ORGANIZACION_POR_DEFECTO = 'Principal'
const SLUG_POR_DEFECTO = 'principal'
const VIOLACION_DE_UNICA = '23505'

export interface OpcionesDeOrganizacion {
  org?: string
  env?: Record<string, string | undefined>
}

/**
 * Bandera, luego variable de entorno, luego la única que exista. Con varias y
 * sin indicación, falla listando los slugs: elegir en silencio es exactamente
 * el defecto que este trabajo viene a cerrar.
 */
export async function resolverOrganizacion(
  db: BaseDeDatos,
  opciones: OpcionesDeOrganizacion = {},
): Promise<string> {
  const env = opciones.env ?? process.env
  const pedido = opciones.org ?? env.ORGANIZACION

  if (pedido) {
    const [org] = await db
      .select({ id: esquema.organizations.id })
      .from(esquema.organizations)
      .where(eq(esquema.organizations.slug, pedido))
    if (!org) throw permanente(`No existe la organización "${pedido}"`)
    return org.id
  }

  const todas = await db
    .select({ id: esquema.organizations.id, slug: esquema.organizations.slug })
    .from(esquema.organizations)
    .orderBy(asc(esquema.organizations.createdAt))

  if (todas.length === 1) return todas[0]!.id

  if (todas.length === 0) {
    const [nueva] = await db
      .insert(esquema.organizations)
      .values({ name: ORGANIZACION_POR_DEFECTO, slug: SLUG_POR_DEFECTO })
      .returning({ id: esquema.organizations.id })
    return nueva!.id
  }

  throw permanente(
    `Hay ${todas.length} organizaciones y no indicaste cuál. Usa --org o la ` +
      `variable ORGANIZACION. Disponibles: ${todas.map((o) => o.slug).join(', ')}`,
  )
}

function esViolacionDeUnica(e: unknown): boolean {
  return (
    typeof e === 'object' &&
    e !== null &&
    (e as { code?: unknown }).code === VIOLACION_DE_UNICA
  )
}

async function resolverMarca(
  db: BaseDeDatos,
  organizationId: string,
  slug: string,
): Promise<ReferenciaResuelta> {
  const [marca] = await db
    .select()
    .from(esquema.brands)
    .where(
      and(
        eq(esquema.brands.organizationId, organizationId),
        eq(esquema.brands.slug, slug),
      ),
    )
  if (!marca) throw permanente(`No existe la marca "${slug}" en esta organización`)
  return { organizationId: marca.organizationId, brandId: marca.id }
}
```

- [ ] **Step 4: Propagar `organizationId` a los comandos**

`crearMarca` recibe la organización y traduce el choque de slug:

```ts
export async function crearMarca(
  db: BaseDeDatos,
  organizationId: string,
  args: { slug: string; nombre: string; presupuesto?: string },
): Promise<ReferenciaResuelta> {
  try {
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
  } catch (error) {
    if (esViolacionDeUnica(error)) {
      throw permanente(
        `Ya existe una marca con el slug "${args.slug}" en esta organización`,
        error,
      )
    }
    throw error
  }
}
```

Las demás cambian igual de mecánicamente: reciben `organizationId` y se lo pasan a `resolverMarca`. Por ejemplo:

```ts
export async function generarGrilla(
  db: BaseDeDatos,
  cliente: ClienteLlm,
  organizationId: string,
  args: { slug: string; mes: string; env?: Record<string, string | undefined> },
): Promise<SalidaP2> {
  const ref = await resolverMarca(db, organizationId, args.slug)
  const flujo = crearFlujoGrilla({
    cliente,
    ...(args.env !== undefined ? { env: args.env } : {}),
  })
  const r = await ejecutarFlujo(db, flujo, { brandId: ref.brandId, mes: args.mes }, ref)
  return r.salida as SalidaP2
}
```

Las cuatro restantes quedan exactamente así, sin más cambios que el parámetro y la llamada a `resolverMarca`:

```ts
cargarPerfilDeObjeto(db: BaseDeDatos, organizationId: string, args: { slug: string; perfil: unknown }): Promise<number>
cargarPerfilDeArchivo(db: BaseDeDatos, organizationId: string, args: { slug: string; archivo: string }): Promise<number>
generarEstrategia(db: BaseDeDatos, cliente: ClienteLlm, organizationId: string, args: { slug: string; periodo: string; env?: Record<string, string | undefined> }): Promise<SalidaP1>
verGrilla(db: BaseDeDatos, organizationId: string, args: { slug: string; mes: string }): Promise<FilaDeGrilla[]>
```

En `cargarPerfilDeArchivo`, `resolverMarca` ya lo hace `cargarPerfilDeObjeto`: solo propaga `organizationId`.

- [ ] **Step 5: Actualizar `main.ts`**

Agregar la opción a `parseArgs`:

```ts
      org: { type: 'string' },
```

Mover el atajo de ayuda **antes** de abrir la conexión, y resolver la organización una sola vez:

```ts
  const comando = positionals[0]
  if (!comando || !COMANDOS.has(comando)) {
    console.log(AYUDA)
    return
  }

  const url = process.env.DATABASE_URL
  if (!url) throw new Error('Falta DATABASE_URL')

  const env = values.seco ? { ...process.env, IA_EN_SECO: 'true' } : process.env
  // ...opcionesDeCliente igual que antes...
  const { db, cerrar } = crearConexion(url)

  try {
    const organizationId = await resolverOrganizacion(db, {
      ...(values.org !== undefined ? { org: values.org } : {}),
      env,
    })

    switch (comando) {
      // cada caso pasa organizationId al comando correspondiente
    }
  } finally {
    await cerrar()
  }
```

con

```ts
const COMANDOS = new Set([
  'marca:crear', 'perfil:cargar', 'estrategia:generar', 'grilla:generar', 'grilla:ver',
])
```

Agregar `--org <slug>` a la sección de opciones globales del texto de `AYUDA`, junto a `--seco`.

- [ ] **Step 6: Actualizar la prueba de humo**

En `apps/cli/src/humo.test.ts`, resolver la organización una vez al inicio y pasarla a cada llamada:

```ts
      const organizationId = await resolverOrganizacion(db, { env: {} })

      const marca = await crearMarca(db, organizationId, { slug: 'parcelas', nombre: 'Compra Tu Parcela' })
      await cargarPerfilDeObjeto(db, organizationId, { slug: 'parcelas', perfil: PERFIL_VALIDO })

      const estrategia = await generarEstrategia(db, cliente, organizationId, {
        slug: 'parcelas', periodo: '2026-Q3', env: ENV,
      })
```

y así con `generarGrilla` y `verGrilla`. Las aserciones no cambian: siguen siendo 12 slots, 8 derivados y costo cero.

- [ ] **Step 7: Ejecutar las pruebas**

```bash
pnpm --filter @gc/cli test
```

Esperado: PASA. `@gc/cli` pasa de 3 a 12 pruebas.

- [ ] **Step 8: Verificar a mano desde la raíz**

```bash
pnpm cli marca:crear --slug prueba-org --nombre "Prueba"
```

Esperado: crea la marca en la organización `principal` sin pedir nada.

```bash
pnpm cli grilla:ver --marca no-existe --mes 2026-09
```

Esperado: una sola línea en español diciendo que no existe la marca en esta organización, y código de salida 1. **Reporta la salida literal.**

- [ ] **Step 9: Suite completa y commit**

```bash
pnpm test && pnpm -r typecheck
```

```bash
git add -A && git commit -m "feat: el CLI resuelve la organización y filtra las marcas por ella"
```

---

### Task 5: P2 exige la estrategia del trimestre que corresponde

**Files:**
- Create: `packages/strategy/src/periodos.ts`
- Create: `packages/strategy/src/periodos.test.ts`
- Modify: `packages/strategy/src/p2.ts`
- Modify: `packages/strategy/src/p1.ts`
- Modify: `packages/strategy/src/index.ts`
- Test: `packages/strategy/src/p2.test.ts`
- Test: `packages/strategy/src/p1.test.ts`

**Interfaces:**
- Consumes: `permanente` de `@gc/shared`
- Produces: `trimestreDe(mes: string): string`, `validarPeriodo(periodo: string): string`. `cargarEstrategiaVigente` pasa a recibir el mes como tercer parámetro (es privada de `p2.ts`, no cambia la API pública del paquete).

- [ ] **Step 1: Escribir las pruebas de los periodos**

`packages/strategy/src/periodos.test.ts`:

```ts
import { describe, expect, it } from 'vitest'
import { trimestreDe, validarPeriodo } from './periodos.js'

describe('trimestreDe', () => {
  it.each([
    ['2026-01', '2026-Q1'], ['2026-02', '2026-Q1'], ['2026-03', '2026-Q1'],
    ['2026-04', '2026-Q2'], ['2026-05', '2026-Q2'], ['2026-06', '2026-Q2'],
    ['2026-07', '2026-Q3'], ['2026-08', '2026-Q3'], ['2026-09', '2026-Q3'],
    ['2026-10', '2026-Q4'], ['2026-11', '2026-Q4'], ['2026-12', '2026-Q4'],
  ])('%s pertenece a %s', (mes, esperado) => {
    expect(trimestreDe(mes)).toBe(esperado)
  })

  it('no cruza el año', () => {
    expect(trimestreDe('2027-01')).toBe('2027-Q1')
  })

  it.each(['2026', '2026-13', '2026-00', 'septiembre', '2026-9'])(
    'rechaza el mes inválido %s',
    (mes) => {
      expect(() => trimestreDe(mes)).toThrow(/mes inválido/i)
    },
  )
})

describe('validarPeriodo', () => {
  it.each(['2026-Q1', '2026-Q4', '2030-Q2'])('acepta %s', (p) => {
    expect(validarPeriodo(p)).toBe(p)
  })

  it.each(['2026-Q0', '2026-Q5', '2026-q1', '2026-3', 'Q1-2026', '2026'])(
    'rechaza %s',
    (p) => {
      expect(() => validarPeriodo(p)).toThrow(/periodo inválido/i)
    },
  )
})
```

- [ ] **Step 2: Ejecutar y verificar que falla**

```bash
pnpm --filter @gc/strategy test periodos
```

Esperado: FALLA con `Failed to load url ./periodos.js`.

- [ ] **Step 3: Implementar**

`packages/strategy/src/periodos.ts`:

```ts
import { permanente } from '@gc/shared'

const MES_VALIDO = /^\d{4}-(0[1-9]|1[0-2])$/
const PERIODO_VALIDO = /^\d{4}-Q[1-4]$/

/** `2026-09` → `2026-Q3`. Es el vínculo entre la estrategia trimestral y la grilla mensual. */
export function trimestreDe(mes: string): string {
  if (!MES_VALIDO.test(mes)) {
    throw permanente(`Mes inválido "${mes}": se espera el formato AAAA-MM`)
  }
  const [anio, m] = mes.split('-')
  return `${anio}-Q${Math.ceil(Number(m) / 3)}`
}

export function validarPeriodo(periodo: string): string {
  if (!PERIODO_VALIDO.test(periodo)) {
    throw permanente(
      `Periodo inválido "${periodo}": se espera el formato AAAA-QN con N entre 1 y 4`,
    )
  }
  return periodo
}
```

Agregar `export * from './periodos.js'` a `packages/strategy/src/index.ts`.

- [ ] **Step 4: Ejecutar y verificar que pasa**

```bash
pnpm --filter @gc/strategy test periodos
```

Esperado: PASA, 27 pruebas.

- [ ] **Step 5: Escribir las pruebas de selección estricta**

Agregar a `packages/strategy/src/p2.test.ts`:

```ts
  it('exige la estrategia del trimestre que corresponde al mes', async () => {
    await conBaseDeDatosDePrueba(async (db) => {
      const ref = await sembrar(db)

      // sembrar() crea la estrategia de 2026-Q3. Septiembre calza; diciembre no.
      const flujo = crearFlujoGrilla({ cliente: new ClienteFalso([GRILLA_VALIDA]), env: ENV })
      const error = await ejecutarFlujo(
        db, flujo, { brandId: ref.brandId, mes: '2026-12' }, ref, SIN_ESPERA,
      ).catch((e: unknown) => e)

      expect(error).toMatchObject({ clase: 'permanente' })
      expect((error as Error).message).toContain('2026-Q4')
      expect((error as Error).message).toContain('2026-12')
    })
  })

  it('no usa una estrategia archivada', async () => {
    await conBaseDeDatosDePrueba(async (db) => {
      const ref = await sembrar(db)
      await db
        .update(esquema.strategies)
        .set({ status: 'archivada' })
        .where(eq(esquema.strategies.brandId, ref.brandId))

      const flujo = crearFlujoGrilla({ cliente: new ClienteFalso([GRILLA_VALIDA]), env: ENV })
      await expect(
        ejecutarFlujo(db, flujo, { brandId: ref.brandId, mes: '2026-09' }, ref, SIN_ESPERA),
      ).rejects.toMatchObject({ clase: 'permanente' })
    })
  })

  it('ignora una estrategia más reciente de otro trimestre', async () => {
    await conBaseDeDatosDePrueba(async (db) => {
      const ref = await sembrar(db)

      // Estrategia de Q4, creada después, con un mix que excluye blog.
      await db.insert(esquema.strategies).values({
        organizationId: ref.organizationId,
        brandId: ref.brandId,
        period: '2026-Q4',
        data: { ...ESTRATEGIA, mixDeCanales: [{ canal: 'tiktok', publicacionesPorSemana: 1 }] },
        brandProfileVersion: 1,
      })

      const flujo = crearFlujoGrilla({ cliente: new ClienteFalso([GRILLA_VALIDA]), env: ENV })
      const r = await ejecutarFlujo(
        db, flujo, { brandId: ref.brandId, mes: '2026-09' }, ref, SIN_ESPERA,
      )

      // Si hubiera tomado la de Q4, los slots de blog serían canal_fuera_de_mix.
      expect(r.estado).toBe('completado')
    })
  })
```

Agregar a `packages/strategy/src/p1.test.ts`:

```ts
  it('rechaza un periodo con formato inválido antes de gastar', async () => {
    await conBaseDeDatosDePrueba(async (db) => {
      const ref = await sembrar(db)
      const cliente = new ClienteFalso([ESTRATEGIA_JSON])
      const flujo = crearFlujoEstrategia({ cliente, env: ENV })

      await expect(
        ejecutarFlujo(db, flujo, { brandId: ref.brandId, period: '2026-3' }, ref, SIN_ESPERA),
      ).rejects.toMatchObject({ clase: 'permanente' })

      expect(cliente.peticiones).toHaveLength(0)
      expect(await db.select().from(esquema.aiCalls)).toHaveLength(0)
    })
  })
```

- [ ] **Step 6: Ejecutar y verificar que falla**

```bash
pnpm --filter @gc/strategy test
```

Esperado: FALLAN las cuatro nuevas. Hoy P2 toma la estrategia más reciente sin mirar periodo ni estado, y P1 acepta cualquier texto como periodo.

- [ ] **Step 7: Implementar la selección estricta**

En `packages/strategy/src/p2.ts`, agregar `ne` al import de `drizzle-orm`, importar `trimestreDe`, y reemplazar `cargarEstrategiaVigente`:

```ts
async function cargarEstrategiaVigente(
  db: BaseDeDatos,
  brandId: string,
  mes: string,
): Promise<{ id: string; estrategia: TipoEstrategia }> {
  const periodo = trimestreDe(mes)

  // `(brand_id, period)` es único, así que hay a lo más una fila: no hace
  // falta ordenar, y "la más reciente" deja de ser un criterio.
  const [fila] = await db
    .select()
    .from(esquema.strategies)
    .where(
      and(
        eq(esquema.strategies.brandId, brandId),
        eq(esquema.strategies.period, periodo),
        ne(esquema.strategies.status, 'archivada'),
      ),
    )

  if (!fila) {
    throw permanente(
      `La marca ${brandId} no tiene estrategia vigente para ${periodo}. ` +
        `Genérala antes de la grilla de ${mes}.`,
    )
  }

  const r = Estrategia.safeParse(fila.data)
  if (!r.success) throw permanente(`La estrategia guardada de ${brandId} no valida`)

  return { id: fila.id, estrategia: r.data }
}
```

Actualizar la llamada dentro del paso para pasarle `entrada.mes`. Quitar `desc` del import si queda sin uso.

En `packages/strategy/src/p1.ts`, importar `validarPeriodo` y llamarlo como primera línea del paso, **antes** de `exigirPresupuesto`:

```ts
      validarPeriodo(entrada.period)
      await exigirPresupuesto(ctx.db, entrada.brandId, new Date())
```

- [ ] **Step 8: Ejecutar y verificar que pasa**

```bash
pnpm --filter @gc/strategy test
```

Esperado: PASA. `@gc/strategy` pasa de 24 a 55 pruebas.

- [ ] **Step 9: Verificar la marcha en seco de punta a punta**

```bash
pnpm cli grilla:generar --marca parcelas --mes 2026-09 --seco
```

Esperado: sigue generando 12 publicaciones. La estrategia sembrada es de `2026-Q3` y septiembre calza, así que el camino canónico no cambia. **Reporta la salida literal.**

```bash
pnpm cli grilla:generar --marca parcelas --mes 2026-12 --seco
```

Esperado: falla con una línea que nombra `2026-Q4` y `2026-12`, y código de salida 1.

- [ ] **Step 10: Suite completa y commit**

```bash
pnpm test && pnpm -r typecheck
```

```bash
git add -A && git commit -m "feat: P2 exige la estrategia del trimestre y P1 valida el formato de periodo"
```

---

## Cobertura de la especificación

| Sección del spec | Tarea | Estado |
|---|---|---|
| §3 `clasificarPostgres` / `clasificarError` | 1 | Cubierto |
| §3 Tabla de códigos SQLSTATE | 1 | Cubierto, con prueba tabular |
| §3 Mensaje legible ante slug duplicado | 4 | Cubierto en `crearMarca` |
| §4 Restricciones únicas `(id, organization_id)` | 2 | Cubierto, 4 tablas |
| §4 Las once claves foráneas compuestas | 2 | Cubierto |
| §4 FK faltante en `source_slot_id` | 2 | Cubierto como efecto de la compuesta |
| §4 `organizations.slug` con relleno | 3 | Cubierto, migración en tres pasos |
| §4 Resolución de organización en el CLI | 4 | Cubierto |
| §4 `resolverMarca` por `(organization_id, slug)` | 4 | Cubierto |
| §5 `trimestreDe` y selección estricta | 5 | Cubierto |
| §5 Validación del formato de periodo | 5 | Cubierto |
| §6 Pruebas enumeradas | 1–5 | Cubiertas todas |

**Fuera de alcance, sigue registrado en [pendientes](../specs/2026-07-31-pendientes-tras-fase-0.md):** la tabla de precios de respaldo, los descartes silenciosos de `expandirDerivados`, las dos listas que se sincronizan a mano entre `validacion.ts` y `derivados.ts`, la validación de `--mes` en `grilla:generar`, y el `hashDePrompt` que no distingue los dos intentos de un ciclo de reparación.

## Siguiente plan

Fase 1: interfaz web y despliegue. Calendario editorial, bandeja de aprobación, worker en Cloud Run, Vercel + Google Cloud. Reutiliza las funciones de `apps/cli/src/comandos.ts`, cuya firma ya lleva `organizationId` explícito gracias a la Task 4.
