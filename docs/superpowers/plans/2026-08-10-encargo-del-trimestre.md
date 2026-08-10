# El encargo del trimestre — plan de implementación

> **Para quien ejecute esto:** SUB-SKILL OBLIGATORIA: usa `superpowers:subagent-driven-development` (recomendada) o `superpowers:executing-plans` para implementar tarea por tarea. Los pasos usan casillas (`- [ ]`).

**Objetivo:** que generar una estrategia exija primero un cuestionario sobre qué quieres lograr el trimestre, y que esas respuestas lleguen al modelo.

**Arquitectura:** una tabla nueva con una fila por marca y trimestre; su esquema Zod en `@gc/strategy`, que `apps/web` sí puede importar; operaciones de lectura y escritura en `@gc/operaciones` que hacen cumplir la congelación y la tenencia; una guarda en `encolarEstrategia` y otra en P1; un formulario de cliente en la página de estrategia.

**Tecnologías:** TypeScript ESM, Zod, Drizzle sobre Postgres, Next.js 15 App Router, React 19, Vitest 2.1 con `jsdom` y `@testing-library/react`.

**Spec:** [2026-08-10-encargo-del-trimestre-design.md](../specs/2026-08-10-encargo-del-trimestre-design.md)

---

## Restricciones globales

Cada una es regla del proyecto (`CLAUDE.md`) y aplica a **todas** las tareas:

- **`pnpm test` en la raíz, NUNCA `pnpm -r test`.** Los paquetes comparten la base de pruebas y en paralelo se pisan.
- **Requiere Postgres levantado:** `docker compose up -d postgres`.
- **Idioma:** esquema y columnas de la base en inglés `snake_case`; API de dominio, variables, comentarios, prompts y **todo texto que ve el usuario**, en español neutro latinoamericano con «tú».
- **TypeScript ESM:** los imports relativos llevan extensión `.js`, también desde `.tsx`.
- **Una migración aplicada es inmutable**, y las nuevas van **sin** el envoltorio `DO $$ ... EXCEPTION`.
- **Los enumerados se hacen cumplir con `CHECK`**; `text(col, { enum })` de Drizzle no genera restricción alguna.
- **La tenencia se verifica dentro de cada escritura:** `WHERE ... AND organization_id = ?`, `.returning()`, y `permanente` si no vuelve fila.
- **El esquema Zod es la única autoridad de validación.** El formulario avisa mientras se escribe pero no decide.
- **La capa web nunca ejecuta trabajo largo ni llama al modelo.**
- **Proteger las páginas no protege las Server Actions.** Toda acción pasa por el ayudante `ejecutar` de `apps/web/src/acciones.ts`.
- **Cada ruta de Next necesita su propio `export const dynamic = 'force-dynamic'`.**
- **Una prueba que no puede fallar es peor que ninguna.** Este repositorio ya se ganó cuatro pruebas de componente que afirmaban contra el documento entero, y el bloque anterior encontró seis más. Cada prueba se valida rompiendo el código a propósito y exigiendo que se ponga roja **por la razón exacta**.

**Comandos de verificación** (antes de cada commit):

```bash
pnpm test
```

```bash
pnpm -r typecheck
```

```bash
pnpm --filter @gc/web build
```

---

## Estructura de archivos

**Crear:**

| Archivo | Responsabilidad |
|---|---|
| `packages/strategy/src/encargo.ts` | el esquema Zod del encargo y su tipo |
| `packages/strategy/src/encargo.test.ts` | pruebas de lo anterior |
| `packages/db/migraciones/0007_*.sql` | la tabla `strategy_briefs` (la genera `drizzle-kit`) |
| `packages/operaciones/src/encargos.ts` | leer y guardar el encargo, con congelación y tenencia |
| `packages/operaciones/src/encargos.test.ts` | pruebas de lo anterior |
| `apps/web/src/componentes/encargo/conversion.ts` | estado del formulario ↔ forma del esquema. Sin React |
| `apps/web/src/componentes/encargo/conversion.test.ts` | pruebas de lo anterior, sin renderizar |
| `apps/web/src/componentes/EditorDeEncargo.tsx` | el formulario de nueve campos |
| `apps/web/src/componentes/EditorDeEncargo.test.tsx` | pruebas del formulario |

**Modificar:**

| Archivo | Cambio |
|---|---|
| `packages/strategy/src/index.ts` | exportar `./encargo.js` |
| `packages/db/src/esquema.ts` | tabla `strategyBriefs` |
| `packages/db/src/esquema.test.ts` | la prueba de catálogo cubre la tabla nueva |
| `packages/operaciones/src/index.ts` | exportar `./encargos.js` |
| `packages/operaciones/src/corridas.ts` | `encolarEstrategia` exige encargo |
| `packages/operaciones/src/corridas.test.ts` | prueba de esa guarda |
| `packages/flujos/src/p1.ts` | cargar el encargo y mandarlo al modelo |
| `packages/flujos/src/p1.test.ts` | pruebas de lo anterior |
| `packages/flujos/src/prompts/generar-estrategia.md` | dos reglas nuevas |
| `apps/web/src/acciones.ts` | `guardarEncargoAction` |
| `apps/web/src/app/(app)/[marca]/estrategia/page.tsx` | el bloque del encargo y la puerta del botón |
| `apps/web/src/paginas.test.tsx` | pruebas de la página |
| `docs/superpowers/specs/pendientes.md` | lo que este bloque decidió no hacer |

---

## Task 1: el esquema del encargo

**Archivos:**
- Crear: `packages/strategy/src/encargo.ts`
- Crear: `packages/strategy/src/encargo.test.ts`
- Modificar: `packages/strategy/src/index.ts`

**Interfaces:**
- Consume: `CANALES` de `@gc/db`.
- Produce, y lo consumen las Tasks 3, 5, 6 y 7:

```ts
export const Encargo: z.ZodObject<...>
export type TipoEncargo = z.infer<typeof Encargo>
```

**Por qué en `@gc/strategy` y no en `@gc/brand`:** `apps/web` declara `@gc/strategy` y **no** declara `@gc/brand`. Poner el esquema acá deja que el formulario y el flujo compartan una sola declaración, en vez de repetir la deuda del editor de perfil, donde las reglas quedaron copiadas a mano porque el paquete era inalcanzable.

- [ ] **Paso 1: escribir las pruebas que fallan**

Crea `packages/strategy/src/encargo.test.ts`:

```ts
import { describe, expect, it } from 'vitest'
import { Encargo } from './encargo.js'

/** Un encargo con lo obligatorio lleno y lo opcional vacío. */
const MINIMO = {
  objetivo: 'Vender las doce parcelas que quedan del loteo norte',
  comoSeMide: 'Formularios de contacto recibidos',
  publicacionesPorSemana: 4,
  canalesDisponibles: ['instagram', 'blog'],
  queEstaPasando: '',
  queFunciono: '',
  queNoFunciono: '',
  queEvitar: '',
  algoMas: '',
}

describe('Encargo', () => {
  it('acepta lo obligatorio lleno y lo opcional vacío', () => {
    // Los cinco campos opcionales van SIEMPRE presentes y posiblemente
    // vacíos, no ausentes: es lo que evita la ambigüedad de «opcional» que
    // el prompt del perfil ya se comió una vez.
    expect(Encargo.safeParse(MINIMO).success).toBe(true)
  })

  it('rechaza un objetivo que no dice nada', () => {
    expect(Encargo.safeParse({ ...MINIMO, objetivo: 'vender' }).success).toBe(false)
  })

  it('rechaza quedarse sin canales', () => {
    // Sin canales el mix de la estrategia no tendría de dónde elegir.
    expect(Encargo.safeParse({ ...MINIMO, canalesDisponibles: [] }).success).toBe(false)
  })

  it('rechaza un canal que el sistema no publica', () => {
    expect(Encargo.safeParse({ ...MINIMO, canalesDisponibles: ['podcast'] }).success).toBe(false)
  })

  it('exige que la capacidad sea un entero de al menos uno', () => {
    expect(Encargo.safeParse({ ...MINIMO, publicacionesPorSemana: 0 }).success).toBe(false)
    expect(Encargo.safeParse({ ...MINIMO, publicacionesPorSemana: 2.5 }).success).toBe(false)
  })

  it('rechaza una capacidad que solo puede ser un error de tecleo', () => {
    // El tope no vigila la sensatez del plan: solo ataja un 500 escrito de
    // más, que produciría una grilla imposible.
    expect(Encargo.safeParse({ ...MINIMO, publicacionesPorSemana: 500 }).success).toBe(false)
  })

  it('exige los cinco campos opcionales presentes, aunque vacíos', () => {
    const { algoMas: _, ...sinAlgoMas } = MINIMO
    expect(Encargo.safeParse(sinAlgoMas).success).toBe(false)
  })
})
```

- [ ] **Paso 2: correr y ver que fallan**

```bash
pnpm --filter @gc/strategy test -- encargo
```

Esperado: FALLAN las siete con `Failed to resolve import "./encargo.js"`.

- [ ] **Paso 3: escribir el esquema**

Crea `packages/strategy/src/encargo.ts`:

