# La pieza y su texto (bloque 2A) — plan de implementación

> **Para quien ejecute esto:** SUB-SKILL OBLIGATORIA: usa `superpowers:subagent-driven-development` (recomendada) o `superpowers:executing-plans` para implementar tarea por tarea. Los pasos usan casillas (`- [ ]`).

**Objetivo:** que una grilla aprobada produzca, con un botón, el texto de sus veinte piezas.

**Arquitectura:** un esquema Zod discriminado por canal; una tabla `content_pieces` con una fila por slot; un flujo P3 de dos pasos —modelo y persistencia— del que se encola **una corrida por pieza**, para que el aislamiento, el reintento y la reanudación salgan de la cola que ya existe.

**Tecnologías:** TypeScript ESM, Zod, Drizzle sobre Postgres, Next.js 15 App Router, React 19, Vitest 2.1.

**Spec:** [2026-08-14-piezas-y-su-texto-design.md](../specs/2026-08-14-piezas-y-su-texto-design.md)

---

## Restricciones globales

Cada una es regla del proyecto (`CLAUDE.md`) y aplica a **todas** las tareas:

- **`pnpm test` en la raíz, NUNCA `pnpm -r test`.** Postgres levantado: `docker compose up -d postgres`.
- **Idioma:** esquema y columnas de la base en inglés `snake_case`; API de dominio, variables, comentarios, **prompts** y **todo texto que ve el usuario**, en español neutro con «tú».
- **TypeScript ESM:** los imports relativos llevan extensión `.js`, también desde `.tsx`.
- **Una migración aplicada es inmutable**, y las nuevas van **sin** el envoltorio `DO $$ ... EXCEPTION`. **`drizzle-kit generate` no sirve en este repositorio** —faltan los snapshots desde la `0005`, ver `pendientes.md`—: la migración se escribe a mano con `0007_encargo_del_trimestre.sql` de plantilla.
- **Los enumerados se hacen cumplir con `CHECK`.**
- **La tenencia se verifica dentro de cada escritura**, y desde la base con claves foráneas compuestas.
- **El esquema Zod es la única autoridad de validación.** Ningún límite de caracteres se reproduce fuera de él — y en este bloque los límites **no están** en el esquema: viajan en el prompt como instrucción.
- **Ninguna salida del modelo se parsea con expresiones regulares.**
- **La capa web nunca ejecuta trabajo largo ni llama al modelo.**
- **Toda Server Action pasa por el ayudante `ejecutar`** de `apps/web/src/acciones.ts`.
- **Cada ruta de Next necesita su propio `force-dynamic`.**
- **P3 va partido en dos pasos, modelo y persistencia**, por lo mismo que P1 y P2: un fallo de base no puede recobrar una llamada al modelo ya pagada.
- **Una prueba que no puede fallar es peor que ninguna.** Cuatro históricas y dieciséis en los tres bloques anteriores. Cada prueba se valida rompiendo el código y exigiendo que se ponga roja **por la razón exacta**.

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
| `packages/strategy/src/pieza.ts` | los cinco esquemas del copy, discriminados por canal |
| `packages/strategy/src/pieza.test.ts` | pruebas de lo anterior |
| `packages/db/migraciones/0008_*.sql` | la tabla `content_pieces`, escrita a mano |
| `packages/operaciones/src/piezas.ts` | leer, guardar y resumir piezas |
| `packages/operaciones/src/piezas.test.ts` | pruebas de lo anterior |
| `packages/flujos/src/p3.ts` | el flujo de la pieza, en dos pasos |
| `packages/flujos/src/p3.test.ts` | pruebas de lo anterior |
| `packages/flujos/src/prompts/pieza-linkedin.md` | instructivo del canal |
| `packages/flujos/src/prompts/pieza-facebook.md` | ídem |
| `packages/flujos/src/prompts/pieza-instagram.md` | ídem |
| `packages/flujos/src/prompts/pieza-tiktok.md` | ídem |
| `packages/flujos/src/prompts/pieza-blog.md` | ídem |
| `apps/web/src/componentes/PiezaGenerada.tsx` | muestra la pieza dentro del panel de detalle |
| `apps/web/src/componentes/PiezaGenerada.test.tsx` | pruebas de lo anterior |

**Modificar:**

| Archivo | Cambio |
|---|---|
| `packages/strategy/src/index.ts` | exportar `./pieza.js` |
| `packages/db/src/esquema.ts` | tabla `contentPieces` |
| `packages/db/src/esquema.test.ts` | catálogo: 14 foráneas compuestas |
| `packages/operaciones/src/index.ts` | exportar `./piezas.js` |
| `packages/operaciones/src/corridas.ts` | `p3_pieza` en `FlujoEncolable`, su entrada en el mapa, y `encolarPiezas` |
| `packages/operaciones/src/corridas.test.ts` | pruebas de la guarda |
| `packages/flujos/src/index.ts` | exportar `crearFlujoPieza` |
| `apps/worker/src/flujos.ts` | registrar `p3_pieza` |
| `apps/web/src/acciones.ts` | `generarPiezasAccion` |
| `apps/web/src/app/(app)/[marca]/grilla/[mes]/page.tsx` | botón y resumen |
| `apps/web/src/componentes/PanelDeDetalle.tsx` | montar `PiezaGenerada` |
| `apps/web/src/paginas.test.tsx` | pruebas de la pantalla |
| `docs/superpowers/specs/pendientes.md` | lo que este bloque dejó fuera |

**Por qué los esquemas van en `@gc/strategy` y no en un paquete nuevo:** ese paquete ya contiene `SlotPropuesto` y `GrillaPropuesta`, que son cosas del plan de contenido y no de la estrategia, así que la pieza no desentona. Y `apps/web` ya lo declara, que es el requisito duro —la pantalla tiene que renderizar la pieza—. Un paquete nuevo costaría cableado de workspace, un volumen más en `docker-compose.yml` y ajustar `comprobar:volumenes`, que hoy afirma trece montajes. El nombre del paquete queda imperfecto; se anota en `pendientes.md` (Task 8).

---

## Task 1: los cinco esquemas del copy

