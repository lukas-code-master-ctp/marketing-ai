# El modelo se elige desde la pantalla — plan de implementación

> **Para quien ejecute esto:** SUB-SKILL OBLIGATORIA: usa `superpowers:subagent-driven-development` (recomendada) o `superpowers:executing-plans` para implementar tarea por tarea. Los pasos usan casillas (`- [ ]`).

**Objetivo:** que elegir el modelo de cada nivel sea un selector en una pantalla, y no dos variables de entorno en dos lugares.

**Arquitectura:** un catálogo curado en la base, global; una elección por organización y nivel; las consultas en `@gc/operaciones`, compartidas por la pantalla y por los flujos; y `@gc/ai` recibiendo los modelos en su contexto, igual que ya recibe `registrarUso`.

**Tecnologías:** TypeScript ESM, Drizzle sobre Postgres, Next.js 15 App Router, React 19, Vitest 2.1.

**Spec:** [2026-08-18-modelo-desde-la-pantalla-design.md](../specs/2026-08-18-modelo-desde-la-pantalla-design.md)

---

## Restricciones globales

Cada una es regla del proyecto (`CLAUDE.md`) y aplica a **todas** las tareas:

- **`pnpm test` en la raíz, NUNCA `pnpm -r test`.** Postgres levantado: `docker compose up -d postgres`.
- **Idioma:** esquema y columnas de la base en inglés `snake_case`; API de dominio, variables, comentarios y **todo texto que ve el usuario**, en español neutro latinoamericano con «tú» (nada de «vos», «tenés», «querés»).
- **TypeScript ESM:** los imports relativos llevan extensión `.js`, también desde `.tsx`.
- **Una migración aplicada es inmutable**, y las nuevas van **sin** el envoltorio `DO $$ ... EXCEPTION`. **`drizzle-kit generate` no sirve en este repositorio** —faltan los snapshots desde la `0005`—: la migración se escribe a mano con `0008_piezas_de_contenido.sql` de plantilla, y **no se commitea ningún snapshot**.
- **Los enumerados se hacen cumplir con `CHECK`.** `text(col, { enum })` de Drizzle no genera restricción alguna: el experimento de fallo correcto muta el `CHECK` real en SQL, no el arreglo de TypeScript.
- **La tenencia se verifica dentro de cada escritura**, y desde la base.
- **`@gc/db` NO puede importar `@gc/ai`.** `@gc/db` está en el cierre de dependencias de `apps/web`; un import así metería `@gc/ai` en ese cierre y `pnpm comprobar:aislamiento` se pondría rojo. Por eso `NIVELES` se declara en `@gc/db` y `@gc/ai` deriva su tipo de ahí — el mismo patrón de `CANALES` y `ESTADOS_PIPELINE`.
- **La capa web nunca ejecuta trabajo largo ni llama al modelo.**
- **Toda Server Action pasa por el ayudante `ejecutar`** de `apps/web/src/acciones.ts`. Hoy son once; una que no lo use nace desprotegida.
- **Cada ruta de Next necesita su propio `force-dynamic`.**
- **Una prueba que no puede fallar es peor que ninguna.** Van veinticuatro encontradas en este repositorio, siete en el bloque anterior. Cada prueba se valida rompiendo el código y exigiendo que se ponga roja **por la razón exacta**.

**Comandos de verificación** (antes de cada commit):

```bash
pnpm test
```

```bash
pnpm -r typecheck
```

```bash
pnpm comprobar:aislamiento
```

Y para las tareas que tocan `apps/web`:

```bash
pnpm --filter @gc/web build
```

---

## Estructura de archivos

**Crear:**

| Archivo | Responsabilidad |
|---|---|
| `packages/db/migraciones/0009_modelos_configurables.sql` | las dos tablas y su siembra, a mano |
| `packages/operaciones/src/modelos.ts` | leer el catálogo, leer y guardar la elección |
| `packages/operaciones/src/modelos.test.ts` | pruebas de lo anterior |
| `apps/web/src/app/(app)/configuracion/page.tsx` | la pantalla |
| `apps/web/src/componentes/SelectorDeModelo.tsx` | un bloque por nivel, con sus dos selectores |
| `apps/web/src/componentes/SelectorDeModelo.test.tsx` | pruebas de lo anterior |

**Modificar:**