```ts
import { CANALES } from '@gc/db'
import { z } from 'zod'

const Canal = z.enum(CANALES)

/**
 * Lo que la persona responde antes de generar la estrategia del trimestre.
 *
 * El perfil de marca dice quién es la marca y no cambia casi nunca; esto dice
 * qué quiere lograr **este** trimestre, y caduca con él. Sin esto, P1 tenía
 * que inventar las métricas de los objetivos y el `mixDeCanales` entero.
 *
 * Los cinco campos opcionales son `z.string()` sin mínimo —presentes y
 * posiblemente vacíos— y no `.optional()`. La diferencia importa: «puede ir
 * vacío» y «puede no estar» son cosas distintas para quien lea el JSON, y
 * este proyecto ya pagó esa ambigüedad una vez, en las reglas del prompt del
 * perfil.
 */
export const Encargo = z.object({
  /** Qué quieres que pase en estos tres meses. */
  objetivo: z.string().min(10),
  /** En qué número lo verías. Alimenta `objetivos[].metrica` y `.meta`. */
  comoSeMide: z.string().min(5),
  /**
   * Total de publicaciones por semana que puedes sostener, sumando canales.
   * El tope no juzga si el plan es sensato —eso lo decides tú al leer la
   * estrategia—: solo ataja un cero escrito de más.
   */
  publicacionesPorSemana: z.number().int().min(1).max(50),
  /** En qué canales puedes publicar este trimestre. */
  canalesDisponibles: z.array(Canal).min(1),
  /** Un lanzamiento, una temporada, un evento. */
  queEstaPasando: z.string(),
  queFunciono: z.string(),
  queNoFunciono: z.string(),
  /** Lo que este trimestre no se toca. No es el léxico prohibido del perfil,
   *  que es lo que la marca nunca dice y no caduca. */
  queEvitar: z.string(),
  algoMas: z.string(),
})

export type TipoEncargo = z.infer<typeof Encargo>
```

Y agrega a `packages/strategy/src/index.ts`, en orden alfabético entre `./derivados.js` y `./esquemas.js`:

```ts
export * from './encargo.js'
```

- [ ] **Paso 4: correr y ver que pasan**

```bash
pnpm --filter @gc/strategy test -- encargo
```

- [ ] **Paso 5: mutar y confirmar**

Tres mutaciones, una a la vez, revirtiendo entre cada una:

1. Quitar `.min(1)` de `canalesDisponibles` → tiene que caer `'rechaza quedarse sin canales'`.
2. Cambiar `.int()` por nada en `publicacionesPorSemana` → tiene que caer `'exige que la capacidad sea un entero de al menos uno'`.
3. Cambiar los cinco `z.string()` opcionales por `z.string().optional()` → tiene que caer `'exige los cinco campos opcionales presentes, aunque vacíos'`.

- [ ] **Paso 6: la suite, el typecheck y commit**

```bash
pnpm test && pnpm -r typecheck
```

```bash
git add packages/strategy/src/ && git commit -m "feat(strategy): el esquema del encargo del trimestre"
```

---

## Task 2: la tabla

**Archivos:**
- Modificar: `packages/db/src/esquema.ts`
- Modificar: `packages/db/src/esquema.test.ts`
- Crear: `packages/db/migraciones/0007_*.sql` (la genera `drizzle-kit`, no la escribas a mano)

**Interfaces:**
- Produce, y lo consumen las Tasks 3 y 5: `esquema.strategyBriefs`, con columnas `id`, `organizationId`, `brandId`, `period`, `data`, `createdAt`, `createdBy`.

- [ ] **Paso 1: escribir la prueba que falla**

`packages/db/src/esquema.test.ts` ya tiene una prueba de catálogo que verifica que las restricciones existan en Postgres. Agrégale este bloque:

```ts
describe('strategy_briefs', () => {
  it('tiene la única de marca y periodo, y la foránea compuesta con la marca', async () => {
    // La foránea compuesta es lo que impide que un encargo apunte a una marca
    // de otra organización: sin ella, la tenencia dependería de que cada
    // consulta se acuerde de filtrar.
    await conBaseDeDatosDePrueba(async (db) => {
      const filas = await db.execute(sql`
        select conname from pg_constraint
        where conrelid = 'strategy_briefs'::regclass
      `)
      const nombres = filas.rows.map((f) => String(f.conname))
      expect(nombres).toContain('strategy_briefs_brand_id_period_unique')
      expect(nombres).toContain('strategy_briefs_brand_org_fk')
    })
  })

  it('rechaza un encargo cuya marca es de otra organización', async () => {
    await conBaseDeDatosDePrueba(async (db) => {
      const [orgA] = await db.insert(esquema.organizations)
        .values({ name: 'A', slug: 'a' }).returning()
      const [orgB] = await db.insert(esquema.organizations)
        .values({ name: 'B', slug: 'b' }).returning()
      const [marca] = await db.insert(esquema.brands)
        .values({ organizationId: orgA!.id, slug: 'm', name: 'M' }).returning()

      await expect(
        db.insert(esquema.strategyBriefs).values({
          organizationId: orgB!.id,
          brandId: marca!.id,
          period: '2026-Q4',
          data: {},
        }),
      ).rejects.toThrow()
    })
  })
})
```

Si los ayudantes (`conBaseDeDatosDePrueba`, `sql`, `esquema`) ya están importados en ese archivo, no los dupliques.

- [ ] **Paso 2: correr y ver que falla**

```bash
pnpm --filter @gc/db test -- esquema
```

Esperado: FALLAN las dos, la primera con `relation "strategy_briefs" does not exist`.

- [ ] **Paso 3: agregar la tabla**

En `packages/db/src/esquema.ts`, justo **después** del bloque `strategies` (para que las tablas del trimestre queden juntas):

```ts
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
```

No lleva ningún `chequeoEnum`: no tiene columnas `text(..., { enum })`.

- [ ] **Paso 4: generar la migración**

```bash
pnpm --filter @gc/db migraciones:generar
```

Abre el `.sql` que quedó en `packages/db/migraciones/`. **Tiene que crear la tabla con sus dos restricciones y no tocar ninguna otra tabla.** Si trae cambios ajenos, la copia local del esquema estaba desincronizada: para y repórtalo en vez de commitear la diferencia.

- [ ] **Paso 5: aplicarla a la base de pruebas y correr**

```bash
pnpm --filter @gc/db test -- esquema
```

- [ ] **Paso 6: mutar y confirmar**

Quita el bloque `marcaPorOrg` del esquema, regenera la migración en un directorio temporal —**no** la commitees— y confirma que `'rechaza un encargo cuya marca es de otra organización'` se pone roja. Devuelve el esquema y la migración a como estaban.

- [ ] **Paso 7: la suite, el typecheck y commit**

```bash
pnpm test && pnpm -r typecheck
```

```bash
git add packages/db/ && git commit -m "feat(db): la tabla del encargo del trimestre"
```

---

## Task 3: leer y guardar el encargo

**Archivos:**
- Crear: `packages/operaciones/src/encargos.ts`
- Crear: `packages/operaciones/src/encargos.test.ts`
- Modificar: `packages/operaciones/src/index.ts`

**Interfaces:**
- Consume: `Encargo`, `TipoEncargo` de `@gc/strategy` (Task 1); `esquema.strategyBriefs` de `@gc/db` (Task 2); `resolverMarca` y `validarPeriodo`, que ya existen y usa `corridas.ts`.
- Produce, y lo consumen las Tasks 4, 7 y 8:

```ts
export type LecturaDeEncargo =
  | { tipo: 'ausente' }
  | { tipo: 'invalido'; motivo: string }
  | { tipo: 'presente'; encargo: TipoEncargo }

export async function leerEncargo(
  db: BaseDeDatos, organizationId: string, args: { slug: string; periodo: string },
): Promise<LecturaDeEncargo>

export async function guardarEncargo(
  db: BaseDeDatos, organizationId: string,
  args: { slug: string; periodo: string; encargo: unknown },
  usuarioId?: string,
): Promise<void>
```

**Los tres estados de la lectura** copian la forma que `estrategiaDelTrimestre` ya usa en `perfiles.ts`. `invalido` no es futurismo: el encargo se valida al escribirlo, así que la única forma de que deje de validar es que una versión posterior le agregue un campo obligatorio — y ese día conviene que la pantalla lo diga en vez de mostrar un formulario en blanco que hace perder lo escrito.

- [ ] **Paso 1: escribir las pruebas que fallan**

Crea `packages/operaciones/src/encargos.test.ts`:

```ts
import { esquema } from '@gc/db'
import { conBaseDeDatosDePrueba } from '@gc/db/pruebas'
import { describe, expect, it } from 'vitest'
import { guardarEncargo, leerEncargo } from './encargos.js'

const ENCARGO = {
  objetivo: 'Vender las doce parcelas que quedan del loteo norte',
  comoSeMide: 'Formularios de contacto recibidos',
  publicacionesPorSemana: 4,
  canalesDisponibles: ['instagram', 'blog'],
  queEstaPasando: 'Empieza la temporada alta de visitas',
  queFunciono: '',
  queNoFunciono: '',
  queEvitar: '',
  algoMas: '',
}

async function sembrar(db: Parameters<Parameters<typeof conBaseDeDatosDePrueba>[0]>[0]) {
  const [org] = await db.insert(esquema.organizations)
    .values({ name: 'X', slug: 'x' }).returning()
  const [marca] = await db.insert(esquema.brands)
    .values({ organizationId: org!.id, slug: 'parcelas', name: 'CTP' }).returning()
  return { organizationId: org!.id, brandId: marca!.id }
}

describe('guardarEncargo y leerEncargo', () => {
  it('guarda y devuelve lo guardado', async () => {
    await conBaseDeDatosDePrueba(async (db) => {
      const ref = await sembrar(db)
      await guardarEncargo(db, ref.organizationId, {
        slug: 'parcelas', periodo: '2026-Q4', encargo: ENCARGO,
      })

      const r = await leerEncargo(db, ref.organizationId, { slug: 'parcelas', periodo: '2026-Q4' })
      expect(r.tipo).toBe('presente')
      if (r.tipo !== 'presente') throw new Error('inalcanzable')
      expect(r.encargo.objetivo).toBe(ENCARGO.objetivo)
      expect(r.encargo.canalesDisponibles).toEqual(['instagram', 'blog'])
    })
  })

  it('sin encargo escrito devuelve ausente', async () => {
    await conBaseDeDatosDePrueba(async (db) => {
      const ref = await sembrar(db)
      const r = await leerEncargo(db, ref.organizationId, { slug: 'parcelas', periodo: '2026-Q4' })
      expect(r.tipo).toBe('ausente')
    })
  })

  it('guardar dos veces el mismo trimestre corrige, no duplica', async () => {
    await conBaseDeDatosDePrueba(async (db) => {
      const ref = await sembrar(db)
      const args = { slug: 'parcelas', periodo: '2026-Q4' }
      await guardarEncargo(db, ref.organizationId, { ...args, encargo: ENCARGO })
      await guardarEncargo(db, ref.organizationId, {
        ...args, encargo: { ...ENCARGO, objetivo: 'Construir autoridad antes de vender nada' },
      })

      const filas = await db.select().from(esquema.strategyBriefs)
      expect(filas).toHaveLength(1)
      const r = await leerEncargo(db, ref.organizationId, args)
      if (r.tipo !== 'presente') throw new Error('inalcanzable')
      expect(r.encargo.objetivo).toBe('Construir autoridad antes de vender nada')
    })
  })

  it('rechaza un encargo que no cumple el esquema, sin escribir nada', async () => {
    await conBaseDeDatosDePrueba(async (db) => {
      const ref = await sembrar(db)
      await expect(
        guardarEncargo(db, ref.organizationId, {
          slug: 'parcelas', periodo: '2026-Q4', encargo: { ...ENCARGO, canalesDisponibles: [] },
        }),
      ).rejects.toThrow()
      expect(await db.select().from(esquema.strategyBriefs)).toHaveLength(0)
    })
  })

  it('con la estrategia fuera de borrador el encargo queda congelado', async () => {
    // Es lo que evita la mentira de leer un encargo que ya no es el que
    // produjo la estrategia que estás mirando.
    await conBaseDeDatosDePrueba(async (db) => {
      const ref = await sembrar(db)
      const args = { slug: 'parcelas', periodo: '2026-Q4' }
      await guardarEncargo(db, ref.organizationId, { ...args, encargo: ENCARGO })
      await db.insert(esquema.strategies).values({
        organizationId: ref.organizationId, brandId: ref.brandId, period: '2026-Q4',
        status: 'aprobada', data: {}, brandProfileVersion: 1,
      })

      await expect(
        guardarEncargo(db, ref.organizationId, { ...args, encargo: ENCARGO }),
      ).rejects.toThrow(/aprobada|borrador/i)
    })
  })

  it('con la estrategia archivada también queda congelado', async () => {
    // La condición es «el estado no es borrador», no «el estado es aprobada»:
    // una estrategia archivada tampoco se regenera.
    await conBaseDeDatosDePrueba(async (db) => {
      const ref = await sembrar(db)
      const args = { slug: 'parcelas', periodo: '2026-Q4' }
      await guardarEncargo(db, ref.organizationId, { ...args, encargo: ENCARGO })
      await db.insert(esquema.strategies).values({
        organizationId: ref.organizationId, brandId: ref.brandId, period: '2026-Q4',
        status: 'archivada', data: {}, brandProfileVersion: 1,
      })

      await expect(
        guardarEncargo(db, ref.organizationId, { ...args, encargo: ENCARGO }),
      ).rejects.toThrow()
    })
  })

  it('con la estrategia en borrador se puede seguir corrigiendo', async () => {
    await conBaseDeDatosDePrueba(async (db) => {
      const ref = await sembrar(db)
      const args = { slug: 'parcelas', periodo: '2026-Q4' }
      await guardarEncargo(db, ref.organizationId, { ...args, encargo: ENCARGO })
      await db.insert(esquema.strategies).values({
        organizationId: ref.organizationId, brandId: ref.brandId, period: '2026-Q4',
        status: 'borrador', data: {}, brandProfileVersion: 1,
      })

      await expect(
        guardarEncargo(db, ref.organizationId, {
          ...args, encargo: { ...ENCARGO, objetivo: 'Otro objetivo bien distinto del anterior' },
        }),
      ).resolves.toBeUndefined()
    })
  })

  it('una fila que dejó de cumplir el esquema se reporta como inválida', async () => {
    await conBaseDeDatosDePrueba(async (db) => {
      const ref = await sembrar(db)
      await db.insert(esquema.strategyBriefs).values({
        organizationId: ref.organizationId, brandId: ref.brandId,
        period: '2026-Q4', data: { objetivo: 'corto' },
      })

      const r = await leerEncargo(db, ref.organizationId, { slug: 'parcelas', periodo: '2026-Q4' })
      expect(r.tipo).toBe('invalido')
    })
  })

  it('un periodo mal formado se rechaza antes de tocar la base', async () => {
    await conBaseDeDatosDePrueba(async (db) => {
      const ref = await sembrar(db)
      await expect(
        guardarEncargo(db, ref.organizationId, {
          slug: 'parcelas', periodo: '2026-Q9', encargo: ENCARGO,
        }),
      ).rejects.toThrow()
    })
  })
})
```

- [ ] **Paso 2: correr y ver que fallan**

```bash
pnpm --filter @gc/operaciones test -- encargos
```

Esperado: FALLAN las nueve con `Failed to resolve import "./encargos.js"`.

- [ ] **Paso 3: implementar**

Crea `packages/operaciones/src/encargos.ts`:

```ts
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
    .onConflictDoUpdate({
      target: [esquema.strategyBriefs.brandId, esquema.strategyBriefs.period],
      set: {
        data: leido.data,
        ...(usuarioId !== undefined ? { createdBy: usuarioId } : {}),
      },
    })
    .returning({ id: esquema.strategyBriefs.id })

  // Sin fila devuelta la escritura no ocurrió, y devolver `void` en silencio
  // haría que la pantalla anunciara un guardado que no pasó.
  if (!escrita) throw permanente(`No se pudo guardar el encargo de ${args.periodo}.`)
}
```

Y agrega a `packages/operaciones/src/index.ts`, después de `./corridas.js`:

```ts
export * from './encargos.js'
```

Si `resolverMarca` no está exportado desde `./marcas.js`, expórtalo; `corridas.ts` ya lo usa, así que revisa cómo lo importa ese archivo y sigue el mismo camino.

- [ ] **Paso 4: correr y ver que pasan**

```bash
pnpm --filter @gc/operaciones test -- encargos
```

- [ ] **Paso 5: mutar y confirmar**

Tres mutaciones, una a la vez, revirtiendo entre cada una:

1. Cambiar la condición de congelación por `estrategia.status === 'aprobada'` → tiene que caer `'con la estrategia archivada también queda congelado'` y **no** las demás. Es la que distingue las dos redacciones.
2. Quitar el `eq(...organizationId...)` del `where` de `leerEncargo` → **si ninguna prueba cae**, la cobertura de tenencia de la lectura es un hueco: anótalo en el reporte. La escritura sí está cubierta por la foránea compuesta de la Task 2.
3. Mover el `Encargo.safeParse` de `guardarEncargo` a después del `insert` → tiene que caer `'rechaza un encargo que no cumple el esquema, sin escribir nada'`.

- [ ] **Paso 6: la suite, el typecheck y commit**

```bash
pnpm test && pnpm -r typecheck
```

```bash
git add packages/operaciones/src/ && git commit -m "feat(operaciones): leer y guardar el encargo, con su congelación"
```

---

## Task 4: encolar exige encargo

**Archivos:**
- Modificar: `packages/operaciones/src/corridas.ts`
- Modificar: `packages/operaciones/src/corridas.test.ts`

**Interfaces:**
- Consume: `leerEncargo` de `./encargos.js` (Task 3).
- Produce: nada nuevo. `encolarEstrategia` conserva su firma.

**Por qué acá y además en P1 (Task 5):** esta guarda es la que te avisa **al instante**, en la pantalla, en vez de dejarte esperar a que el worker despierte para fallar. La de P1 es la autoritativa. Es el mismo reparto que `p1.ts` ya usa al consultar el estado de la estrategia antes de gastar presupuesto.

- [ ] **Paso 1: escribir las pruebas que fallan**

Agrega a `packages/operaciones/src/corridas.test.ts`, dentro del `describe('encolarEstrategia')` que ya existe:

```ts
  it('se niega si el trimestre no tiene encargo escrito', async () => {
    await conBaseDeDatosDePrueba(async (db) => {
      const ref = await sembrarMarca(db)
      await expect(
        encolarEstrategia(db, ref.organizationId, { slug: 'parcelas', periodo: '2026-Q4' }),
      ).rejects.toThrow(/encargo/i)

      // Y no deja una corrida colgada que el worker vaya a tomar.
      expect(await db.select().from(esquema.pipelineRuns)).toHaveLength(0)
    })
  })

  it('encola cuando el encargo ya está escrito', async () => {
    await conBaseDeDatosDePrueba(async (db) => {
      const ref = await sembrarMarca(db)
      await guardarEncargo(db, ref.organizationId, {
        slug: 'parcelas',
        periodo: '2026-Q4',
        encargo: {
          objetivo: 'Vender las doce parcelas que quedan del loteo norte',
          comoSeMide: 'Formularios de contacto recibidos',
          publicacionesPorSemana: 4,
          canalesDisponibles: ['instagram', 'blog'],
          queEstaPasando: '', queFunciono: '', queNoFunciono: '', queEvitar: '', algoMas: '',
        },
      })

      const runId = await encolarEstrategia(db, ref.organizationId, {
        slug: 'parcelas', periodo: '2026-Q4',
      })
      expect(runId).toBeTruthy()
    })
  })
```

`sembrarMarca` es el ayudante que ese archivo ya usa para crear organización y marca; si se llama distinto, usa el nombre real. Agrega el import de `guardarEncargo` desde `./encargos.js`.

**Aviso:** las pruebas de `encolarEstrategia` que ya existen van a ponerse rojas al agregar la guarda, porque ninguna escribe un encargo. **Eso es correcto y esperado**: arréglalas sembrando el encargo, no debilitando la guarda. Son las de las líneas ~43-115 y ~177 y ~356 de ese archivo.

- [ ] **Paso 2: correr y ver que fallan**

```bash
pnpm --filter @gc/operaciones test -- corridas
```

Esperado: falla `'se niega si el trimestre no tiene encargo escrito'` porque hoy encola sin mirar nada.

- [ ] **Paso 3: implementar**

En `packages/operaciones/src/corridas.ts`, dentro de `encolarEstrategia`, entre `resolverMarca` y `encolar`:

```ts
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
  if (encargo.tipo !== 'presente') {
    throw permanente(
      `Para generar la estrategia de ${args.periodo} falta escribir el encargo del trimestre: ` +
        'qué quieres lograr, cómo lo medirás, cuánto puedes publicar y en qué canales.',
    )
  }

  return encolar(
    db, organizationId, 'p1_estrategia', { brandId: ref.brandId, slug: args.slug }, args.periodo,
  )
}
```

Agrega los imports que falten (`leerEncargo` de `./encargos.js`, `permanente` de `@gc/shared` si no está ya).

- [ ] **Paso 4: correr y ver que pasan**

```bash
pnpm --filter @gc/operaciones test -- corridas
```

- [ ] **Paso 5: mutar y confirmar**

Cambia `encargo.tipo !== 'presente'` por `encargo.tipo === 'ausente'` y confirma qué cae. **Tiene que seguir cayendo algo**: si un encargo `invalido` deja encolar, el worker generaría con un encargo que no se puede leer. Si ninguna prueba cae, agrega una que siembre una fila inválida —como la de la Task 3— y comprueba que encolar se niega.

- [ ] **Paso 6: la suite, el typecheck y commit**

```bash
pnpm test && pnpm -r typecheck
```

```bash
git add packages/operaciones/src/ && git commit -m "feat(operaciones): no se encola una estrategia sin encargo"
```

---

## Task 5: el encargo llega al modelo

**Archivos:**
- Modificar: `packages/flujos/src/p1.ts`
- Modificar: `packages/flujos/src/p1.test.ts`
- Modificar: `packages/flujos/src/prompts/generar-estrategia.md`

**Interfaces:**
- Consume: `Encargo`, `TipoEncargo` de `@gc/strategy` (Task 1); `esquema.strategyBriefs` (Task 2).
- Produce: nada que otra tarea importe.

**P1 consulta la base directamente**, como ya hace `estadoDeLaEstrategia` en ese mismo archivo, en vez de llamar a `@gc/operaciones`. `@gc/flujos` no declara ese paquete y agregarle la dependencia por una consulta sería mover una arista del grafo por comodidad.

- [ ] **Paso 1: escribir las pruebas que fallan**

Agrega a `packages/flujos/src/p1.test.ts`. `sembrar` tiene que escribir también el encargo, porque sin él P1 ahora se niega:

```ts
const ENCARGO = {
  objetivo: 'Vender las doce parcelas que quedan del loteo norte',
  comoSeMide: 'Formularios de contacto recibidos',
  publicacionesPorSemana: 4,
  canalesDisponibles: ['instagram', 'blog'],
  queEstaPasando: 'Empieza la temporada alta de visitas',
  queFunciono: '',
  queNoFunciono: 'Los carruseles largos no los vio nadie',
  queEvitar: '',
  algoMas: '',
}

async function sembrarEncargo(
  db: Parameters<Parameters<typeof conBaseDeDatosDePrueba>[0]>[0],
  ref: { organizationId: string; brandId: string },
  period = '2026-Q4',
) {
  await db.insert(esquema.strategyBriefs).values({
    organizationId: ref.organizationId, brandId: ref.brandId, period, data: ENCARGO,
  })
}
```

Llama a `sembrarEncargo` desde `sembrar`, para que las pruebas que ya existen sigan pasando.

Y agrega estas dos:

```ts
  it('manda el encargo del trimestre al modelo, aparte del contexto de marca', async () => {
    await conBaseDeDatosDePrueba(async (db) => {
      const ref = await sembrar(db)
      const cliente = new ClienteFalso([ESTRATEGIA_JSON])
      const flujo = crearFlujoEstrategia({ cliente, env: ENV })

      await ejecutarFlujo(
        db, flujo, { brandId: ref.brandId, period: '2026-Q4' }, ref, SIN_ESPERA,
      )

      // Se afirma sobre el mensaje del usuario, no sobre toda la conversación:
      // el instructivo del sistema también habla de canales y de capacidad, y
      // afirmar contra todo pasaría aunque el encargo no viajara.
      const mensajeUsuario = cliente.llamadas[0]!.mensajes.find((m) => m.rol === 'usuario')!.texto
      expect(mensajeUsuario).toContain('Vender las doce parcelas que quedan del loteo norte')
      expect(mensajeUsuario).toContain('Formularios de contacto recibidos')
      expect(mensajeUsuario).toContain('4')
      expect(mensajeUsuario).toContain('instagram')
      expect(mensajeUsuario).toContain('Los carruseles largos no los vio nadie')
    })
  })

  it('se niega, sin llamar al modelo, si el trimestre no tiene encargo', async () => {
    await conBaseDeDatosDePrueba(async (db) => {
      const ref = await sembrar(db)
      const cliente = new ClienteFalso([ESTRATEGIA_JSON])
      const flujo = crearFlujoEstrategia({ cliente, env: ENV })

      // `sembrar` escribió el encargo de 2026-Q4; este es otro trimestre.
      const r = await ejecutarFlujo(
        db, flujo, { brandId: ref.brandId, period: '2026-Q1' }, ref, SIN_ESPERA,
      )

      expect(r.estado).toBe('fallido')
      // Lo que importa no es que falle, sino que falle ANTES de pagar.
      expect(cliente.llamadas).toHaveLength(0)
    })
  })
```

Si `ClienteFalso` expone las llamadas con otro nombre que `llamadas`/`mensajes`, usa el real: míralo en `packages/ai/src/`, y fíjate cómo lo consulta la prueba `'envía el contexto de marca al modelo'` que ya existe en este mismo archivo.

- [ ] **Paso 2: correr y ver que fallan**

```bash
pnpm --filter @gc/flujos test -- p1
```

Esperado: falla `'manda el encargo del trimestre al modelo'` porque hoy el encargo no viaja, y falla `'se niega, sin llamar al modelo'` porque hoy P1 genera igual.

- [ ] **Paso 3: implementar**

En `packages/flujos/src/p1.ts`, agrega el lector y el formateador, junto a `estadoDeLaEstrategia`:

```ts
async function encargoDelTrimestre(
  db: BaseDeDatos, brandId: string, period: string,
): Promise<TipoEncargo> {
  const [fila] = await db
    .select({ data: esquema.strategyBriefs.data })
    .from(esquema.strategyBriefs)
    .where(and(
      eq(esquema.strategyBriefs.brandId, brandId),
      eq(esquema.strategyBriefs.period, period),
    ))
    .limit(1)

  if (!fila) {
    throw permanente(
      `No hay encargo escrito para ${period}. La estrategia se genera a partir de lo que ` +
        'quieres lograr el trimestre, así que sin eso no hay de dónde partir.',
    )
  }

  const leido = Encargo.safeParse(fila.data)
  if (!leido.success) {
    throw permanente(`El encargo de ${period} no cumple su esquema: ${leido.error.message}`)
  }
  return leido.data
}

/**
 * El encargo, como sección propia del mensaje.
 *
 * Va separado de `contextoDeMarca` a propósito: mezclarlos invita al modelo a
 * tratar como permanente algo que dura tres meses. Y el título no dice
 * «Encargo» porque el mensaje ya tiene una sección con ese nombre —la que pide
 * generar el periodo— y dos secciones homónimas se leen como una sola.
 */
function textoDelEncargo(e: TipoEncargo): string {
  const opcional = (etiqueta: string, valor: string) =>
    valor.trim() === '' ? [] : [`- ${etiqueta}: ${valor}`]

  return [
    '## Lo que la marca quiere lograr este trimestre',
    `- Objetivo: ${e.objetivo}`,
    `- Cómo se mide: ${e.comoSeMide}`,
    `- Capacidad total: ${e.publicacionesPorSemana} publicaciones por semana, sumando canales`,
    `- Canales disponibles: ${e.canalesDisponibles.join(', ')}`,
    ...opcional('Qué está pasando', e.queEstaPasando),
    ...opcional('Qué funcionó el trimestre pasado', e.queFunciono),
    ...opcional('Qué no funcionó', e.queNoFunciono),
    ...opcional('Qué evitar este trimestre', e.queEvitar),
    ...opcional('Además', e.algoMas),
  ].join('\n')
}
```