**Archivos:**
- Crear: `packages/strategy/src/pieza.ts`
- Crear: `packages/strategy/src/pieza.test.ts`
- Modificar: `packages/strategy/src/index.ts`

**Interfaces:**
- Consume: `CANALES` de `@gc/db`.
- Produce, y lo consumen las Tasks 3, 5 y 7:

```ts
export const PiezaDeContenido: z.ZodDiscriminatedUnion<'canal', ...>
export type TipoPieza = z.infer<typeof PiezaDeContenido>
/** El esquema del canal, para pedírselo al modelo sin la envoltura del discriminante. */
export function esquemaDePieza(canal: Canal): z.ZodTypeAny
```

**El discriminante es `canal` y viaja dentro de `data`.** Es lo que permite validar una fila leída de la base sin consultar el slot, y lo que hace que `PiezaDeContenido.safeParse` rechace un `data` de LinkedIn guardado en una fila de Instagram.

- [ ] **Paso 1: escribir las pruebas que fallan**

Crea `packages/strategy/src/pieza.test.ts`:

```ts
import { describe, expect, it } from 'vitest'
import { PiezaDeContenido, esquemaDePieza } from './pieza.js'

const LINKEDIN = {
  canal: 'linkedin' as const,
  gancho: 'La mayoría de las flotas descubre el vencimiento cuando ya es multa.',
  cuerpo: 'Un párrafo que explica el problema y cómo se resuelve, con suficiente largo.',
  hashtags: ['gestiondeflota', 'tapcar'],
}

const BLOG = {
  canal: 'blog' as const,
  titulo: 'Cómo evitar multas por documentos vencidos',
  bajada: 'Una guía corta para quien administra una flota pequeña.',
  cuerpo: '## El problema\n\nTexto en Markdown con suficiente largo para ser un artículo.',
}

describe('PiezaDeContenido', () => {
  it('acepta una pieza de cada canal', () => {
    expect(PiezaDeContenido.safeParse(LINKEDIN).success).toBe(true)
    expect(PiezaDeContenido.safeParse(BLOG).success).toBe(true)
    expect(PiezaDeContenido.safeParse({
      canal: 'facebook', cuerpo: 'Un texto de largo suficiente para pasar.', hashtags: [],
    }).success).toBe(true)
    expect(PiezaDeContenido.safeParse({
      canal: 'instagram', caption: 'Un texto de largo suficiente.', hashtags: [], diapositivas: [],
    }).success).toBe(true)
    expect(PiezaDeContenido.safeParse({
      canal: 'tiktok', caption: 'Un texto corto.', guion: 'Lo que se dice, con largo suficiente.',
    }).success).toBe(true)
  })

  it('rechaza los campos de un canal en otro', () => {
    // Es el punto entero del discriminado: sin él, una pieza de LinkedIn
    // guardada en una fila de Instagram pasaría la validación y la pantalla
    // renderizaría campos vacíos sin decir por qué.
    expect(PiezaDeContenido.safeParse({ ...LINKEDIN, canal: 'instagram' }).success).toBe(false)
    expect(PiezaDeContenido.safeParse({ ...BLOG, canal: 'linkedin' }).success).toBe(false)
  })

  it('rechaza un canal que el sistema no publica', () => {
    expect(PiezaDeContenido.safeParse({ ...LINKEDIN, canal: 'podcast' }).success).toBe(false)
  })

  it('exige el gancho de LinkedIn, que es lo único que se ve antes de «ver más»', () => {
    const { gancho: _, ...sinGancho } = LINKEDIN
    expect(PiezaDeContenido.safeParse(sinGancho).success).toBe(false)
  })

  it('exige título y bajada en el blog', () => {
    const { titulo: _, ...sinTitulo } = BLOG
    expect(PiezaDeContenido.safeParse(sinTitulo).success).toBe(false)
    const { bajada: __, ...sinBajada } = BLOG
    expect(PiezaDeContenido.safeParse(sinBajada).success).toBe(false)
  })

  it('las diapositivas de Instagram pueden ir vacías', () => {
    // Se llenan solo cuando el formato del slot dice carrusel.
    expect(PiezaDeContenido.safeParse({
      canal: 'instagram', caption: 'Un texto de largo suficiente.', hashtags: [], diapositivas: [],
    }).success).toBe(true)
  })

  it('no impone ningún límite superior de caracteres', () => {
    // Los límites por canal viven en `validar(pieza)` del conector, en la
    // Fase 3, y en el prompt como instrucción. Ponerlos también acá sería la
    // cuarta lista de reglas sincronizada a mano de este repositorio.
    const largo = 'a'.repeat(20000)
    expect(PiezaDeContenido.safeParse({ ...LINKEDIN, cuerpo: largo }).success).toBe(true)
  })
})

describe('esquemaDePieza', () => {
  it('devuelve el esquema del canal, sin el discriminante', () => {
    // Es lo que se le pide al modelo: no tiene sentido que el modelo devuelva
    // el canal, que ya sabemos.
    const { canal: _, ...sinCanal } = LINKEDIN
    expect(esquemaDePieza('linkedin').safeParse(sinCanal).success).toBe(true)
  })

  it('el esquema de un canal rechaza la forma de otro', () => {
    const { canal: _, ...sinCanal } = BLOG
    expect(esquemaDePieza('linkedin').safeParse(sinCanal).success).toBe(false)
  })
})
```

- [ ] **Paso 2: correr y ver que fallan**

```bash
pnpm --filter @gc/strategy test -- pieza
```

Esperado: todas fallan con `Failed to resolve import "./pieza.js"`.

- [ ] **Paso 3: escribir los esquemas**

Crea `packages/strategy/src/pieza.ts`:

```ts
import { CANALES, type Canal } from '@gc/db'
import { z } from 'zod'

/**
 * El texto de una pieza, con una forma por canal.
 *
 * Cinco formas y no una común, a propósito: un prompt que sabe que está
 * escribiendo para LinkedIn escribe mejor que uno genérico, y los campos que
 * importan difieren de verdad —el `gancho` de LinkedIn es la primera línea, lo
 * único que se ve antes de «ver más»; el blog necesita título y bajada—.
 *
 * El costo aceptado: cinco esquemas y cinco prompts que mantener.
 *
 * **Ningún campo lleva límite superior de caracteres.** Los límites por canal
 * viven donde el diseño general los puso: `validar(pieza)` en la interfaz del
 * conector, que corre antes de generar e informa al generador. Repetirlos acá
 * sería la cuarta lista de reglas sincronizada a mano de este repositorio —
 * `pendientes.md` ya registra tres—. En este bloque viajan en el prompt como
 * instrucción, y un copy demasiado largo se ve al leerlo.
 */

const cuerpoLargo = z.string().min(20)
const textoCorto = z.string().min(10)
const hashtags = z.array(z.string().min(2))

const FORMAS = {
  linkedin: { gancho: textoCorto, cuerpo: cuerpoLargo, hashtags },
  facebook: { cuerpo: cuerpoLargo, hashtags },
  instagram: { caption: cuerpoLargo, hashtags, diapositivas: z.array(z.string().min(2)) },
  tiktok: { caption: textoCorto, guion: cuerpoLargo },
  blog: { titulo: textoCorto, bajada: textoCorto, cuerpo: cuerpoLargo },
} as const satisfies Record<Canal, z.ZodRawShape>

/**
 * El esquema del canal **sin** el discriminante: es lo que se le pide al
 * modelo, que no tiene por qué devolver el canal, que ya sabemos.
 */
export function esquemaDePieza(canal: Canal): z.ZodTypeAny {
  return z.object(FORMAS[canal]).strict()
}

/**
 * La pieza tal como se guarda: la forma del canal más el canal adentro.
 *
 * El discriminante viaja **dentro de `data`** y no solo en la columna, para
 * que validar una fila leída de la base no exija consultar su slot — y para
 * que una pieza de LinkedIn guardada en una fila de Instagram se rechace en
 * vez de renderizarse con los campos vacíos.
 */
export const PiezaDeContenido = z.discriminatedUnion(
  'canal',
  CANALES.map((canal) =>
    z.object({ canal: z.literal(canal), ...FORMAS[canal] }).strict(),
  ) as unknown as [z.ZodObject<z.ZodRawShape>, ...z.ZodObject<z.ZodRawShape>[]],
)

export type TipoPieza = z.infer<typeof PiezaDeContenido>
```

Y agrega a `packages/strategy/src/index.ts`, en orden alfabético:

```ts
export * from './pieza.js'
```

**Si el `as unknown as` del `discriminatedUnion` no compila con la versión de Zod del proyecto**, escribe la unión con las cinco variantes literales en vez de derivarlas de `CANALES` — y **dilo en el reporte**, porque entonces la lista de canales queda escrita dos veces y eso es deuda que hay que registrar.

- [ ] **Paso 4: correr y ver que pasan**

```bash
pnpm --filter @gc/strategy test -- pieza
```

- [ ] **Paso 5: mutar y confirmar**

Tres mutaciones, una a la vez, revirtiendo entre cada una:

1. Quitar `.strict()` de las variantes → tiene que caer `'rechaza los campos de un canal en otro'`. Sin `strict`, los campos de más se ignoran y `{...BLOG, canal:'linkedin'}` pasaría si el blog tuviera los campos de LinkedIn; comprueba cuál de las dos aserciones cae y dilo.
2. Hacer `gancho` opcional → tiene que caer `'exige el gancho de LinkedIn'`.
3. Agregar `.max(3000)` a `cuerpoLargo` → tiene que caer `'no impone ningún límite superior'`.

- [ ] **Paso 6: la suite, el typecheck y commit**

```bash
pnpm test && pnpm -r typecheck
```

```bash
git add packages/strategy/src/ && git commit -m "feat(strategy): los cinco esquemas del copy, uno por canal"
```

---

## Task 2: la tabla

**Archivos:**
- Modificar: `packages/db/src/esquema.ts`
- Modificar: `packages/db/src/esquema.test.ts`
- Crear: `packages/db/migraciones/0008_piezas_de_contenido.sql`

**Interfaces:**
- Produce, y lo consumen las Tasks 3 y 5: `esquema.contentPieces`.

- [ ] **Paso 1: escribir las pruebas que fallan**

Agrega a `packages/db/src/esquema.test.ts`:

```ts
describe('content_pieces', () => {
  it('tiene la única por slot y la foránea compuesta', async () => {
    await conBaseDeDatosDePrueba(async (db) => {
      const filas = await db.execute(sql`
        select conname from pg_constraint where conrelid = 'content_pieces'::regclass
      `)
      const nombres = filas.rows.map((f) => String(f.conname))
      expect(nombres).toContain('content_pieces_plan_slot_id_unique')
      expect(nombres).toContain('content_pieces_slot_org_fk')
      expect(nombres).toContain('content_pieces_channel_check')
    })
  })

  it('rechaza una pieza cuyo slot es de otra organización', async () => {
    await conBaseDeDatosDePrueba(async (db) => {
      const { slotId } = await sembrarSlot(db)
      const [otra] = await db.insert(esquema.organizations)
        .values({ name: 'B', slug: 'b' }).returning()

      await expect(
        db.insert(esquema.contentPieces).values({
          organizationId: otra!.id, planSlotId: slotId, channel: 'linkedin',
          data: {}, brandProfileVersion: 1,
        }),
      ).rejects.toThrow()
    })
  })

  it('rechaza un canal fuera del enumerado', async () => {
    await conBaseDeDatosDePrueba(async (db) => {
      const { slotId, organizationId } = await sembrarSlot(db)
      await expect(
        db.execute(sql`
          insert into content_pieces (organization_id, plan_slot_id, channel, data, brand_profile_version)
          values (${organizationId}, ${slotId}, 'podcast', '{}'::jsonb, 1)
        `),
      ).rejects.toThrow()
    })
  })

  it('un slot no puede tener dos piezas', async () => {
    await conBaseDeDatosDePrueba(async (db) => {
      const { slotId, organizationId } = await sembrarSlot(db)
      const fila = {
        organizationId, planSlotId: slotId, channel: 'linkedin' as const,
        data: {}, brandProfileVersion: 1,
      }
      await db.insert(esquema.contentPieces).values(fila)
      await expect(db.insert(esquema.contentPieces).values(fila)).rejects.toThrow()
    })
  })
})
```