| Archivo | Cambio |
|---|---|
| `packages/db/src/esquema.ts` | `NIVELES`, `modelCatalog`, `organizationModels` |
| `packages/db/src/esquema.test.ts` | catálogo: dos tablas más, y los conteos que el archivo menciona |
| `packages/operaciones/src/index.ts` | exportar `./modelos.js` |
| `packages/ai/src/niveles.ts` | derivar el tipo de `NIVELES`; borrar `resolverNivel` y su mapa |
| `packages/ai/src/ejecutar.ts` | `ContextoDeEjecucion` recibe los modelos; deja de leer el entorno |
| `packages/ai/src/ejecutar.test.ts` | que borrar las variables no cambie nada |
| `packages/flujos/src/p1.ts` | resolver antes de llamar |
| `packages/flujos/src/p2.ts` | ídem |
| `packages/flujos/src/p3.ts` | ídem |
| `packages/flujos/src/p3.test.ts` | que el modelo que llega al cliente sea el de la base |
| `apps/web/src/acciones.ts` | `guardarModeloAccion` |
| `apps/web/src/paginas.test.tsx` | pruebas de la pantalla |
| `.env` y `.env.example` | se van las seis `MODELO_*` |
| `CLAUDE.md` | la regla que cambia, con su porqué |
| `docs/superpowers/specs/pendientes.md` | lo que este bloque cierra y lo que deja |

---

## Task 1: las dos tablas y su siembra

**Archivos:**
- Modificar: `packages/db/src/esquema.ts`
- Modificar: `packages/db/src/esquema.test.ts`
- Crear: `packages/db/migraciones/0009_modelos_configurables.sql`

**Interfaces:**
- Produce, y lo consumen las Tasks 2, 3 y 5:

```ts
export const NIVELES = ['razonamiento', 'redaccion', 'utilitario'] as const
export type Nivel = (typeof NIVELES)[number]
export const MODALIDADES = ['chat', 'imagen'] as const
// esquema.modelCatalog, esquema.organizationModels
```

**`NIVELES` va en `@gc/db` y no en `@gc/ai`**, y no es una preferencia: `@gc/db` está en el cierre de dependencias de `apps/web`, así que importar `@gc/ai` desde ahí pondría rojo `pnpm comprobar:aislamiento`. `@gc/ai` sí puede depender de `@gc/db` —ya lo hace—, así que la flecha va en esa dirección.

**`MODALIDADES` incluye `'imagen'` aunque hoy nadie la use.** Es la única concesión al futuro de este plan y se justifica: el bloque 2D trae las imágenes, que no son otro nivel sino otra modalidad, y sin ese valor en el `CHECK` tendría que migrar la tabla antes de sembrar su primera fila.

- [ ] **Paso 1: escribir las pruebas que fallan**

Agrega a `packages/db/src/esquema.test.ts` un `describe('modelos configurables')` con cinco pruebas:

```ts
it('el catálogo rechaza un nivel fuera del enumerado', /* insert con level 'inventado' -> rejects */)
it('el catálogo rechaza una modalidad fuera del enumerado', /* modality 'video' -> rejects */)
it('el mismo modelo no puede repetirse dentro de un nivel', /* dos veces (level, model_id) -> rejects */)
it('una organización no puede elegir dos veces el mismo nivel', /* dos filas (organization_id, level) -> rejects */)
it('borrar la organización se lleva su elección', /* delete organizations -> 0 filas en organization_models */)
```

Escribe el cuerpo de las cinco con el estilo del archivo, usando `conBaseDeDatosDePrueba`. Para las tres primeras, inserta con SQL crudo —como ya hace la prueba del canal fuera del enumerado— porque Drizzle no deja escribir un valor fuera del tipo.

Y **actualiza el catálogo de tablas**: son dos tablas más. Las claves foráneas compuestas **siguen siendo catorce** —ninguna de las dos tablas nuevas las necesita, porque el catálogo es global y la elección cuelga directo de `organizations`—; comprueba ese número y actualiza solo los conteos que sí cambian, incluidos los que el archivo menciona en comentarios y en nombres de prueba.

- [ ] **Paso 2: correr y ver que fallan**

```bash
pnpm --filter @gc/db test -- esquema
```

Esperado: fallan con `relation "model_catalog" does not exist`.

- [ ] **Paso 3: agregar las tablas al esquema**

En `packages/db/src/esquema.ts`, junto a los otros enumerados:

```ts
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
```

Y las dos tablas:

```ts
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
 * porque hoy lo es: `MODELO_RAZONAMIENTO_RESPALDO` está puesta y
 * `MODELO_REDACCION_RESPALDO` vacía, y las dos son estados válidos.
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
  updatedAt: creadoEn(),
  updatedBy: uuid('updated_by').references(() => users.id, { onDelete: 'set null' }),
}, (t) => ({
  nivelValido: chequeoEnum('organization_models_level_check', 'level', NIVELES),
  unicoPorNivel: unique('organization_models_org_level_unique').on(t.organizationId, t.level),
}))
```