Los campos opcionales vacíos **se omiten** en vez de viajar como `- Qué funcionó: `: una etiqueta sin contenido le dice al modelo que ahí había algo que no se le entregó.

Dentro de `pasoGenerar.ejecutar`, después de la comprobación del estado previo y **antes** de `exigirPresupuesto` —para que un encargo faltante no consuma presupuesto ni llegue al modelo—:

```ts
      const encargo = await encargoDelTrimestre(ctx.db, entrada.brandId, entrada.period)
```

Y el mensaje del usuario pasa a:

```ts
        {
          rol: 'usuario',
          texto: [
            contextoDeMarca(perfil),
            '',
            textoDelEncargo(encargo),
            '',
            `## Encargo`,
            `Genera la estrategia de contenido para el periodo ${entrada.period}.`,
          ].join('\n'),
        },
```

Agrega los imports que falten: `Encargo` y `TipoEncargo` de `@gc/strategy` (el archivo ya importa de ahí).

- [ ] **Paso 4: agregar las reglas al instructivo**

En `packages/flujos/src/prompts/generar-estrategia.md`, agrega estas dos viñetas a la lista de reglas, después de la del mix de canales:

```
- El mix de canales no puede superar el total de publicaciones por semana que
  declara el encargo, ni usar canales que el encargo no liste. Si el total
  declarado no alcanza para todos los canales, publica en menos canales.
- Los objetivos se miden con la métrica que el encargo declara medible. No
  propongas otras métricas «además»: si la que declara no sirve para un
  objetivo, no propongas ese objetivo.
```

- [ ] **Paso 5: correr y ver que pasan**

```bash
pnpm --filter @gc/flujos test -- p1
```

- [ ] **Paso 6: mutar y confirmar**

Dos mutaciones, una a la vez:

1. Quitar `textoDelEncargo(encargo)` del mensaje → tiene que caer `'manda el encargo del trimestre al modelo'`.
2. Mover `encargoDelTrimestre` a **después** de `ejecutarTarea` → tiene que caer `'se niega, sin llamar al modelo'` por la aserción de `llamadas`, no por el estado. Confirma cuál de las dos aserciones cae: si cae solo la del estado, la prueba no está midiendo lo que dice medir.

- [ ] **Paso 7: la suite, el typecheck y commit**

```bash
pnpm test && pnpm -r typecheck
```

```bash
git add packages/flujos/src/ && git commit -m "feat(flujos): P1 genera la estrategia a partir del encargo del trimestre"
```

---

## Task 6: la conversión del formulario

**Archivos:**
- Crear: `apps/web/src/componentes/encargo/conversion.ts`
- Crear: `apps/web/src/componentes/encargo/conversion.test.ts`

**Interfaces:**
- Consume: `TipoEncargo` y `CANALES` (vía `@gc/strategy` y `@gc/db`, los dos declarados por `apps/web`).
- Produce, y lo consume la Task 7:

```ts
export interface EncargoEnFormulario {
  objetivo: string
  comoSeMide: string
  publicacionesPorSemana: string
  canalesDisponibles: string[]
  queEstaPasando: string
  queFunciono: string
  queNoFunciono: string
  queEvitar: string
  algoMas: string
}

export const FORMULARIO_VACIO: EncargoEnFormulario
export function desdeElEncargo(valor: unknown): EncargoEnFormulario
export function haciaElEncargo(f: EncargoEnFormulario): unknown
export function faltanCamposObligatorios(f: EncargoEnFormulario): boolean
```

**`publicacionesPorSemana` es `string` en el formulario y `number` en el esquema.** Es la misma trampa que el perfil tiene con `porcentaje`/`proporcion`: un `<input type="number">` vacío da `''`, y convertirlo a `0` en el estado haría aparecer un cero que nadie escribió. La conversión ocurre al serializar.

- [ ] **Paso 1: escribir las pruebas que fallan**

Crea `apps/web/src/componentes/encargo/conversion.test.ts`:

```ts
import { describe, expect, it } from 'vitest'
import {
  FORMULARIO_VACIO, desdeElEncargo, faltanCamposObligatorios, haciaElEncargo,
} from './conversion.js'

const LLENO = {
  objetivo: 'Vender las doce parcelas que quedan del loteo norte',
  comoSeMide: 'Formularios de contacto recibidos',
  publicacionesPorSemana: '4',
  canalesDisponibles: ['instagram', 'blog'],
  queEstaPasando: 'Empieza la temporada alta',
  queFunciono: '',
  queNoFunciono: '',
  queEvitar: '',
  algoMas: '',
}

describe('haciaElEncargo', () => {
  it('convierte la capacidad de texto a número', () => {
    const s = haciaElEncargo(LLENO) as { publicacionesPorSemana: unknown }
    expect(s.publicacionesPorSemana).toBe(4)
  })

  it('recorta los espacios de los textos', () => {
    const s = haciaElEncargo({ ...LLENO, objetivo: '  Vender las doce parcelas  ' }) as {
      objetivo: string
    }
    expect(s.objetivo).toBe('Vender las doce parcelas')
  })

  it('conserva los campos opcionales vacíos como cadena vacía', () => {
    // El esquema los exige presentes: omitirlos lo haría fallar.
    const s = haciaElEncargo(LLENO) as Record<string, unknown>
    expect(s.queFunciono).toBe('')
    expect(Object.hasOwn(s, 'algoMas')).toBe(true)
  })

  it('una capacidad no numérica no se convierte en NaN silencioso', () => {
    // NaN sobrevive a JSON.stringify como `null`, y el esquema lo rechazaría
    // con un mensaje que no menciona la capacidad. Se manda el texto tal cual
    // para que el rechazo diga lo que pasa.
    const s = haciaElEncargo({ ...LLENO, publicacionesPorSemana: 'cuatro' }) as {
      publicacionesPorSemana: unknown
    }
    expect(Number.isNaN(s.publicacionesPorSemana)).toBe(false)
  })
})

describe('desdeElEncargo', () => {
  it('carga lo que se pueda y nunca lanza', () => {
    expect(() => desdeElEncargo(null)).not.toThrow()
    expect(desdeElEncargo(null)).toEqual(FORMULARIO_VACIO)
    expect(() => desdeElEncargo(5)).not.toThrow()
  })

  it('la ida y vuelta reconstruye el mismo formulario', () => {
    expect(desdeElEncargo(haciaElEncargo(LLENO))).toEqual(LLENO)
  })
})

describe('faltanCamposObligatorios', () => {
  it('el formulario vacío tiene campos obligatorios sin llenar', () => {
    expect(faltanCamposObligatorios(FORMULARIO_VACIO)).toBe(true)
  })

  it('el formulario con los cuatro obligatorios llenos no', () => {
    expect(faltanCamposObligatorios(LLENO)).toBe(false)
  })

  it('no exige los cinco opcionales', () => {
    // Es la mitad de «obligatorio» que importa: el cuestionario existe, no que
    // los nueve campos estén llenos.
    expect(faltanCamposObligatorios({ ...LLENO, queEstaPasando: '', algoMas: '' })).toBe(false)
  })

  it('sin canales elegidos falta algo obligatorio', () => {
    expect(faltanCamposObligatorios({ ...LLENO, canalesDisponibles: [] })).toBe(true)
  })

  it('un objetivo de solo espacios no cuenta como lleno', () => {
    expect(faltanCamposObligatorios({ ...LLENO, objetivo: '   ' })).toBe(true)
  })
})
```

- [ ] **Paso 2: correr y ver que fallan**

```bash
pnpm --filter @gc/web test -- encargo/conversion
```

Esperado: FALLAN todas con `Failed to resolve import "./conversion.js"`.

- [ ] **Paso 3: implementar**

Crea `apps/web/src/componentes/encargo/conversion.ts`:

```ts
import type { TipoEncargo } from '@gc/strategy'

/**
 * El encargo tal como vive en el formulario.
 *
 * Difiere del esquema en un campo: `publicacionesPorSemana` es texto acá y
 * número allá. Un `<input>` vacío da `''`, y guardarlo como `0` en el estado
 * haría aparecer un cero que nadie escribió. La conversión ocurre al
 * serializar, igual que el porcentaje de los pilares en el editor de perfil.
 */
export interface EncargoEnFormulario {
  objetivo: string
  comoSeMide: string
  publicacionesPorSemana: string
  canalesDisponibles: string[]
  queEstaPasando: string
  queFunciono: string
  queNoFunciono: string
  queEvitar: string
  algoMas: string
}

export const FORMULARIO_VACIO: EncargoEnFormulario = {
  objetivo: '',
  comoSeMide: '',
  publicacionesPorSemana: '',
  canalesDisponibles: [],
  queEstaPasando: '',
  queFunciono: '',
  queNoFunciono: '',
  queEvitar: '',
  algoMas: '',
}