**`sembrarSlot` es un ayudante nuevo** de ese mismo archivo: crea organización, marca, plan y un slot, y devuelve `{ organizationId, slotId }`. Escríbelo siguiendo el estilo de los sembradores que el archivo ya tiene; mira cómo crean `content_plans` y `plan_slots` las pruebas de catálogo existentes para copiar los campos obligatorios (`scheduledFor`, `channel`, `format`, `pillar`, `angle`, `brief`).

- [ ] **Paso 2: correr y ver que fallan**

```bash
pnpm --filter @gc/db test -- esquema
```

Esperado: las cuatro fallan, la primera con `relation "content_pieces" does not exist`.

- [ ] **Paso 3: agregar la tabla**

En `packages/db/src/esquema.ts`, después del bloque `planSlots`:

```ts
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
```

Agrégala también al objeto `esquema` que el archivo exporta al final.

- [ ] **Paso 4: escribir la migración a mano**

**No corras `drizzle-kit generate`**: está roto en este repositorio desde la `0005` —faltan los snapshots— y produce una migración que toca cinco tablas ajenas. `pendientes.md` lo registra con el síntoma exacto.

Crea `packages/db/migraciones/0008_piezas_de_contenido.sql` copiando el estilo de `0007_encargo_del_trimestre.sql`: mayúsculas del SQL, comillas dobles en los identificadores, `--> statement-breakpoint` entre sentencias, **sin** envoltorio `DO $$ ... EXCEPTION`. Tiene que crear la tabla con:

- las siete columnas,
- la clave primaria,
- la única sobre `plan_slot_id`, con nombre `content_pieces_plan_slot_id_unique`,
- la foránea simple a `organizations` con `ON DELETE cascade`,
- la foránea compuesta `content_pieces_slot_org_fk` sobre `(plan_slot_id, organization_id)` a `plan_slots(id, organization_id)` con `ON DELETE cascade`,
- el `CHECK` `content_pieces_channel_check` con los cinco canales.

Y agrega la entrada al `_journal.json`: `idx: 8`, `version: "7"`, `tag: "0008_piezas_de_contenido"`, `breakpoints: true`, `when` mayor que el de la `0007`.

**No generes ni commitees ningún snapshot.**

- [ ] **Paso 5: aplicar y correr**

```bash
pnpm --filter @gc/db test -- esquema
```

El catálogo de foráneas compuestas pasa de trece a **catorce**. Esa prueba compara por igualdad exacta: agrega la entrada nueva en la posición que le corresponde según el `ORDER BY` de su consulta, y **actualiza los conteos que el archivo menciona en comentarios y en nombres de prueba** — este repositorio ya hizo un commit entero para que esos números digan la verdad.

- [ ] **Paso 6: mutar y confirmar**

Dos mutaciones, una a la vez, sobre el `.sql`, aplicando contra una base limpia:

1. Quitar la foránea compuesta → tiene que caer `'rechaza una pieza cuyo slot es de otra organización'`.
2. Quitar el `CHECK` del canal → tiene que caer `'rechaza un canal fuera del enumerado'`. Es la que prueba que `text(col, { enum })` de Drizzle **no** genera restricción y por eso el `CHECK` explícito hace falta.

- [ ] **Paso 7: la suite, el typecheck y commit**

```bash
pnpm test && pnpm -r typecheck
```

```bash
git add packages/db/ && git commit -m "feat(db): la tabla de las piezas de contenido"
```

---

## Task 3: leer, guardar y resumir piezas

**Archivos:**
- Crear: `packages/operaciones/src/piezas.ts`
- Crear: `packages/operaciones/src/piezas.test.ts`
- Modificar: `packages/operaciones/src/index.ts`

**Interfaces:**
- Consume: `PiezaDeContenido`, `TipoPieza` de `@gc/strategy` (Task 1); `esquema.contentPieces` (Task 2); `resolverMarca` y `validarMes`, que ya existen.
- Produce, y lo consumen las Tasks 4, 6 y 7:

```ts
export interface ResumenDePiezas {
  /** Slots no descartados del mes. */
  total: number
  /** Cuántos ya tienen pieza. */
  listas: number
  /** Corridas de `p3_pieza` del mes que terminaron fallidas. */
  fallidas: number
  /** Corridas de `p3_pieza` del mes todavía vivas. */
  enVuelo: number
}

export async function resumenDePiezas(
  db: BaseDeDatos, organizationId: string, args: { slug: string; mes: string },
): Promise<ResumenDePiezas>

export async function piezasDelMes(
  db: BaseDeDatos, organizationId: string, args: { slug: string; mes: string },
): Promise<Map<string, TipoPieza>>
```

`piezasDelMes` devuelve un mapa **de `planSlotId` a pieza**, para que la pantalla pinte cada slot sin una consulta por slot. Una fila cuyo `data` no valide **se omite del mapa** y no rompe la página: es el mismo criterio con el que `estrategiaDelTrimestre` distingue una estrategia inválida de una ausente, pero acá no hay pantalla que lo explique todavía, así que omitir es lo honesto — y queda anotado en `pendientes.md` (Task 8).

**Los cuatro números del resumen existen para distinguir tres casos que se parecen**, y el spec lo exige: ninguna encolada todavía, todas listas, y algunas fallidas. Un resumen que los confunda es peor que no tenerlo.

- [ ] **Paso 1: escribir las pruebas que fallan**

Crea `packages/operaciones/src/piezas.test.ts` con estas ocho, usando `conBaseDeDatosDePrueba` y un sembrador propio que cree organización, marca, plan aprobado y **tres** slots (uno de ellos `descartado`):

```ts
describe('resumenDePiezas', () => {
  it('cuenta los slots no descartados como total', async () => { /* total === 2, no 3 */ })
  it('sin ninguna pieza, listas es cero', async () => { /* listas === 0 */ })
  it('cuenta las piezas escritas', async () => { /* tras guardar una: listas === 1 */ })
  it('cuenta las corridas fallidas del mes', async () => { /* fallidas === 1 */ })
  it('cuenta las corridas vivas del mes', async () => { /* enVuelo === 1 */ })
  it('no cuenta corridas de otro mes ni de otro flujo', async () => { /* ambos en 0 */ })
})

describe('piezasDelMes', () => {
  it('devuelve un mapa de slot a pieza', async () => { /* mapa.get(slotId) */ })
  it('omite una fila cuyo data no valida, sin lanzar', async () => { /* tamaño 0, sin throw */ })
})
```