`ON DELETE restrict` en las dos referencias al catálogo es deliberado: borrar del catálogo un modelo que alguien está usando tiene que fallar ruidosamente, no dejar la elección apuntando a nada.

Agrega las dos al objeto `esquema` que el archivo exporta, **en el orden en que se declaran** — el bloque anterior rompió ese orden y hubo que corregirlo.

- [ ] **Paso 4: escribir la migración a mano**

**No corras `drizzle-kit generate`.** Crea `packages/db/migraciones/0009_modelos_configurables.sql` con el estilo de `0008_piezas_de_contenido.sql`: mayúsculas del SQL, comillas dobles en los identificadores, `--> statement-breakpoint` entre sentencias, sin envoltorio `DO $$`.

Además de crear las dos tablas con sus restricciones, **siembra el catálogo** con estos ocho candidatos, que se verificaron contra la API de OpenRouter el 2026-08-18 (precios en dólares por millón de tokens):

| nivel | model_id | etiqueta | entrada | salida |
|---|---|---|---|---|
| razonamiento | `upstage/solar-pro4` | Económico | 0.03 | 0.12 |
| razonamiento | `poolside/laguna-xs-2.1` | Equilibrado | 0.06 | 0.12 |
| razonamiento | `deepseek/deepseek-v4-flash-0731` | Probado | 0.14 | 0.28 |
| razonamiento | `tencent/hy3` | Alternativo | 0.132 | 0.528 |
| redaccion | `deepseek/deepseek-v4-flash-0731` | Económico | 0.14 | 0.28 |
| redaccion | `anthropic/claude-sonnet-5` | Recomendado | 2 | 10 |
| redaccion | `moonshotai/kimi-k3` | Alternativo | 3 | 15 |
| redaccion | `anthropic/claude-opus-5` | El más capaz | 5 | 25 |

La columna `description` de cada uno dice **para qué sirve, en español y en una frase**, no repite la etiqueta.

Y **siembra la elección de la organización existente** con un `INSERT ... SELECT` que resuelva los `id` del catálogo por `model_id`, para toda fila de `organizations`:

- `razonamiento`: principal `deepseek/deepseek-v4-flash-0731`, respaldo `tencent/hy3` — es exactamente lo que hoy dice el `.env`, así que la migración no cambia comportamiento.
- `redaccion`: principal `anthropic/claude-sonnet-5`, respaldo `deepseek/deepseek-v4-flash-0731`.

`utilitario` no se siembra: no tiene candidatos ni consumidores.

Agrega la entrada al `_journal.json`: `idx: 9`, `version: "7"`, `tag: "0009_modelos_configurables"`, `breakpoints: true`, `when` mayor que `1786800000000`.

**No generes ni commitees ningún snapshot.**

- [ ] **Paso 5: correr y ver que pasan**

```bash
pnpm --filter @gc/db test -- esquema
```

- [ ] **Paso 6: mutar y confirmar**

Tres mutaciones, una a la vez, sobre el `.sql`, contra una base recreada desde cero:

1. Quitar el `CHECK` de `level` del catálogo → cae `'el catálogo rechaza un nivel fuera del enumerado'`.
2. Quitar la única de `(level, model_id)` → cae `'el mismo modelo no puede repetirse dentro de un nivel'`.
3. Cambiar el `ON DELETE cascade` de `organization_id` por `no action` → cae `'borrar la organización se lleva su elección'`.

- [ ] **Paso 7: la suite, el typecheck y commit**

```bash
pnpm test && pnpm -r typecheck && pnpm comprobar:aislamiento
```

```bash
git add packages/db/ && git commit -m "feat(db): el catálogo de modelos y la elección por organización"
```

---

## Task 2: las consultas

**Archivos:**
- Crear: `packages/operaciones/src/modelos.ts`
- Crear: `packages/operaciones/src/modelos.test.ts`
- Modificar: `packages/operaciones/src/index.ts`

**Interfaces:**
- Consume: `esquema.modelCatalog`, `esquema.organizationModels`, `NIVELES`, `Nivel` de `@gc/db` (Task 1).
- Produce, y lo consumen las Tasks 4 y 5:

```ts
export interface ModeloDelCatalogo {
  id: string
  nivel: Nivel
  modelId: string
  etiqueta: string
  descripcion: string
  precioEntradaUsd: number
  precioSalidaUsd: number
}

export interface EleccionDeNivel {
  nivel: Nivel
  principal: ModeloDelCatalogo
  respaldo: ModeloDelCatalogo | null
}

/** El catálogo entero, agrupado por nivel, ordenado por precio de salida. */
export async function catalogoDeModelos(db: BaseDeDatos): Promise<Map<Nivel, ModeloDelCatalogo[]>>

/** Lo que esta organización eligió, por nivel. Los niveles sin elegir no aparecen. */
export async function eleccionesDeModelo(
  db: BaseDeDatos, organizationId: string,
): Promise<EleccionDeNivel[]>

/**
 * Los identificadores que hay que mandarle al modelo, en el orden en que se
 * intentan. Lanza `permanente` si la organización no eligió ese nivel.
 */
export async function modelosDelNivel(
  db: BaseDeDatos, organizationId: string, nivel: Nivel,
): Promise<{ principal: string; respaldo: string }>

export async function guardarEleccionDeModelo(
  db: BaseDeDatos, organizationId: string,
  args: { nivel: Nivel; principalId: string; respaldoId: string | null },
  usuarioId?: string,
): Promise<void>
```

`modelosDelNivel` devuelve `{ principal, respaldo }` con **los `model_id`, no los `id` de la fila** — es lo que el cliente del modelo necesita. Cuando no hay respaldo devuelve `respaldo: principal`, que es exactamente lo que hace hoy `resolverNivel` con la variable vacía, para que el cambio no altere comportamiento.

**Ojo con los precios:** Drizzle mapea `numeric` a **`string`**, no a `number` —lo hace para no perder precisión—, así que las dos propiedades `precio*Usd` de `ModeloDelCatalogo` exigen convertir al leer. `brands.monthlyBudgetUsd` ya es `numeric` en este esquema; mira cómo lo trata el código que lo consume y sigue ese criterio en vez de inventar otro.

- [ ] **Paso 1: escribir las pruebas que fallan**

Crea `packages/operaciones/src/modelos.test.ts` con estas ocho, con el estilo de `packages/operaciones/src/piezas.test.ts`:

```ts
describe('modelosDelNivel', () => {
  it('devuelve el model_id del principal y del respaldo elegidos', /* los dos strings */)
  it('sin respaldo elegido devuelve el principal en los dos', /* respaldo === principal */)
  it('sin elección para ese nivel lanza un permanente que nombra la pantalla', /* rejects, mensaje con /configuracion */)
  it('no ve la elección de otra organización', /* B con datos propios: ver abajo */)
})

describe('catalogoDeModelos', () => {
  it('agrupa por nivel y ordena por precio de salida', /* el más barato primero */)
})

describe('eleccionesDeModelo', () => {
  it('omite los niveles que la organización no eligió', /* solo los elegidos */)
})

describe('guardarEleccionDeModelo', () => {
  it('guardar dos veces el mismo nivel corrige, no duplica', /* una sola fila */)
  it('no deja elegir un modelo de otro nivel', /* rejects */)
})
```

**La prueba de tenencia tiene que sembrarle datos propios a la organización B.** Este repositorio descubrió —dos veces, en el bloque anterior— que el patrón «B no ve nada» **no puede fallar**: con B sin datos, el resultado es cero tanto si el filtro está bien como si está roto. Mira cómo quedó `piezas.test.ts` y sigue ese diseño.

Escribe el cuerpo de las ocho.

- [ ] **Paso 2: correr y ver que fallan**

```bash
pnpm --filter @gc/operaciones test -- modelos
```

- [ ] **Paso 3: implementar**

Crea `packages/operaciones/src/modelos.ts` con las cuatro funciones. `guardarEleccionDeModelo` usa `onConflictDoUpdate` sobre `(organization_id, level)` y comprueba que el modelo elegido pertenezca al nivel antes de escribir, con un `permanente` que lo diga. Todas filtran por `organizationId`.

El mensaje de «sin elección» tiene que decir **qué hacer**: elegir el modelo de ese nivel en `/configuracion`.

Agrega a `packages/operaciones/src/index.ts`:

```ts
export * from './modelos.js'
```

- [ ] **Paso 4: correr y ver que pasan**

```bash
pnpm --filter @gc/operaciones test -- modelos
```

- [ ] **Paso 5: mutar y confirmar**

Tres mutaciones, una a la vez:

1. Devolver `respaldo: ''` cuando no hay respaldo → cae `'sin respaldo elegido devuelve el principal en los dos'`.
2. Quitar el filtro por `organizationId` de `modelosDelNivel` → cae `'no ve la elección de otra organización'`.
3. Quitar la comprobación de nivel de `guardarEleccionDeModelo` → cae `'no deja elegir un modelo de otro nivel'`.

- [ ] **Paso 6: la suite, el typecheck y commit**

```bash
pnpm test && pnpm -r typecheck && pnpm comprobar:aislamiento
```