const texto = (v: unknown): string => (typeof v === 'string' ? v : '')

/** Carga lo que se pueda y nunca lanza: es su contrato, para poder mostrar un
 *  encargo viejo o parcialmente roto en vez de una pantalla en blanco. */
export function desdeElEncargo(valor: unknown): EncargoEnFormulario {
  if (typeof valor !== 'object' || valor === null || Array.isArray(valor)) {
    return { ...FORMULARIO_VACIO }
  }
  const o = valor as Record<string, unknown>
  return {
    objetivo: texto(o.objetivo),
    comoSeMide: texto(o.comoSeMide),
    publicacionesPorSemana:
      typeof o.publicacionesPorSemana === 'number' ? String(o.publicacionesPorSemana) : '',
    canalesDisponibles: Array.isArray(o.canalesDisponibles)
      ? o.canalesDisponibles.filter((c): c is string => typeof c === 'string')
      : [],
    queEstaPasando: texto(o.queEstaPasando),
    queFunciono: texto(o.queFunciono),
    queNoFunciono: texto(o.queNoFunciono),
    queEvitar: texto(o.queEvitar),
    algoMas: texto(o.algoMas),
  }
}

export function haciaElEncargo(f: EncargoEnFormulario): unknown {
  const crudo = f.publicacionesPorSemana.trim()
  const numero = Number(crudo)
  return {
    objetivo: f.objetivo.trim(),
    comoSeMide: f.comoSeMide.trim(),
    // Si no es un número, viaja el texto tal cual: `NaN` sobrevive a
    // `JSON.stringify` como `null`, y el esquema lo rechazaría con un mensaje
    // que no menciona la capacidad.
    publicacionesPorSemana: crudo !== '' && Number.isFinite(numero) ? numero : crudo,
    canalesDisponibles: [...f.canalesDisponibles],
    queEstaPasando: f.queEstaPasando.trim(),
    queFunciono: f.queFunciono.trim(),
    queNoFunciono: f.queNoFunciono.trim(),
    queEvitar: f.queEvitar.trim(),
    algoMas: f.algoMas.trim(),
  } satisfies Record<keyof TipoEncargo, unknown>
}

/**
 * `true` si alguno de los CUATRO campos obligatorios está vacío.
 *
 * No reproduce ningún mínimo de longitud del esquema: solo distingue «vacío»
 * de «escrito». Duplicar los mínimos acá crearía una segunda lista de reglas
 * sincronizada a mano, que es la deuda que `pendientes.md` ya registra dos
 * veces.
 */
export function faltanCamposObligatorios(f: EncargoEnFormulario): boolean {
  return (
    f.objetivo.trim() === '' ||
    f.comoSeMide.trim() === '' ||
    f.publicacionesPorSemana.trim() === '' ||
    f.canalesDisponibles.length === 0
  )
}
```

- [ ] **Paso 4: correr y ver que pasan**

```bash
pnpm --filter @gc/web test -- encargo/conversion
```

- [ ] **Paso 5: mutar y confirmar**

Tres mutaciones, una a la vez:

1. Quitar `f.canalesDisponibles.length === 0` de `faltanCamposObligatorios` → tiene que caer `'sin canales elegidos falta algo obligatorio'`.
2. Cambiar `f.objetivo.trim() === ''` por `f.objetivo === ''` → tiene que caer `'un objetivo de solo espacios no cuenta como lleno'`.
3. Devolver `numero` sin la guarda de `Number.isFinite` → tiene que caer `'una capacidad no numérica no se convierte en NaN silencioso'`.

- [ ] **Paso 6: la suite, el typecheck y commit**

```bash
pnpm test && pnpm -r typecheck
```

```bash
git add apps/web/src/componentes/encargo/ && git commit -m "feat(web): la conversión del formulario del encargo"
```

---

## Task 7: el formulario y la Server Action

**Archivos:**
- Crear: `apps/web/src/componentes/EditorDeEncargo.tsx`
- Crear: `apps/web/src/componentes/EditorDeEncargo.test.tsx`
- Modificar: `apps/web/src/acciones.ts`

**Interfaces:**
- Consume: todo lo de la Task 6; `CampoDeTexto` y `MENSAJE_CAMPO_OBLIGATORIO` de `../perfil/campos.js`; `guardarEncargo` de `@gc/operaciones` (Task 3).
- Produce, y lo consume la Task 8:

```ts
export function EditorDeEncargo(props: {
  marca: string
  periodo: string
  encargo: unknown
  soloLectura: boolean
}): JSX.Element

export async function guardarEncargoAction(
  slug: string, periodo: string, textoJson: string,
): Promise<Resultado<null>>
```

**La acción recibe el encargo como texto JSON**, con la misma firma de `guardarPerfilAction`. Es lo que ya sabe hacer el ayudante `ejecutar`, y evita inventar un segundo estilo de firma para lo mismo.

- [ ] **Paso 1: escribir las pruebas que fallan**

Crea `apps/web/src/componentes/EditorDeEncargo.test.tsx`:

```tsx
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { EditorDeEncargo } from './EditorDeEncargo.js'
import { guardarEncargoAction } from '../acciones.js'

vi.mock('../acciones.js', () => ({
  guardarEncargoAction: vi.fn(async () => ({ ok: true, datos: null })),
}))

const ENCARGO = {
  objetivo: 'Vender las doce parcelas que quedan del loteo norte',
  comoSeMide: 'Formularios de contacto recibidos',
  publicacionesPorSemana: 4,
  canalesDisponibles: ['instagram', 'blog'],
  queEstaPasando: '',
  queFunciono: '',
  queNoFunciono: '',
  queEvitar: '',
  algoMas: '',
}

const PROPS = { marca: 'parcelas', periodo: '2026-Q4', encargo: ENCARGO, soloLectura: false }

beforeEach(() => vi.mocked(guardarEncargoAction).mockClear())
afterEach(() => vi.restoreAllMocks())