**Escribe el cuerpo de las ocho**, con el mismo estilo que `packages/operaciones/src/encargos.test.ts`: sembrar con `db.insert`, llamar a la operación, afirmar sobre el resultado. Para las corridas, inserta filas en `pipeline_runs` con `flow: 'p3_pieza'` y el `input` que la Task 4 define — `{ slotId, mes, brandId }` —, con `status` `'fallido'` y `'en_curso'` respectivamente.

- [ ] **Paso 2: correr y ver que fallan**

```bash
pnpm --filter @gc/operaciones test -- piezas
```

- [ ] **Paso 3: implementar**

Crea `packages/operaciones/src/piezas.ts`. `resumenDePiezas` resuelve la marca, valida el mes, y hace **tres** consultas: los slots no descartados del plan del mes, las piezas de esos slots, y las corridas de `p3_pieza` de ese mes agrupadas por estado. `piezasDelMes` hace una y valida cada `data` con `PiezaDeContenido.safeParse`, omitiendo las que no pasen.

Las dos filtran por `organizationId` además de por la marca resuelta, siguiendo el patrón de `encargos.ts`.

Agrega a `packages/operaciones/src/index.ts`:

```ts
export * from './piezas.js'
```

- [ ] **Paso 4: correr y ver que pasan**

```bash
pnpm --filter @gc/operaciones test -- piezas
```

- [ ] **Paso 5: mutar y confirmar**

Tres mutaciones, una a la vez:

1. Contar también los slots `descartado` en `total` → tiene que caer `'cuenta los slots no descartados'`.
2. Quitar el filtro por mes de la consulta de corridas → tiene que caer `'no cuenta corridas de otro mes ni de otro flujo'`.
3. Hacer que `piezasDelMes` use `parse` en vez de `safeParse` → tiene que caer `'omite una fila cuyo data no valida, sin lanzar'`, y **por el lanzamiento**, no por el tamaño. Confirma cuál.

- [ ] **Paso 6: la suite, el typecheck y commit**

```bash
pnpm test && pnpm -r typecheck
```

```bash
git add packages/operaciones/src/ && git commit -m "feat(operaciones): leer, guardar y resumir las piezas de un mes"
```

---

## Task 4: encolar las piezas

**Archivos:**
- Modificar: `packages/operaciones/src/corridas.ts`
- Modificar: `packages/operaciones/src/corridas.test.ts`

**Interfaces:**
- Consume: `resumenDePiezas` de `./piezas.js` (Task 3).
- Produce, y lo consume la Task 6:

```ts
export async function encolarPiezas(
  db: BaseDeDatos, organizationId: string, args: { slug: string; mes: string },
): Promise<{ encoladas: number }>
```

**Tres cambios en `corridas.ts`, y el primero fuerza al segundo:**

1. `FlujoEncolable` gana `'p3_pieza'`.
2. `PERIODO_EN_LA_ENTRADA` es un `satisfies Record<FlujoEncolable, unknown>`, así que **el typecheck exige la entrada nueva**. Su `clave` es `'mes'` y su `coincide` compara `input->>'mes'`, igual que la grilla; su `genera` es `'las piezas'`.
3. `encolarPiezas`, que **no** usa el ayudante `encolar` existente.

**Por qué no usa `encolar`:** ese ayudante rechaza una segunda corrida viva de la misma marca, flujo y periodo — exactamente lo que aquí hay que permitir, porque veinte piezas del mismo mes son veinte corridas del mismo flujo y el mismo mes. La guarda equivalente para piezas es **por slot**: no encolar una pieza que ya tiene corrida viva, y no encolar la de un slot que ya tiene pieza.

- [ ] **Paso 1: escribir las pruebas que fallan**

Agrega a `packages/operaciones/src/corridas.test.ts` un `describe('encolarPiezas')` con:

```ts
it('se niega si la grilla no está aprobada', /* rejects.toThrow(/aprobada|borrador/i) y 0 corridas */)
it('encola una corrida por slot no descartado', /* encoladas === 2, y 2 filas en pipeline_runs */)
it('no encola los slots que ya tienen pieza', /* tras guardar una: encoladas === 1 */)
it('no encola un slot que ya tiene una corrida viva', /* encoladas === 0 */)
it('la entrada de cada corrida lleva slotId, mes y brandId', /* input de la fila */)
it('un mes mal formado se rechaza antes de tocar la base', /* rejects, 0 filas */)
```

Escribe el cuerpo de las seis con el estilo del archivo.

- [ ] **Paso 2: correr y ver que fallan**

```bash
pnpm --filter @gc/operaciones test -- corridas
```

- [ ] **Paso 3: implementar**

`encolarPiezas`: valida el mes, resuelve la marca, carga el plan del mes y **exige `status === 'aprobada'`** con un `permanente` que nombre el remedio; lista los slots no descartados sin pieza y sin corrida viva; inserta una fila de `pipeline_runs` por cada uno con `flow: 'p3_pieza'` e `input: { slotId, mes, brandId }`; devuelve cuántas encoló.

El mensaje de la guarda tiene que decir **qué hacer**: aprobar la grilla primero, y por qué —generar sobre un borrador invita a regenerar la grilla después y tirar textos ya pagados—.

- [ ] **Paso 4: correr y ver que pasan**

```bash
pnpm --filter @gc/operaciones test -- corridas
```

- [ ] **Paso 5: mutar y confirmar**

Tres mutaciones, una a la vez:

1. Quitar la guarda de `aprobada` → tiene que caer `'se niega si la grilla no está aprobada'`.
2. Encolar también los slots con pieza → tiene que caer `'no encola los slots que ya tienen pieza'`.
3. Quitar la entrada de `p3_pieza` de `PERIODO_EN_LA_ENTRADA` → **tiene que fallar el typecheck**, no una prueba. Corre `pnpm --filter @gc/operaciones typecheck` y confirma que se queja. Es la garantía de que agregar un flujo no puede olvidar ese mapa.