```bash
git add packages/operaciones/src/ && git commit -m "feat(operaciones): leer el catálogo de modelos y la elección de la organización"
```

---

## Task 3: `@gc/ai` deja de leer el entorno

**Archivos:**
- Modificar: `packages/ai/src/niveles.ts`
- Modificar: `packages/ai/src/ejecutar.ts`
- Modificar: `packages/ai/src/ejecutar.test.ts`

**Interfaces:**
- Consume: `NIVELES`, `Nivel` de `@gc/db` (Task 1).
- Produce, y lo consume la Task 4:

```ts
export interface ContextoDeEjecucion {
  cliente: ClienteLlm
  /** Los modelos a intentar, en orden. Los resuelve quien llama. */
  modelos: { principal: string; respaldo: string }
  registrarUso?: (uso: UsoDeLlamada) => Promise<void>
}
```

**El campo `env` se va.** Comprueba antes si algo más lo usa; si lo usa, déjalo y dilo en el reporte.

**Por qué el contexto y no una conexión:** `ejecutarTarea` no escribe `ai_calls` —lo hace quien llama, por el callback `registrarUso`—, así que «esto lo necesito pero no es mío» ya se resuelve en este archivo pidiéndolo en el contexto. Darle una conexión rompería esa simetría y obligaría a que las pruebas del paquete, hoy puras, carguen una base.

- [ ] **Paso 1: escribir la prueba que falla**

Agrega a `packages/ai/src/ejecutar.test.ts`:

```ts
it('usa los modelos del contexto y no mira el entorno', async () => {
  // Es la prueba que fija que la retirada del entorno ocurrió de verdad: si
  // alguien reintrodujera una lectura de `process.env`, este caso —con las
  // variables borradas y el contexto puesto— seguiría pasando por accidente
  // solo si el código las ignora.
  const previo = process.env.MODELO_RAZONAMIENTO
  delete process.env.MODELO_RAZONAMIENTO
  try {
    const cliente = new ClienteFalso(/* la respuesta válida que el archivo ya usa */)
    await ejecutarTarea(TAREA_DE_PRUEBA, [/* mensajes */], {
      cliente,
      modelos: { principal: 'proveedor/modelo-a', respaldo: 'proveedor/modelo-b' },
    })
    expect(cliente.ultimaPeticion?.modelos).toEqual(['proveedor/modelo-a', 'proveedor/modelo-b'])
  } finally {
    if (previo !== undefined) process.env.MODELO_RAZONAMIENTO = previo
  }
})
```

Adapta los nombres al arnés real del archivo —`ClienteFalso`, la tarea de prueba y cómo expone la última petición—; si no expone los modelos de la última petición, agrégalo, y **dilo en el reporte**.

- [ ] **Paso 2: correr y ver que falla**

```bash
pnpm --filter @gc/ai test
```

- [ ] **Paso 3: implementar**

En `packages/ai/src/niveles.ts`: borra `VARIABLE_POR_NIVEL` y `resolverNivel`, y deja el tipo derivado de `@gc/db`:

```ts
import { NIVELES, type Nivel } from '@gc/db'

/**
 * El nivel vive en `@gc/db` y no acá porque la columna `level` de
 * `model_catalog` lo hace cumplir con un `CHECK`, y `@gc/db` no puede
 * importar `@gc/ai`: está en el cierre de dependencias de `apps/web`, así
 * que esa flecha pondría roja la comprobación de aislamiento.
 */
export type NivelDeModelo = Nivel
export { NIVELES }
```

En `ejecutar.ts`, reemplaza la llamada a `resolverNivel` por el contexto:

```ts
const { principal, respaldo } = ctx.modelos
```

El resto de la función no cambia.

- [ ] **Paso 4: correr y ver que pasa**

```bash
pnpm --filter @gc/ai test
```

- [ ] **Paso 5: mutar y confirmar**

Una mutación: hacer que `ejecutarTarea` ignore `ctx.modelos` y use un literal → tiene que caer la prueba nueva, **por los modelos que recibe el cliente** y no por otra cosa. Confirma cuál es el mensaje.

- [ ] **Paso 6: la suite, el typecheck y commit**

El typecheck va a fallar en `@gc/flujos`, que todavía no pasa `modelos`. **Eso es esperado y lo arregla la Task 4.** Corre igual las pruebas de `@gc/ai` y commitea; deja constancia en el reporte de que el workspace queda rojo hasta la tarea siguiente.

```bash
pnpm --filter @gc/ai test && pnpm --filter @gc/ai typecheck
```

```bash
git add packages/ai/src/ && git commit -m "refactor(ai): los modelos llegan por el contexto, no por el entorno"
```

---

## Task 4: los tres flujos resuelven antes de llamar