describe('EditorDeEncargo', () => {
  it('siembra los campos con el encargo guardado', () => {
    render(<EditorDeEncargo {...PROPS} />)
    expect(screen.getByLabelText(/objetivo del trimestre/i)).toHaveValue(ENCARGO.objetivo)
    expect(screen.getByLabelText(/publicaciones por semana/i)).toHaveValue(4)
  })

  it('guardar manda el encargo convertido a la forma del esquema', async () => {
    render(<EditorDeEncargo {...PROPS} />)
    await userEvent.click(screen.getByRole('button', { name: 'Guardar el encargo' }))

    const [slug, periodo, texto] = vi.mocked(guardarEncargoAction).mock.calls[0]!
    expect(slug).toBe('parcelas')
    expect(periodo).toBe('2026-Q4')
    // La capacidad viaja como número, no como el texto del input.
    expect(JSON.parse(texto).publicacionesPorSemana).toBe(4)
  })

  it('con campos obligatorios vacíos marca los campos y NO llama al servidor', async () => {
    // El servidor rechazaría igual, pero con un mensaje del esquema. Marcar
    // acá es lo que hace que el error se lea en español y junto al campo.
    render(<EditorDeEncargo {...PROPS} encargo={null} />)
    await userEvent.click(screen.getByRole('button', { name: 'Guardar el encargo' }))

    expect(guardarEncargoAction).not.toHaveBeenCalled()
    expect(screen.getByLabelText(/objetivo del trimestre/i)).toHaveAttribute('aria-invalid', 'true')
  })

  it('el formulario vacío no muestra ningún error antes de intentar guardar', async () => {
    // El editor de perfil saludaba con dos errores rojos antes de escribir
    // nada, y eso fue un hallazgo de revisión. No se repite.
    render(<EditorDeEncargo {...PROPS} encargo={null} />)
    expect(screen.queryByRole('alert')).toBeNull()
    expect(screen.getByLabelText(/objetivo del trimestre/i)).not.toHaveAttribute('aria-invalid')
  })

  it('elegir un canal lo suma al encargo que se manda', async () => {
    render(<EditorDeEncargo {...PROPS} />)
    await userEvent.click(screen.getByRole('checkbox', { name: /linkedin/i }))
    await userEvent.click(screen.getByRole('button', { name: 'Guardar el encargo' }))

    const [, , texto] = vi.mocked(guardarEncargoAction).mock.calls[0]!
    expect(JSON.parse(texto).canalesDisponibles).toContain('linkedin')
  })

  it('en solo lectura no hay forma de guardar', async () => {
    render(<EditorDeEncargo {...PROPS} soloLectura />)
    expect(screen.queryByRole('button', { name: 'Guardar el encargo' })).toBeNull()
    expect(screen.getByLabelText(/objetivo del trimestre/i)).toBeDisabled()
  })

  it('un fallo del servidor se muestra y no se anuncia éxito', async () => {
    vi.mocked(guardarEncargoAction).mockResolvedValueOnce({
      ok: false, mensaje: 'La estrategia está en estado «aprobada»', reintentable: false,
    })

    render(<EditorDeEncargo {...PROPS} />)
    await userEvent.click(screen.getByRole('button', { name: 'Guardar el encargo' }))

    expect(screen.getByRole('alert').textContent).toContain('aprobada')
    expect(screen.queryByText(/guardado/i)).toBeNull()
  })
})
```

- [ ] **Paso 2: correr y ver que fallan**

```bash
pnpm --filter @gc/web test -- EditorDeEncargo
```

Esperado: FALLAN las siete con `Failed to resolve import "./EditorDeEncargo.js"`.

- [ ] **Paso 3: escribir la Server Action**

En `apps/web/src/acciones.ts`, junto a `guardarPerfilAction`:

```ts
export async function guardarEncargoAction(
  slug: string,
  periodo: string,
  textoJson: string,
): Promise<Resultado<null>> {
  return ejecutar(`/${slug}/estrategia`, async (db, organizationId, usuarioId) => {
    let encargo: unknown
    try {
      encargo = JSON.parse(textoJson)
    } catch (error) {
      throw new Error(
        `El texto no es JSON válido: ${error instanceof Error ? error.message : String(error)}`,
      )
    }

    await guardarEncargo(db, organizationId, { slug, periodo, encargo }, usuarioId)
    return null
  })
}
```

Agrega `guardarEncargo` al import de `@gc/operaciones` que ese archivo ya tiene. **Pasa por `ejecutar`**: una acción que no use ese ayudante nace sin comprobación de sesión.

- [ ] **Paso 4: escribir el formulario**

Crea `apps/web/src/componentes/EditorDeEncargo.tsx`. Es un componente de cliente (`'use client'` en la primera línea) con:

- estado `formulario` sembrado con `desdeElEncargo(encargo)`;
- estado `mostrarObligatorios`, que se enciende con el primer intento fallido de guardar y desde ahí queda encendido —cada campo decide si marcarse mirando su propio valor, así que uno que se llena deja de marcarse solo—;
- estados `ocupado`, `error` y `guardado`;
- las cuatro secciones del spec, en orden: **Lo que quieres lograr**, **Lo que puedes sostener**, **El momento**, **Los límites**;
- siete `CampoDeTexto` de `./perfil/campos.js` para los campos de texto, con `largo` en los que son de párrafo;
- un `<input type="number" min="1" step="1">` para la capacidad, con su `<label>` asociado;
- un grupo de `<input type="checkbox">` para los canales, uno por cada valor de `CANALES`, dentro de un `<fieldset>` con `<legend>`;
- botón **`Guardar el encargo`**, que no se renderiza cuando `soloLectura`;
- con `soloLectura`, todos los controles van `disabled`.

Las etiquetas exactas de los cuatro obligatorios, porque las pruebas las consultan:

| Campo | Etiqueta |
|---|---|
| `objetivo` | `Objetivo del trimestre` |
| `comoSeMide` | `Cómo sabrás que resultó` |
| `publicacionesPorSemana` | `Publicaciones por semana que puedes sostener` |
| `canalesDisponibles` | `Canales disponibles este trimestre` (la `<legend>` del `fieldset`) |

La ayuda y el ejemplo de cada campo van literales, así (el ejemplo se muestra bajo el campo con el prefijo `Ejemplo: `, no como `placeholder`, porque un `placeholder` desaparece justo cuando sirve):

| Campo | Ayuda | Ejemplo |
|---|---|---|
| `objetivo` | Qué quieres que pase en estos tres meses. Una sola cosa, la más importante. | Vender las doce parcelas que quedan del loteo norte |
| `comoSeMide` | En qué número lo verías, con algo que puedas mirar de verdad. | Formularios de contacto recibidos por semana |
| `publicacionesPorSemana` | El total que puedes sostener sumando todos los canales, no por canal. Sé realista: es mejor poco y constante. | 4 |
| `canalesDisponibles` | Dónde puedes publicar este trimestre. Marca solo los que vas a atender. | — (sin ejemplo: son casillas) |
| `queEstaPasando` | Un lanzamiento, una temporada alta, un evento, algo que cambió en el mercado. | Empieza la temporada de visitas a terreno y se inaugura el acceso pavimentado |
| `queFunciono` | Lo que sí resultó el trimestre pasado y vale la pena repetir. | Los recorridos en video por las parcelas fueron lo más visto |
| `queNoFunciono` | Lo que no resultó, o lo que quieres dejar de hacer. | Los carruseles largos de texto no los leyó nadie |
| `queEvitar` | Un tema que este trimestre prefieres no tocar. No es el léxico prohibido de la marca, que no caduca. | No hablar de la ampliación del loteo sur hasta que estén los permisos |
| `algoMas` | Cualquier cosa que el modelo debería saber y que el formulario no te preguntó. | El equipo se va de vacaciones las dos primeras semanas de febrero |

Los campos de párrafo —`objetivo`, `queEstaPasando`, `queFunciono`, `queNoFunciono`, `queEvitar`, `algoMas`— llevan `largo`; `comoSeMide` no.

El guardado:

```tsx
  async function guardar() {
    if (faltanCamposObligatorios(formulario)) {
      setMostrarObligatorios(true)
      return
    }

    setOcupado(true)
    setError(null)
    setGuardado(false)
    const r = await guardarEncargoAction(marca, periodo, JSON.stringify(haciaElEncargo(formulario)))
    setOcupado(false)
    if (r.ok) setGuardado(true)
    else setError(r.mensaje)
  }
```

El error va con `role="alert"`; el éxito, con `role="status"`.

- [ ] **Paso 5: correr y ver que pasan**

```bash
pnpm --filter @gc/web test -- EditorDeEncargo
```

- [ ] **Paso 6: mutar y confirmar**

Tres mutaciones, una a la vez:

1. Quitar la guarda `faltanCamposObligatorios` de `guardar()` → tiene que caer `'con campos obligatorios vacíos marca los campos y NO llama al servidor'`, **por la aserción de que no se llamó al servidor**. Confirma cuál cae.
2. Arrancar `mostrarObligatorios` en `true` → tiene que caer `'el formulario vacío no muestra ningún error antes de intentar guardar'`.
3. Mandar `formulario` en vez de `haciaElEncargo(formulario)` → tiene que caer `'guardar manda el encargo convertido a la forma del esquema'`.

- [ ] **Paso 7: la suite, el typecheck, el build y commit**

```bash
pnpm test && pnpm -r typecheck && pnpm --filter @gc/web build
```

```bash
git add apps/web/src/ && git commit -m "feat(web): el formulario del encargo del trimestre"
```

---

## Task 8: la página

**Archivos:**
- Modificar: `apps/web/src/app/(app)/[marca]/estrategia/page.tsx`
- Modificar: `apps/web/src/paginas.test.tsx`

**Interfaces:**
- Consume: `leerEncargo` de `@gc/operaciones` (Task 3) y `EditorDeEncargo` (Task 7).
- Produce: nada que otra tarea importe.

**La página ya distingue tres estados de la estrategia** —`ausente`, `invalida`, `valida`— y ya calcula `regenerable` y `enVuelo`. El encargo agrega una pregunta anterior a las tres. **No reestructures las ramas que ya existen**: agrega el bloque arriba y una condición al botón.

- [ ] **Paso 1: escribir las pruebas que fallan**

`apps/web/src/paginas.test.tsx` sustituye `@gc/operaciones` entero con un factory, y tiene un ayudante `renderEstrategia()` y un `corrida(...)`. **Primero agrega `leerEncargo` al factory**, o la página revienta al importarlo:

```ts
vi.mock('@gc/operaciones', () => ({
  corridaDe: vi.fn(),
  grillaDelMes: vi.fn(),
  estrategiaDelTrimestre: vi.fn(),
  perfilConHistorial: vi.fn(),
  leerEncargo: vi.fn(),
}))
```

**Y dale un valor por omisión en el `beforeEach` que ya existe**, con el encargo presente:

```ts
const ENCARGO_ESCRITO = {
  tipo: 'presente' as const,
  encargo: {
    objetivo: 'Vender las doce parcelas que quedan del loteo norte',
    comoSeMide: 'Formularios de contacto recibidos',
    publicacionesPorSemana: 4,
    canalesDisponibles: ['instagram', 'blog'],
    queEstaPasando: '', queFunciono: '', queNoFunciono: '', queEvitar: '', algoMas: '',
  },
}