- [ ] **Paso 6: la suite, el typecheck y commit**

```bash
pnpm test && pnpm -r typecheck
```

```bash
git add packages/operaciones/src/ && git commit -m "feat(operaciones): encolar una corrida por pieza, con la grilla aprobada"
```

---

## Task 5: el flujo P3 y los cinco prompts

**Archivos:**
- Crear: `packages/flujos/src/p3.ts`
- Crear: `packages/flujos/src/p3.test.ts`
- Crear: los cinco `packages/flujos/src/prompts/pieza-<canal>.md`
- Modificar: `packages/flujos/src/index.ts`
- Modificar: `apps/worker/src/flujos.ts`

**Interfaces:**
- Consume: `esquemaDePieza`, `TipoPieza` de `@gc/strategy` (Task 1); `esquema.contentPieces` (Task 2).
- Produce, y lo consume el worker:

```ts
export function crearFlujoPieza(deps: Dependencias): DefinicionDeFlujo
export interface EntradaP3 { slotId: string; mes: string; brandId: string }
```

**Dos pasos**, como P1 y P2, y por el mismo motivo:

1. **`generar_copy`** — carga el slot, el perfil vigente y la estrategia del trimestre que contiene el mes; comprueba el presupuesto; llama al modelo con `esquemaDePieza(canal)`.
2. **`persistir_pieza`** — `onConflictDoUpdate` sobre `plan_slot_id`.

**El nivel del modelo es `redaccion`**, no `razonamiento`. Es la primera vez que este proyecto usa ese nivel: `MODELO_REDACCION` está declarada en `.env.example` y hoy **vacía**, así que hay que cargarla o P3 falla con «Falta la variable de entorno MODELO_REDACCION». Dilo en el reporte.

- [ ] **Paso 1: escribir las pruebas que fallan**

Crea `packages/flujos/src/p3.test.ts`, siguiendo el arnés de `p1.test.ts` (`ClienteFalso`, `conBaseDeDatosDePrueba`, `ejecutarFlujo`, `SIN_ESPERA`). Seis pruebas:

```ts
it('genera y persiste la pieza del slot', /* la fila existe, con el canal del slot */)
it('manda al modelo el contexto de marca, la estrategia y el ángulo y el brief del slot', /* el mensaje del usuario los contiene */)
it('usa el instructivo del canal del slot', /* el mensaje de sistema de un slot de blog difiere del de uno de linkedin */)
it('un fallo al persistir no vuelve a llamar al modelo', /* reanudar: cliente.peticiones sigue en 1 */)
it('regenerar reemplaza la pieza en vez de duplicarla', /* una sola fila */)
it('se niega, sin llamar al modelo, si el slot no existe', /* peticiones en 0 */)
```

Escribe el cuerpo de las seis. Para la cuarta, mira cómo `p1.test.ts` o `p2.test.ts` ejercitan la reanudación con un fallo de persistencia; si no existe ese patrón, dilo en el reporte y cubre lo que puedas.

- [ ] **Paso 2: correr y ver que fallan**

```bash
pnpm --filter @gc/flujos test -- p3
```

- [ ] **Paso 3: escribir los cinco instructivos**

Cada `pieza-<canal>.md` es el mensaje de sistema de ese canal. Todos comparten la forma: quién eres, las reglas del canal, y «responde únicamente con el JSON que cumple el esquema solicitado». Lo que cambia es el cuerpo. **Escríbelos en español neutro con «tú»**, y que cada uno diga:

- **LinkedIn:** el `gancho` es la primera línea y lo único visible antes de «ver más»; tono profesional sin solemnidad; tres a cinco hashtags; nada de emojis decorativos.
- **Facebook:** más conversacional que LinkedIn; hashtags solo si aportan, y pueden ir vacíos.
- **Instagram:** el `caption` abre con lo que engancha; hasta treinta hashtags; llena `diapositivas` **solo** si el formato del slot dice carrusel, con una idea por diapositiva y textos cortos.
- **TikTok:** el `caption` es corto; el `guion` es lo que se dice o se muestra, en segundos, pensado para grabarlo con un teléfono.
- **Blog:** `titulo` claro y sin clickbait; `bajada` de una o dos frases que funcione como meta descripción; `cuerpo` en Markdown con subtítulos.

Los cinco tienen que decir, además, que **respeten el léxico prohibido de la marca sin excepción** y que **no inventen datos, cifras ni casos de éxito** — son las dos reglas que el instructivo de la estrategia ya lleva y que valen igual acá.

Los límites de largo van **como instrucción** en cada instructivo, no en el esquema.

- [ ] **Paso 4: implementar el flujo**

`p3.ts`, siguiendo la forma de `p1.ts`: `definirTarea` con `nivel: 'redaccion'` y el esquema del canal, los dos pasos con su `versionDeSalida` explícita, y el mensaje de usuario armado con `contextoDeMarca(perfil)`, la estrategia y una sección con el slot —canal, formato, pilar, fecha, ángulo y brief—.

**El instructivo se elige por el canal del slot**, leyendo el `.md` correspondiente con `readFile`, igual que hace `p1.ts`.

Registra el flujo en `packages/flujos/src/index.ts` y en `apps/worker/src/flujos.ts`:

```ts
if (nombre === 'p3_pieza') return crearFlujoPieza(deps)
```

- [ ] **Paso 5: correr y ver que pasan**

```bash
pnpm --filter @gc/flujos test -- p3
```

- [ ] **Paso 6: mutar y confirmar**

Tres mutaciones, una a la vez:

1. Usar siempre el instructivo de LinkedIn → tiene que caer `'usa el instructivo del canal del slot'`.
2. Quitar el ángulo y el brief del mensaje → tiene que caer `'manda al modelo el contexto de marca…'`. **Afirma sobre el texto del ángulo sembrado, no sobre un fragmento corto**: este repositorio ya se comió una aserción sobre `'4'` que calzaba con `2026-Q4`.
3. Juntar los dos pasos en uno → tiene que caer `'un fallo al persistir no vuelve a llamar al modelo'`.

- [ ] **Paso 7: la suite, el typecheck y commit**

```bash
pnpm test && pnpm -r typecheck
```