**Archivos:**
- Modificar: `packages/flujos/src/p1.ts`
- Modificar: `packages/flujos/src/p2.ts`
- Modificar: `packages/flujos/src/p3.ts`
- Modificar: `packages/flujos/src/p3.test.ts`

**Interfaces:**
- Consume: `modelosDelNivel` de `@gc/operaciones` (Task 2) y `ContextoDeEjecucion` de `@gc/ai` (Task 3).

Los tres sitios de llamada son `p1.ts:92`, `p2.ts:110` y `p3.ts:112`. Los tres ya tienen `ctx.db` y la organización a mano; la resolución va **justo antes** de `ejecutarTarea`, en el mismo paso.

- [ ] **Paso 1: escribir la prueba que falla**

Agrega a `packages/flujos/src/p3.test.ts`:

```ts
it('usa el modelo que la organización eligió, no uno fijo', /* siembra la elección con un model_id
   reconocible, corre el flujo, y afirma que la petición al cliente falso llevó ESE identificador */)
it('sin elección para redacción falla sin llamar al modelo', /* peticiones en 0, mensaje que nombra
   la pantalla */)
```

La segunda importa tanto como la primera: **resolver tiene que ocurrir antes de gastar**, igual que la comprobación del slot.

- [ ] **Paso 2: correr y ver que fallan**

```bash
pnpm --filter @gc/flujos test -- p3
```

- [ ] **Paso 3: implementar**

En los tres archivos, antes de `ejecutarTarea`:

```ts
const modelos = await modelosDelNivel(ctx.db, ctx.organizationId, TAREA_X.nivel)
```

y pasa `modelos` en el contexto, al lado de `cliente` y `registrarUso`. Usa el nivel de la tarea, no un literal: así agregar un nivel nuevo no exige tocar los flujos.

Las siembras de las pruebas existentes de `p1`, `p2` y `p3` van a necesitar la elección; agrégala al ayudante de siembra que cada archivo ya tiene, no una por prueba.

- [ ] **Paso 4: correr y ver que pasan**

```bash
pnpm --filter @gc/flujos test
```

- [ ] **Paso 5: mutar y confirmar**

Dos mutaciones, una a la vez:

1. Resolver **después** de llamar al modelo en `p3.ts` → tiene que caer `'sin elección para redacción falla sin llamar al modelo'`, y **por el conteo de peticiones**. Confirma cuál.
2. Fijar el nivel a `'razonamiento'` en `p3.ts` en vez de leerlo de la tarea → tiene que caer `'usa el modelo que la organización eligió'`.

- [ ] **Paso 6: la suite, el typecheck y commit**

Acá el workspace vuelve a verde.

```bash
pnpm test && pnpm -r typecheck && pnpm comprobar:aislamiento
```

```bash
git add packages/flujos/src/ && git commit -m "feat(flujos): P1, P2 y P3 resuelven el modelo de la base antes de llamar"
```

---

## Task 5: la pantalla

**Archivos:**
- Crear: `apps/web/src/app/(app)/configuracion/page.tsx`
- Crear: `apps/web/src/componentes/SelectorDeModelo.tsx`
- Crear: `apps/web/src/componentes/SelectorDeModelo.test.tsx`
- Modificar: `apps/web/src/acciones.ts`
- Modificar: `apps/web/src/paginas.test.tsx`

**Interfaces:**
- Consume: `catalogoDeModelos` y `eleccionesDeModelo` (Task 2).
- Produce:

```ts
export async function guardarModeloAccion(
  nivel: string, principalId: string, respaldoId: string | null,
): Promise<Resultado<void>>
```

**La acción pasa por el ayudante `ejecutar`**, como las once que ya hay. **No** llama a `despertarWorker`: no encola nada.

**`SelectorDeModelo` es un componente de cliente** y recibe sus datos por props. No importa del barril de `@gc/db` —arrastraría el conector de Cloud SQL al bundle del navegador y rompería el build, cosa que solo atrapa `pnpm --filter @gc/web build`, que no corre en CI—.

Lleva el patrón de los cuatro botones que ya existen: deshabilitado mientras guarda, y el mensaje de error en pantalla si la acción rechaza. Y si agregas un «Reintentar», **que lleve `disabled`**: los cuatro componentes viejos no lo llevan y están registrados como deuda por eso.

- [ ] **Paso 1: escribir las pruebas que fallan**

En `SelectorDeModelo.test.tsx`, con `// @vitest-environment jsdom` y `afterEach(cleanup)` (el paquete no usa `globals: true` ni tiene `@testing-library/jest-dom`: afirma leyendo el elemento):