// En el beforeEach:
vi.mocked(leerEncargo).mockResolvedValue(ENCARGO_ESCRITO)
```

Sin ese valor por omisión, **todas** las pruebas de estrategia que ya existen se pondrían rojas, y por el motivo equivocado: hablan de la puerta de la corrida viva, no de la del encargo. Con él siguen midiendo lo suyo.

Ahora agrega las tres pruebas nuevas, en un `describe` propio:

```tsx
describe('la puerta del encargo en la estrategia', () => {
  it('sin encargo no ofrece generar, y dice que falta escribirlo', async () => {
    // La barrera real vive en `encolarEstrategia`; esto evita ofrecer un botón
    // que sabemos que va a fallar un segundo después.
    vi.mocked(estrategiaDelTrimestre).mockResolvedValue({ tipo: 'ausente', periodo: '2026-Q4' })
    vi.mocked(corridaDe).mockResolvedValue(null)
    vi.mocked(leerEncargo).mockResolvedValue({ tipo: 'ausente' })

    await renderEstrategia()

    expect(screen.queryByRole('button', { name: 'Generar estrategia' })).toBeNull()
    expect(screen.queryByText(/escribe primero el encargo/i)).not.toBeNull()
  })

  it('con encargo escrito vuelve a ofrecer generar', async () => {
    vi.mocked(estrategiaDelTrimestre).mockResolvedValue({ tipo: 'ausente', periodo: '2026-Q4' })
    vi.mocked(corridaDe).mockResolvedValue(null)

    await renderEstrategia()

    expect(screen.queryByRole('button', { name: 'Generar estrategia' })).not.toBeNull()
  })

  it('con la estrategia fuera de borrador el encargo queda de solo lectura', async () => {
    // `archivada` y no `aprobada` a propósito: la condición correcta es «el
    // estado no es borrador», y con `aprobada` las dos redacciones coinciden.
    vi.mocked(estrategiaDelTrimestre).mockResolvedValue({
      ...ESTRATEGIA_EN_BORRADOR, estado: 'archivada',
    })
    vi.mocked(corridaDe).mockResolvedValue(null)

    await renderEstrategia()

    expect(screen.queryByRole('button', { name: 'Guardar el encargo' })).toBeNull()
  })
})
```

`ESTRATEGIA_EN_BORRADOR` ya existe en ese archivo. Si su forma no admite el `...spread` con `estado`, míralo y arma el objeto entero a mano con `estado: 'archivada'`.

- [ ] **Paso 2: correr y ver que fallan**

```bash
pnpm --filter @gc/web test -- paginas
```

- [ ] **Paso 3: implementar**

En la página, después de leer `resultado` y antes del `return`:

```tsx
  const encargo = await leerEncargo(db, organizationId, {
    slug: marca,
    periodo: resultado.periodo,
  })

  // El encargo se congela con la estrategia: la condición es «el estado no es
  // borrador», no «el estado es aprobada», porque una archivada tampoco se
  // regenera y su encargo tampoco tiene por qué cambiar.
  const encargoCongelado = resultado.tipo !== 'ausente' && resultado.estado !== 'borrador'

  // Sin encargo no se ofrece generar. La barrera real está en
  // `encolarEstrategia`, que falla con un `permanente`; esto solo evita
  // ofrecer un botón que sabemos que va a fallar.
  const hayEncargo = encargo.tipo === 'presente'
```

El bloque va como primer hijo del `<div className="p-6">`, después del `<h1>` y del `EstadoDeCorrida`:

```tsx
      <section className="mb-6">
        <h2 className="mb-1 text-sm font-semibold text-gray-700">El encargo del trimestre</h2>
        {encargo.tipo === 'invalido' ? (
          <p role="alert" className="rounded border border-red-300 bg-red-50 p-3 text-sm text-red-800">
            El encargo guardado para este periodo no cumple su esquema, así que no se puede
            mostrar. Vuelve a escribirlo.
          </p>
        ) : null}
        <EditorDeEncargo
          marca={marca}
          periodo={resultado.periodo}
          encargo={encargo.tipo === 'presente' ? encargo.encargo : null}
          soloLectura={encargoCongelado}
        />
      </section>
```

Y las **tres** apariciones de `<BotonGenerar ... que="estrategia">` ganan `hayEncargo &&` en su condición. En la rama `ausente`, el texto del estado vacío pasa a:

```tsx
          <p className="mb-3">
            La marca no tiene estrategia cargada para el trimestre {resultado.periodo}.
            {!hayEncargo && ' Escribe primero el encargo de arriba: la estrategia se genera a partir de él.'}
          </p>
```

**No agregues ni quites `export const dynamic = 'force-dynamic'`**: ya está en este archivo y tiene que seguir.

- [ ] **Paso 4: correr y ver que pasan**

```bash
pnpm --filter @gc/web test -- paginas
```

- [ ] **Paso 5: mutar y confirmar**

Dos mutaciones, una a la vez:

1. Quitar `hayEncargo &&` de la rama `ausente` → tiene que caer `'sin encargo no ofrece generar'`.
2. Cambiar `resultado.estado !== 'borrador'` por `resultado.estado === 'aprobada'` en `encargoCongelado` → tiene que caer `'con la estrategia fuera de borrador el encargo queda de solo lectura'`, que usa `archivada` justamente porque con `aprobada` las dos redacciones coinciden y la mutación pasaría inadvertida. Es el mismo error que la autorrevisión del spec ya atajó una vez.

- [ ] **Paso 6: la suite, el typecheck, el build y commit**

```bash
pnpm test && pnpm -r typecheck && pnpm --filter @gc/web build
```

El build tiene que seguir mostrando las cinco rutas del dominio con `ƒ` y no con `○`.

```bash
git add apps/web/src/ && git commit -m "feat(web): la página de estrategia pide el encargo antes de generar"
```

---

## Task 9: la deuda registrada y la verificación real

**Archivos:**
- Modificar: `docs/superpowers/specs/pendientes.md`

- [ ] **Paso 1: registrar lo que este bloque decidió no hacer**

En la sección **CI y web**, agrega dos entradas, con el tono del resto del documento:

1. **Que la estrategia respete la capacidad declarada se le pide al modelo y no lo exige nada.** Si el encargo dice 3 publicaciones por semana y el modelo propone 12, ninguna validación lo rechaza: se ve al leer el mix antes de aprobar. Se descartó validarlo porque sería una tercera lista de reglas sincronizada a mano con el esquema — las otras dos ya están registradas en este mismo documento. Lo que sí lo mitiga: la estrategia se muestra entera, canal por canal, antes de aprobarse.

2. **El encargo no tiene botón de «copiar prompt para IA», a diferencia del perfil.** Se aplazó a propósito: el patrón está probado y agregarlo es mecánico, pero si las nueve preguntas están mal redactadas el prompt solo multiplica el problema. Depende de la verificación del paso 3.

- [ ] **Paso 2: commit**

```bash
git add docs/superpowers/specs/pendientes.md && git commit -m "docs: lo que el encargo del trimestre dejó fuera a propósito"
```

- [ ] **Paso 3: la verificación que ninguna prueba reemplaza**

**La hace el dueño y es la única que prueba que el bloque sirvió.**

Con `docker compose up -d postgres` y `pnpm --filter @gc/web dev`:

1. En la estrategia de una marca sin encargo, **llenar los nueve campos** de principio a fin.
2. Generar la estrategia y leerla entera.
3. **Comparar contra una estrategia generada sin encargo.** La de `parcelas` en `2026-Q3` sirve: está en borrador y se generó antes de este bloque.

Lo que hay que responder:

- ¿El `mixDeCanales` respeta la capacidad y los canales que declaraste? Si los ignora, lo que falta son reglas más explícitas en el instructivo, no código.
- ¿Los `objetivos` usan la métrica que dijiste que podías medir?
- ¿Se nota la diferencia contra la estrategia sin encargo? **Si son parecidas, el prompt no está usando lo que escribiste**, y ese es el hallazgo más importante que puede dar esta verificación.
- ¿Escribir nueve campos se sintió un trámite o una ayuda? De eso depende si el botón de prompt para IA entra en el bloque siguiente.

---

## Autorrevisión de este plan

**Cobertura del spec:**

| Sección del spec | Tarea |
|---|---|
| Los nueve campos, cuatro obligatorios | Tasks 1 y 6 |
| `canalesDisponibles` sale de `CANALES` | Task 1 |
| La capacidad se pide y no se exige | Task 5 (instructivo) y Task 9 (registrada) |
| Tabla `strategy_briefs` con foránea compuesta | Task 2 |
| Migración `0007` sin envoltorio | Task 2 |
| El esquema Zod en `@gc/strategy` | Task 1 |
| Editar mientras la estrategia sea borrador; congelar después | Task 3, con dos pruebas y una mutación |
| Lo obligatorio se hace cumplir en `encolarEstrategia` | Task 4 |
| El encargo llega al modelo como sección propia | Task 5 |
| Dos reglas nuevas en el instructivo | Task 5 |
| El bloque en la página, con sus tres estados | Task 8 |
| El CLI falla con el mismo error | Task 4 — `estrategia:generar` pasa por `encolarEstrategia` |
| Las cinco capas de verificación | Tasks 1-8 y Task 9 paso 3 |

Sin huecos.

**Consistencia de nombres:** `Encargo` y `TipoEncargo` se producen en la Task 1 y se consumen con ese nombre en 3, 5, 6 y 7. `LecturaDeEncargo`, `leerEncargo` y `guardarEncargo` se producen en la Task 3 y se consumen en 4, 7 y 8. `EncargoEnFormulario`, `FORMULARIO_VACIO`, `desdeElEncargo`, `haciaElEncargo` y `faltanCamposObligatorios` se producen en la 6 y se consumen en la 7. Las etiquetas de los cuatro campos obligatorios están tabuladas en la Task 7 y son las que consultan sus pruebas.

**Dos avisos para quien ejecute, que no son descuidos:**

1. **La Task 4 rompe pruebas que ya existen** en `corridas.test.ts`, porque ninguna escribe un encargo antes de encolar. Está dicho en su paso 1: se arreglan sembrando el encargo, no debilitando la guarda.
2. **Dos mutaciones de este plan están escritas como preguntas abiertas** —la 2 de la Task 3 y la 5 de la Task 4— porque no sé de antemano si la cobertura existente ya las cubre. En los dos casos la instrucción es la misma: si ninguna prueba cae, eso **es** el hallazgo, y hay que agregar la prueba que falta o anotarlo en el reporte. No las trates como opcionales.

3. **La Task 8 tiene que tocar el factory de `vi.mock('@gc/operaciones')` antes que nada.** Ese archivo sustituye el paquete entero, así que una función nueva que la página importe y que el factory no declare hace fallar el import con un error que no menciona el factory. Está en su paso 1.