```bash
git add packages/flujos/src/ apps/worker/src/ && git commit -m "feat(flujos): P3 escribe el copy de una pieza, con un instructivo por canal"
```

---

## Task 6: el botón y el resumen

**Archivos:**
- Modificar: `apps/web/src/acciones.ts`
- Modificar: `apps/web/src/app/(app)/[marca]/grilla/[mes]/page.tsx`
- Modificar: `apps/web/src/paginas.test.tsx`

**Interfaces:**
- Consume: `encolarPiezas` (Task 4) y `resumenDePiezas` (Task 3).
- Produce:

```ts
export async function generarPiezasAccion(
  slug: string, mes: string,
): Promise<Resultado<{ encoladas: number }>>
```

**La acción pasa por el ayudante `ejecutar`**, como las otras diez: una que no lo use nace sin comprobación de sesión. Y llama a `despertarWorker` después de encolar, como hacen las otras acciones que encolan.

**`paginas.test.tsx` sustituye `@gc/operaciones` entero con un factory de `vi.mock`.** Agrega `resumenDePiezas` **y** dale un valor por omisión en el `beforeEach`, o todas las pruebas de la grilla que ya existen se ponen rojas por el motivo equivocado. Hazlo antes de tocar la página.

- [ ] **Paso 1: escribir las pruebas que fallan**

Cuatro pruebas nuevas en `paginas.test.tsx`, en su propio `describe`:

```ts
it('con la grilla en borrador no ofrece generar las piezas', /* botón ausente */)
it('con la grilla aprobada y ninguna pieza, ofrece generar', /* botón presente */)
it('mientras hay corridas en vuelo dice cuántas van', /* texto con «de» y los dos números */)
it('con todas las piezas listas no ofrece generar y lo dice', /* botón ausente, texto de completo */)
```

Y una quinta que distinga el caso que el spec marcó como el más fácil de arruinar:

```ts
it('distingue «ninguna encolada» de «todas listas»', /* los dos textos son distintos */)
```

- [ ] **Paso 2: correr y ver que fallan**

```bash
pnpm --filter @gc/web test -- paginas
```

- [ ] **Paso 3: implementar**

La Server Action, con la forma de `encolarGrillaAccion` — mírala en `acciones.ts` y sigue su patrón, incluido el `despertarWorker`.

En la página: leer `resumenDePiezas`, y renderizar según el resumen. El botón aparece cuando el plan está `aprobada` **y** `listas + enVuelo < total`. El texto del avance distingue los tres casos:

- `enVuelo > 0` → «Escribiendo las piezas: N de M listas» (más «, K fallaron» si `fallidas > 0`);
- `listas === total && total > 0` → «Las M piezas están escritas»;
- `listas === 0 && enVuelo === 0` → nada más que el botón.

- [ ] **Paso 4: correr y ver que pasan**

```bash
pnpm --filter @gc/web test -- paginas
```

- [ ] **Paso 5: mutar y confirmar**

Dos mutaciones, una a la vez:

1. Ofrecer el botón con la grilla en borrador → tiene que caer la primera.
2. Usar el mismo texto para «ninguna encolada» y «todas listas» → tiene que caer la quinta.

- [ ] **Paso 6: la suite, el typecheck, el build y commit**

```bash
pnpm test && pnpm -r typecheck && pnpm --filter @gc/web build
```

Las cinco rutas del dominio siguen con `ƒ`.

```bash
git add apps/web/src/ && git commit -m "feat(web): generar las piezas de un mes desde la grilla"
```

---

## Task 7: la pieza en el panel de detalle

**Archivos:**
- Crear: `apps/web/src/componentes/PiezaGenerada.tsx`
- Crear: `apps/web/src/componentes/PiezaGenerada.test.tsx`
- Modificar: `apps/web/src/componentes/PanelDeDetalle.tsx`
- Modificar: `apps/web/src/app/(app)/[marca]/grilla/[mes]/page.tsx`

**Interfaces:**
- Consume: `TipoPieza` de `@gc/strategy` (Task 1) y `piezasDelMes` (Task 3).
- Produce: nada que otra tarea importe.

**`PiezaGenerada` es de solo lectura.** Editar es 2C. Lleva un botón de copiar con el mismo manejo del fallo del portapapeles que `EditorDePerfil` ya resolvió: `navigator.clipboard` exige contexto seguro y puede estar denegado, así que el texto queda seleccionable y el fallo se informa.

**Importa `TipoPieza` de `@gc/strategy`, no de `@gc/db`.** Este es un componente de cliente, y el barril de `@gc/db` arrastra el conector de Cloud SQL al bundle del navegador — ya pasó una vez en el bloque anterior. Si necesitas el tipo `Canal`, es `@gc/db/canales`.

- [ ] **Paso 1: escribir las pruebas que fallan**

`PiezaGenerada.test.tsx`, con `// @vitest-environment jsdom` y `afterEach(cleanup)` (el paquete no usa `globals: true`, y no tiene `@testing-library/jest-dom`: afirma leyendo el elemento):

```ts
it('muestra los campos de LinkedIn, con el gancho aparte', /* gancho, cuerpo y hashtags visibles */)
it('muestra los campos del blog', /* titulo, bajada, cuerpo */)
it('no muestra las diapositivas cuando van vacías', /* ausentes */)
it('copiar pone el texto completo en el portapapeles', /* espía de writeText, argumento con gancho y cuerpo */)
it('si el portapapeles falla lo dice y el texto sigue en pantalla', /* role=alert, cuerpo visible */)
```

- [ ] **Paso 2: correr y ver que fallan**

```bash
pnpm --filter @gc/web test -- PiezaGenerada
```

- [ ] **Paso 3: implementar**

`PiezaGenerada` recibe `{ pieza: TipoPieza }` y renderiza según `pieza.canal`, con un `switch` exhaustivo — que TypeScript comprueba, porque el tipo es una unión discriminada. Cada campo con su etiqueta en español.

El botón arma el texto plano del canal —para LinkedIn, gancho más línea en blanco más cuerpo más hashtags— y lo copia.

En `PanelDeDetalle`, montar `PiezaGenerada` bajo el brief cuando la prop `pieza` no sea `undefined`; la página se la pasa desde el mapa de `piezasDelMes`.