```ts
it('muestra un bloque por nivel, con su explicación en palabras del usuario')
it('el selector de un nivel solo ofrece candidatos de ese nivel')
it('cada opción muestra su etiqueta y su precio')
it('guardar deshabilita el botón mientras la acción viaja')
it('si la acción rechaza, el mensaje se ve')
```

Y en `paginas.test.tsx`, dos de la pantalla completa:

```ts
it('la pantalla de configuración lista los niveles del catálogo')
it('un nivel sin elección se muestra sin elegir y lo dice')
```

**Acota con `within()`** sobre el bloque del nivel que te importa: una aserción contra el documento entero se ve igual que una contra el lugar correcto, y ese patrón ya falló cuatro veces en este arnés.

**Antes de nada, agrega `catalogoDeModelos` y `eleccionesDeModelo` al factory de `vi.mock('@gc/operaciones')` de `paginas.test.tsx`, con valor por omisión en el `beforeEach`**, o las pruebas que ya existen se ponen rojas por el motivo equivocado.

- [ ] **Paso 2: correr y ver que fallan**

```bash
pnpm --filter @gc/web test -- SelectorDeModelo
```

- [ ] **Paso 3: implementar**

La página lee las dos operaciones y renderiza un `SelectorDeModelo` por nivel presente en el catálogo. Lleva su propio `export const dynamic = 'force-dynamic'`.

Las explicaciones de cada nivel, en español y sin jerga:

- `razonamiento`: «Decide la estrategia del trimestre y arma la grilla del mes.»
- `redaccion`: «Escribe el texto de cada pieza.»
- `utilitario`: «Tareas auxiliares. Hoy no lo usa nada.»

La Server Action con la forma de `aprobarGrillaAccion` — mírala en `acciones.ts`.

- [ ] **Paso 4: correr y ver que pasan**

```bash
pnpm --filter @gc/web test -- SelectorDeModelo && pnpm --filter @gc/web test -- paginas
```

- [ ] **Paso 5: mutar y confirmar**

Dos mutaciones, una a la vez:

1. Ofrecer en cada selector el catálogo entero en vez del nivel → cae `'el selector de un nivel solo ofrece candidatos de ese nivel'`.
2. Descartar el resultado de la acción → cae `'si la acción rechaza, el mensaje se ve'`.

- [ ] **Paso 6: la suite, el typecheck, el build y commit**

```bash
pnpm test && pnpm -r typecheck && pnpm --filter @gc/web build
```

En el build tienen que salir **seis** rutas del dominio en `ƒ`, no cinco: la de configuración es nueva.

```bash
git add apps/web/src/ && git commit -m "feat(web): elegir el modelo de cada nivel desde la pantalla"
```

---

## Task 6: retirar las variables y reescribir la regla

**Archivos:**
- Modificar: `.env`, `.env.example`
- Modificar: `CLAUDE.md`
- Modificar: `docs/superpowers/specs/pendientes.md`

- [ ] **Paso 1: quitar las variables**

Borra las seis `MODELO_*` de `.env` y de `.env.example`. Comprueba con un grep que no quede ningún lector en el código —incluidos `vitest.setup.ts` y `docker-compose.yml`— y **dilo en el reporte** si encuentras alguno.

- [ ] **Paso 2: reescribir la regla de `CLAUDE.md`**

Hoy dice: **«Los modelos se leen del entorno, nunca literales en código. Solo `@gc/ai` sabe que OpenRouter existe.»**

Reescríbela para que diga que se eligen desde `/configuracion` y viven en la base, **con el porqué al lado**: los identificadores siguen sin ser literales en código —que era el punto real— pero dejan de venir del entorno, porque elegir modelo resultó ser una decisión de producto que se toma leyendo lo que el modelo produce, y estaba a dos comandos de distancia de quien la toma.

**Cita la frase anterior en vez de borrarla.** Es lo que este repositorio hace con las reglas que cambian, para que quien la recuerde entienda qué pasó.

Actualiza también los conteos que el archivo menciona: las tablas y las migraciones cambiaron.

- [ ] **Paso 3: `pendientes.md`**

Marca **cerrado** el pendiente de `MODELO_REDACCION` vacía, diciendo dónde se cerró. Y registra lo que este bloque deja:

1. **El catálogo puede apuntar a un modelo que OpenRouter dejó de servir**, y no se descubre hasta que una generación falla. El `.env` tenía el mismo problema, pero la pantalla invita a cambiarlo más seguido.
2. **La pantalla no muestra con qué resultado quedó cada modelo.** Elegir bien exige leer lo que produce; los datos para compararlos están en `ai_calls` y mostrarlos es otro alcance.
3. **Una organización creada después de la migración nace sin elección** y su primera generación falla con el mensaje que manda a elegir. Es deliberado —no inventarle un modelo que nunca eligió— pero conviene saberlo antes de crear la segunda organización.
4. **Los precios del catálogo son una foto del 2026-08-18** y nada los revalida. Si OpenRouter los cambia, la pantalla miente hasta que alguien escriba otra migración.

- [ ] **Paso 4: commit**

```bash
git add .env.example CLAUDE.md docs/ && git commit -m "docs: el modelo se elige desde la pantalla, y por qué cambió la regla"
```

---

## Task 7: aplicar la migración y la verificación real

- [ ] **Paso 1: aplicar la `0009` a las dos bases, en este orden**

**Primero Cloud SQL, antes de fusionar.** Con el código nuevo desplegado y sin las tablas, *toda* generación falla. Al revés no pasa nada: con las tablas puestas y el código viejo corriendo, el worker sigue leyendo el entorno.

El camino corto —el migrador programático por `crearConexion()`, con `K_SERVICE` exportado para caer a las Application Default Credentials— es el que se corrió en la `0008`. Recuerda que las ADC se renuevan con `gcloud auth application-default login`, que **no** es lo mismo que `gcloud auth login`.

Después la base de desarrollo, con `pnpm --filter @gc/db migraciones:aplicar`.

- [ ] **Paso 2: la verificación que ninguna prueba reemplaza**

**La hace el dueño.**

1. Abrir `/configuracion` y comprobar que los dos niveles aparecen con sus candidatos y sus precios.
2. Cambiar el modelo de redacción.
3. Generar las piezas de un mes.
4. **Confirmar en `ai_calls` que la llamada usó el modelo nuevo**, y leer las piezas para ver si el cambio se nota.

Lo que hay que responder: ¿el modelo nuevo escribe mejor que el anterior? Es la única pregunta que este bloque existe para poder hacer barata.

- [ ] **Paso 3: limpieza en Cloud Run**

Con el código desplegado, borrar las seis variables `MODELO_*` del servicio. Es limpieza, no un paso funcional: nadie las lee.

---

## Autorrevisión de este plan

**Cobertura del spec:**

| Sección del spec | Tarea |
|---|---|
| `model_catalog` global, con modalidad | Task 1 |
| `organization_models` por organización y nivel | Task 1 |
| Siembra del catálogo y de la elección | Task 1 |
| Verificar los identificadores contra OpenRouter | Hecho antes de escribir el plan; la tabla de la Task 1 trae los valores |
| Consultas en `@gc/operaciones`, una sola | Task 2 |
| `@gc/flujos` resuelve y pasa por el contexto | Tasks 3 y 4 |
| `@gc/ai` deja de leer el entorno | Task 3, con prueba dedicada |
| Falla cerrado sin fila | Tasks 2 y 4 |
| La pantalla, un bloque por nivel del catálogo | Task 5 |
| El orden de retirada de las variables | Tasks 6 y 7 |
| La regla de `CLAUDE.md` que cambia, con su porqué | Task 6 |
| Las cinco verificaciones | Tasks 1-5 y Task 7 |

Sin huecos.

**Consistencia de nombres:** `NIVELES`, `Nivel`, `MODALIDADES`, `modelCatalog` y `organizationModels` se producen en la Task 1 y se consumen con esos nombres en 2, 3 y 5. `modelosDelNivel`, `catalogoDeModelos`, `eleccionesDeModelo` y `guardarEleccionDeModelo` se producen en la 2 y se consumen en 4 y 5. `ContextoDeEjecucion.modelos` se declara en la 3 y se llena en la 4.

**Cuatro avisos para quien ejecute, que no son descuidos:**

1. **La Task 3 deja el workspace rojo a propósito.** El typecheck falla en `@gc/flujos` hasta que la Task 4 pase `modelos`. Está declarado en su Paso 6; no es una regresión que haya que perseguir.
2. **Las Tasks 2, 4 y 5 describen sus pruebas por nombre y comportamiento, no con el cuerpo completo.** Es deliberado: sus cuerpos dependen de ayudantes de siembra que ya existen en cada archivo y que hay que mirar. Si el ayudante no existe o no sirve, **dilo en el reporte** en vez de inventar un arnés nuevo.
3. **La prueba de tenencia de la Task 2 tiene que sembrarle datos propios a la organización B.** El patrón «B no ve nada» **no puede fallar**, y este repositorio lo descubrió dos veces en el bloque anterior.
4. **La Task 5 tiene que tocar el factory de `vi.mock('@gc/operaciones')` antes que nada**, o las pruebas que ya existen revientan por un motivo que no es el suyo.