- [ ] **Paso 4: correr y ver que pasan**

```bash
pnpm --filter @gc/web test -- PiezaGenerada
```

- [ ] **Paso 5: mutar y confirmar**

Dos mutaciones, una a la vez:

1. Renderizar siempre la forma de LinkedIn → tiene que caer `'muestra los campos del blog'`.
2. Copiar solo el cuerpo → tiene que caer `'copiar pone el texto completo'`, **por el gancho**.

- [ ] **Paso 6: la suite, el typecheck, el build y commit**

```bash
pnpm test && pnpm -r typecheck && pnpm --filter @gc/web build
```

```bash
git add apps/web/src/ && git commit -m "feat(web): el panel de un slot muestra su pieza generada"
```

---

## Task 8: la deuda registrada y la verificación real

**Archivos:**
- Modificar: `docs/superpowers/specs/pendientes.md`

- [ ] **Paso 1: registrar lo que este bloque dejó**

Cuatro entradas, en la sección **CI y web** o donde encajen mejor, con el tono del documento:

1. **Los esquemas de las piezas viven en `@gc/strategy`, cuyo nombre ya no describe lo que contiene.** Ese paquete tiene la estrategia, los periodos, el encargo, `SlotPropuesto`, `GrillaPropuesta` y ahora las cinco formas del copy. Se decidió no crear un paquete nuevo porque costaría cableado de workspace, un volumen más en `docker-compose.yml` y ajustar `comprobar:volumenes`. Renombrarlo es barato hoy y más caro cada bloque.
2. **`piezasDelMes` omite en silencio una fila cuyo `data` no valida.** No lanza y no avisa: la pantalla simplemente no muestra esa pieza. Es lo honesto mientras no haya dónde explicarlo, pero cuando llegue el editor (2C) conviene el trato de tres estados que ya usan la estrategia y el encargo.
3. **`MODELO_REDACCION` es la primera variable de nivel que este proyecto usa además de `MODELO_RAZONAMIENTO`**, y hay que cargarla en el `.env`, en Cloud Run y en ningún lado más — la web no llama al modelo.
4. **`content_revisions` no existe todavía**, así que regenerar una pieza pierde la anterior sin registro. Es correcto en 2A —no hay edición humana que registrar— y deja de serlo en cuanto exista el editor.

- [ ] **Paso 2: commit**

```bash
git add docs/superpowers/specs/pendientes.md && git commit -m "docs: lo que el bloque de las piezas dejó fuera a propósito"
```

- [ ] **Paso 3: la verificación que ninguna prueba reemplaza**

**La hace el dueño y es la única que dice si el bloque sirvió.**

1. Aprobar la grilla de un mes de una marca real.
2. Apretar «Generar las piezas» y esperar los dos turnos del worker.
3. **Leer las veinte piezas.**

Lo que hay que responder:

- ¿El texto sirve para publicar, o hay que reescribirlo entero? Si hay que reescribirlo, **lo que se arregla son los prompts, no el código.**
- ¿Se nota la diferencia entre canales, o los cinco suenan igual? Si suenan igual, los instructivos no están haciendo su trabajo.
- ¿Respeta el léxico prohibido de la marca?
- ¿Cuánto tardaron las veinte, y cuánto costaron? Los dos números sirven para calibrar lo que viene.

---

## Autorrevisión de este plan

**Cobertura del spec:**

| Sección del spec | Tarea |
|---|---|
| Las cinco formas, discriminadas por canal | Task 1 |
| Sin límites de caracteres en el esquema | Task 1, prueba dedicada y mutación 3 |
| Tabla `content_pieces`, una por slot | Task 2 |
| `channel` denormalizado con su `CHECK` | Task 2, prueba y mutación 2 |
| Sin columna de estado, sin `content_revisions` | Tasks 2 y 8 |
| Migración `0008` a mano | Task 2 |
| Dos pasos, modelo y persistencia | Task 5, prueba y mutación 3 |
| Una corrida por pieza | Task 4 |
| La guarda de grilla aprobada | Task 4, prueba y mutación 1 |
| Saltar los descartados | Tasks 3 y 4 |
| Encolar solo los slots sin pieza | Task 4, prueba y mutación 2 |
| Cinco prompts, con lo compartido armado una vez | Task 5 |
| El botón y el resumen de tres casos | Task 6, con la quinta prueba dedicada |
| El panel muestra la pieza | Task 7 |
| Las cinco capas de verificación | Tasks 1-7 y Task 8 paso 3 |

Sin huecos.

**Consistencia de nombres:** `PiezaDeContenido`, `TipoPieza` y `esquemaDePieza(canal)` se producen en la Task 1 y se consumen con esos nombres en 3, 5 y 7. `ResumenDePiezas`, `resumenDePiezas` y `piezasDelMes` se producen en la 3 y se consumen en 4, 6 y 7. `encolarPiezas` en la 4, consumida en la 6. `EntradaP3 { slotId, mes, brandId }` se declara en la 5 y es la misma forma que la 4 escribe en `input` y que la 3 consulta.

**Cuatro avisos para quien ejecute, que no son descuidos:**

1. **Las Tasks 3, 4, 6 y 7 describen sus pruebas por nombre y comportamiento, no con el cuerpo completo.** Es una decisión consciente: son treinta pruebas cuyo cuerpo depende de ayudantes de siembra que ya existen en cada archivo y que hay que mirar. Cada una dice qué afirmar y con qué datos. **Si al escribirlas descubres que el ayudante no existe o no sirve, dilo en el reporte** en vez de inventar un arnés nuevo.
2. **La Task 2 rompe la prueba de catálogo** —trece foráneas compuestas pasan a catorce— y hay que ampliarla, no relajarla, y actualizar los conteos que el archivo menciona en comentarios.
3. **La Task 6 tiene que tocar el factory de `vi.mock('@gc/operaciones')` antes que nada**, o el import de la página revienta con un error que no menciona el factory.
4. **`MODELO_REDACCION` está vacía hoy.** La Task 5 la necesita para que P3 corra de verdad; las pruebas usan el cliente falso y no la necesitan, así que el bloque puede quedar entero y verde sin que nadie note que falta. Está en la Task 8 y en la verificación del dueño.
