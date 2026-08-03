# Worker local y operación desde la web (1B) — Plan de implementación

> **Para trabajadores agénticos:** SUB-SKILL REQUERIDA: usa `superpowers:subagent-driven-development` (recomendado) o `superpowers:executing-plans` para implementar este plan tarea por tarea. Los pasos usan casillas (`- [ ]`) para seguimiento.

**Objetivo:** que todo el ciclo —crear marca, cargar perfil, generar estrategia, generar grilla, ver el avance y reanudar lo que falló— se maneje desde el navegador, con un worker local que ejecuta el trabajo largo.

**Arquitectura:** `pipeline_runs` gana un estado `pendiente` y pasa a ser la cola. La web inserta ahí y devuelve al instante; un proceso `apps/worker` sondea con `FOR UPDATE SKIP LOCKED` y llama a `ejecutarFlujo` con el `runId` existente, que es la ruta de reanudación ya probada. Las pantallas muestran el estado de la corrida donde vive su resultado.

**Stack:** pnpm workspaces, TypeScript 5 ESM, Vitest 2.1 contra Postgres real, Next.js 15 App Router, Drizzle ORM, Zod 3, Docker Compose.

**Spec:** [2026-08-03-worker-y-operacion-desde-la-web-design.md](../specs/2026-08-03-worker-y-operacion-desde-la-web-design.md)

## Restricciones globales

Copiadas de `CLAUDE.md` y del spec. Aplican a **todas** las tareas.

- **`pnpm test` desde la raíz, NUNCA `pnpm -r test`.** Los once paquetes comparten la base de pruebas y cada prueba la vacía al empezar; en paralelo se pisan.
- **Un solo `.env`, en la raíz.** Ningún paquete tiene el suyo.
- **Una migración aplicada es inmutable.** Un error se corrige con otra migración. Las migraciones nuevas van **sin** el envoltorio `DO $$ ... EXCEPTION`: una que se salta sola es peor que una que falla.
- **Idioma:** esquema y columnas en inglés `snake_case`. API de dominio, variables, comentarios y **todo texto que ve el usuario**, en español neutro latinoamericano (con "tú", no "vos").
- **Los enumerados se hacen cumplir con `CHECK` en Postgres.** `text(col, { enum })` de Drizzle no genera restricción alguna.
- **La tenencia se verifica dentro de cada escritura:** `WHERE id = ? AND organization_id = ?`, `.returning()`, y `permanente` si no vuelve fila.
- **Los modelos se leen del entorno**, nunca literales en código. Solo `@gc/ai` sabe que OpenRouter existe.
- **Ninguna salida del modelo se parsea con expresiones regulares.** Toda tarea declara un esquema Zod y valida.
- **La capa web nunca ejecuta trabajo largo ni llama al modelo.** Encola; no ejecuta. `pnpm comprobar:aislamiento` lo exige y debe seguir en verde con `apps/worker` como nodo nuevo del grafo.
- **Cada ruta de Next necesita su propio `export const dynamic = 'force-dynamic'`.** Verificar en `pnpm --filter @gc/web build` que las rutas del dominio salgan con `ƒ` y no con `○`.
- **Una prueba que no puede fallar es peor que ninguna.** Cada prueba se rompe a propósito y se confirma que se pone roja **antes** de darse por buena. En la rama anterior aparecieron cuatro cuyo nombre prometía una mitad que ninguna aserción respaldaba, todas verdes.
- **Punto de partida:** `master` en `1413389`, **289 pruebas en diez paquetes** (`db` 22, `shared` 34, `ai` 29, `brand` 13, `pipeline` 14, `strategy` 70, `operaciones` 36, `cli` 3, `web` 37, `flujos` 31).
- **Antes de empezar cualquier tarea:** `docker compose up -d`.
- La base de desarrollo (`gestor`) tiene la marca `parcelas` con perfil, estrategia `2026-Q3` y la grilla de `2026-09` en borrador. Las pruebas usan `gestor_test`. Si una verificación manual modifica `gestor`, restaurarla.

---

## Estructura de archivos

### Paquete nuevo

| Archivo | Responsabilidad |
|---|---|
| `apps/worker/package.json` | Manifiesto. Declara `@gc/flujos`, `@gc/ai`, `@gc/db`, `@gc/operaciones`, `@gc/pipeline`, `@gc/shared` |
| `apps/worker/tsconfig.json`, `vitest.config.ts` | Igual que los de `apps/cli` |
| `apps/worker/src/flujos.ts` | El mapa `flujoDe(nombre)` |
| `apps/worker/src/tomar.ts` + `.test.ts` | `tomarYEjecutarUna()`: toma una corrida y la ejecuta. Todo lo probable vive aquí |
| `apps/worker/src/main.ts` | El bucle. Trivial a propósito |
| `apps/worker/Dockerfile` | Imagen de desarrollo con `tsx`, código montado como volumen |

### Archivos modificados

| Archivo | Cambio |
|---|---|
| `packages/db/src/esquema.ts` | `ESTADOS_PIPELINE` suma `pendiente` |
| `packages/db/migraciones/0005_*.sql` | Reemplaza los dos `CHECK` |
| `packages/pipeline/src/motor.ts` | Sobre de versión en la salida de paso |
| `packages/flujos/src/{p1,p2}.ts` | Declaran su `versionDeSalida` |
| `packages/strategy/src/{validacion,derivados}.ts` | Ignoran los slots descartados |
| `packages/operaciones/src/corridas.ts` (nuevo) | Encolar, leer y reanudar corridas |
| `apps/cli/src/main.ts` | Bandera `--reanudar` |
| `apps/web/src/acciones.ts` | Cuatro Server Actions nuevas |
| `apps/web/src/componentes/` | `EstadoDeCorrida`, `BotonGenerar`, `FormularioDeMarca` |
| `apps/web/src/app/` | Las cuatro pantallas |
| `docker-compose.yml` | Servicio `worker` |
| `CLAUDE.md` | Arquitectura y comandos |

---

## Task 1: El estado `pendiente`

**Archivos:**
- Modificar: `packages/db/src/esquema.ts`
- Crear: `packages/db/migraciones/0005_<nombre>.sql`, entrada en `packages/db/migraciones/meta/_journal.json`
- Test: `packages/db/src/catalogo.test.ts` (existente)

**Interfaces:**
- Consume: nada
- Produce: `ESTADOS_PIPELINE = ['pendiente', 'en_curso', 'completado', 'fallido']`, exportado desde `@gc/db`

- [ ] **Step 1: Registrar el punto de partida**

```bash
docker compose up -d && pnpm test 2>&1 | sed 's/\x1b\[[0-9;]*m//g' | grep -E 'RUN  v|Tests +[0-9]+ (passed|failed)'
```

Esperado: diez paquetes, 289 en total. Si no suman 289, **detente y reporta**.

- [ ] **Step 2: Escribir la prueba que falla**

Agrega a `packages/db/src/catalogo.test.ts`:

```ts
  it('pipeline_runs acepta el estado pendiente y rechaza uno inventado', async () => {
    await conBaseDeDatosDePrueba(async (db) => {
      const [org] = await db
        .insert(esquema.organizations)
        .values({ name: 'Principal', slug: 'principal' })
        .returning({ id: esquema.organizations.id })

      const [corrida] = await db
        .insert(esquema.pipelineRuns)
        .values({ organizationId: org!.id, flow: 'p2_grilla', status: 'pendiente' })
        .returning({ status: esquema.pipelineRuns.status })

      expect(corrida!.status).toBe('pendiente')

      await expect(
        db.insert(esquema.pipelineRuns).values({
          organizationId: org!.id,
          flow: 'p2_grilla',
          // @ts-expect-error el CHECK es la garantía, no el tipo de Drizzle
          status: 'inventado',
        }),
      ).rejects.toThrow()
    })
  })
```

- [ ] **Step 3: Correr y verificar que falla**

Run: `pnpm --filter @gc/db test catalogo`
Esperado: FAIL — `'pendiente'` viola el `CHECK` actual.

- [ ] **Step 4: Ampliar el enumerado**

En `packages/db/src/esquema.ts`, línea 34:

```ts
// `pendiente` es el estado de una corrida encolada por la web y todavía no
// tomada por el worker. Los pasos comparten la constante por simetría, pero
// ninguno nace `pendiente`: el motor los crea `en_curso` al empezarlos.
const ESTADOS_PIPELINE = ['pendiente', 'en_curso', 'completado', 'fallido'] as const
```

- [ ] **Step 5: Escribir la migración a mano**

Crea `packages/db/migraciones/0005_worker_pendiente.sql`:

```sql
ALTER TABLE "pipeline_runs" DROP CONSTRAINT "pipeline_runs_status_check";
--> statement-breakpoint
ALTER TABLE "pipeline_runs" ADD CONSTRAINT "pipeline_runs_status_check" CHECK (status in ('pendiente', 'en_curso', 'completado', 'fallido'));
--> statement-breakpoint
ALTER TABLE "pipeline_steps" DROP CONSTRAINT "pipeline_steps_status_check";
--> statement-breakpoint
ALTER TABLE "pipeline_steps" ADD CONSTRAINT "pipeline_steps_status_check" CHECK (status in ('pendiente', 'en_curso', 'completado', 'fallido'));
```

**Sin envoltorio `DO $$ ... EXCEPTION`**: una migración que se salta sola es peor que una que falla.

Y agrega la entrada al final del arreglo `entries` de `packages/db/migraciones/meta/_journal.json`, copiando la forma de las que ya están:

```json
    {
      "idx": 5,
      "version": "7",
      "when": 1786000000000,
      "tag": "0005_worker_pendiente",
      "breakpoints": true
    }
```

- [ ] **Step 6: Aplicar la migración a las dos bases**

Mira cómo se aplican las migraciones en este repositorio antes de inventar un comando:

```bash
grep -rn "migrate\|migraciones" packages/db/package.json packages/db/src/*.ts | grep -v test
```

Aplica a `gestor` y a `gestor_test` con el mecanismo que encuentres. **Las dos deben quedar idénticas**; si diverges, la suite pasa en local y falla en cualquier otro clon.

- [ ] **Step 7: Correr y verificar que pasa**

Run: `pnpm --filter @gc/db test catalogo`
Esperado: PASS.

- [ ] **Step 8: Confirmar que la prueba puede fallar**

Quita temporalmente `'pendiente'` de `ESTADOS_PIPELINE`.

Run: `pnpm --filter @gc/db test catalogo`
Esperado: FAIL.

**Restaura** y vuelve a correr: PASS.

- [ ] **Step 9: Suite completa**

```bash
pnpm -r typecheck && pnpm test 2>&1 | sed 's/\x1b\[[0-9;]*m//g' | grep -E 'Tests +[0-9]+ (passed|failed)'
```

Esperado: typecheck limpio, 290 pruebas, sin fallos.

- [ ] **Step 10: Commit**

```bash
git add -A
git commit -m "feat: pipeline_runs gana el estado pendiente

Es lo único que le faltaba a la tabla para ser la cola del worker: ya
tenía flujo, entrada, estado y error. Una corrida encolada por la web
nace pendiente y el worker la toma.

Los pasos comparten la constante por simetría, pero ninguno nace
pendiente: el motor los crea en_curso al empezarlos.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

## Task 2: Versionar la salida entre pasos

Sin esto, reanudar una corrida cuyo primer paso se completó con otra versión del código desestructura la salida a `undefined`. Falla ruidosamente, pero el mensaje no dice nada útil — y el botón de reanudar lo vuelve alcanzable.

**Archivos:**
- Modificar: `packages/pipeline/src/motor.ts`, `packages/pipeline/src/motor.test.ts`
- Modificar: `packages/flujos/src/p1.ts`, `packages/flujos/src/p2.ts`

**Interfaces:**
- Consume: nada de la Task 1
- Produce: `DefinicionDePaso` gana `versionDeSalida?: number` (por omisión `1`). El motor envuelve lo que un paso devuelve en `{ __v, datos }` al guardarlo y lo desenvuelve al reutilizarlo. Los pasos no se enteran.

- [ ] **Step 1: Escribir las pruebas que fallan**

Agrega a `packages/pipeline/src/motor.test.ts`:

```ts
  it('reanudar reutiliza la salida de un paso cuya versión calza', async () => {
    await conBaseDeDatosDePrueba(async (db) => {
      const ctx = await sembrarContexto(db)
      let vecesQueCorrioElPrimero = 0

      const flujo = {
        nombre: 'prueba_version',
        pasos: [
          definirPaso({
            nombre: 'uno',
            versionDeSalida: 3,
            async ejecutar() {
              vecesQueCorrioElPrimero++
              return { dato: 'a' }
            },
          }),
          definirPaso({
            nombre: 'dos',
            async ejecutar(entrada: { dato: string }) {
              if (vecesQueCorrioElPrimero === 1) throw transitorio('cae la primera vez')
              return { visto: entrada.dato }
            },
          }),
        ],
      }

      await expect(
        ejecutarFlujo(db, flujo, {}, ctx, { maxIntentos: 1 }),
      ).rejects.toThrow(/cae la primera vez/)

      const [corrida] = await db.select().from(esquema.pipelineRuns)
      const r = await ejecutarFlujo(db, flujo, {}, { ...ctx, runId: corrida!.id })

      expect(r.estado).toBe('completado')
      expect(r.salida).toEqual({ visto: 'a' })
      // El primero no se reejecutó: su salida se reutilizó.
      expect(vecesQueCorrioElPrimero).toBe(1)
    })
  })

  it('reanudar rechaza una salida de versión incompatible, nombrando el remedio', async () => {
    await conBaseDeDatosDePrueba(async (db) => {
      const ctx = await sembrarContexto(db)

      const v1 = {
        nombre: 'prueba_version',
        pasos: [
          definirPaso({ nombre: 'uno', versionDeSalida: 1, async ejecutar() { return { dato: 'a' } } }),
          definirPaso({ nombre: 'dos', async ejecutar() { throw transitorio('cae') } }),
        ],
      }

      await expect(ejecutarFlujo(db, v1, {}, ctx, { maxIntentos: 1 })).rejects.toThrow()
      const [corrida] = await db.select().from(esquema.pipelineRuns)

      // Misma corrida, el paso `uno` ahora produce otra forma.
      const v2 = {
        nombre: 'prueba_version',
        pasos: [
          definirPaso({ nombre: 'uno', versionDeSalida: 2, async ejecutar() { return { otro: 'b' } } }),
          definirPaso({ nombre: 'dos', async ejecutar() { return { ok: true } } }),
        ],
      }

      await expect(
        ejecutarFlujo(db, v2, {}, { ...ctx, runId: corrida!.id }),
      ).rejects.toThrow(/genérala de nuevo/i)
    })
  })

  it('una salida guardada sin sobre de versión se trata como incompatible', async () => {
    await conBaseDeDatosDePrueba(async (db) => {
      const ctx = await sembrarContexto(db)

      const flujo = {
        nombre: 'prueba_version',
        pasos: [
          definirPaso({ nombre: 'uno', async ejecutar() { return { dato: 'a' } } }),
          definirPaso({ nombre: 'dos', async ejecutar() { throw transitorio('cae') } }),
        ],
      }

      await expect(ejecutarFlujo(db, flujo, {}, ctx, { maxIntentos: 1 })).rejects.toThrow()
      const [corrida] = await db.select().from(esquema.pipelineRuns)

      // Simula una fila escrita antes de que el sobre existiera.
      await db
        .update(esquema.pipelineSteps)
        .set({ output: { dato: 'a' } })
        .where(eq(esquema.pipelineSteps.name, 'uno'))

      await expect(
        ejecutarFlujo(db, flujo, {}, { ...ctx, runId: corrida!.id }),
      ).rejects.toThrow(/genérala de nuevo/i)
    })
  })
```

Reutiliza el ayudante de siembra que ya exista en ese archivo; si se llama distinto de `sembrarContexto`, usa el nombre real. Ajusta los imports (`definirPaso`, `ejecutarFlujo`, `esquema`, `eq`, `transitorio`) a los que el archivo ya trae.

- [ ] **Step 2: Correr y verificar que fallan**

Run: `pnpm --filter @gc/pipeline test motor`
Esperado: FAIL — `versionDeSalida` no existe en el tipo y no hay rechazo por versión.

- [ ] **Step 3: El sobre, dentro del motor**

En `packages/pipeline/src/motor.ts`:

```ts
export interface DefinicionDePaso<E, S> {
  nombre: string
  /**
   * Versión de la forma que devuelve este paso. Se sube a mano cuando la forma
   * cambia, y sirve para que reanudar una corrida vieja no le entregue al paso
   * siguiente una salida que ya no sabe leer.
   *
   * Es un contador humano y no un hash a propósito: un hash rechazaría por
   * cambios cosméticos y entrenaría a la gente a ignorarlo.
   */
  versionDeSalida?: number
  ejecutar(entrada: E, ctx: ContextoDePaso): Promise<S>
}

const VERSION_POR_DEFECTO = 1

/** El sobre con que el motor guarda la salida de un paso. Los pasos no lo ven:
 *  el motor lo pone al guardar y lo quita al reutilizar. */
interface SobreDeSalida {
  __v: number
  datos: unknown
}

function esSobre(valor: unknown): valor is SobreDeSalida {
  return typeof valor === 'object' && valor !== null && '__v' in valor && 'datos' in valor
}
```

En `ejecutarFlujo`, el bloque de reutilización pasa a:

```ts
    const previo = await pasoCompletado(db, clave)
    if (previo) {
      valor = desenvolver(previo.output, paso, runId)
      continue
    }
```

Y agrega:

```ts
/**
 * Una corrida vieja pudo completar este paso con una versión anterior del
 * código, cuya salida el paso siguiente ya no sabe leer. Antes eso llegaba
 * como `undefined` y reventaba lejos del origen; ahora se rechaza aquí, con
 * un mensaje que dice qué hacer.
 *
 * Una salida sin sobre es de antes de que el sobre existiera, así que también
 * es incompatible.
 */
function desenvolver(
  salida: unknown,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  paso: DefinicionDePaso<any, any>,
  runId: string,
): unknown {
  const esperada = paso.versionDeSalida ?? VERSION_POR_DEFECTO

  if (!esSobre(salida) || salida.__v !== esperada) {
    const encontrada = esSobre(salida) ? String(salida.__v) : 'ninguna'
    throw permanente(
      `La corrida ${runId} guardó el paso "${paso.nombre}" con una versión de salida ` +
        `incompatible (esperada ${esperada}, encontrada ${encontrada}). No se puede reanudar: ` +
        `genérala de nuevo.`,
    )
  }

  return salida.datos
}
```

Y en `ejecutarPaso`, el `UPDATE` que marca el paso completado guarda el sobre:

```ts
      const salida = await paso.ejecutar(entrada, ctx)
      const sobre: SobreDeSalida = {
        __v: paso.versionDeSalida ?? VERSION_POR_DEFECTO,
        datos: salida,
      }
      await db
        .update(esquema.pipelineSteps)
        .set({
          status: 'completado',
          attempt: intento,
          output: sobre,
          error: null,
          finishedAt: new Date(),
        })
        .where(eq(esquema.pipelineSteps.id, idPaso))
      return salida
```

Nota que `return salida` devuelve el valor **sin** sobre: dentro de una misma invocación el paso siguiente recibe lo mismo que antes.

- [ ] **Step 4: Correr y verificar que pasan**

Run: `pnpm --filter @gc/pipeline test motor`
Esperado: PASS.

- [ ] **Step 5: Confirmar que pueden fallar**

Cambia temporalmente `salida.__v !== esperada` por `false` en `desenvolver`.

Run: `pnpm --filter @gc/pipeline test motor`
Esperado: FAIL en las dos pruebas de rechazo.

**Restaura** y vuelve a correr: PASS.

- [ ] **Step 6: Los pasos reales declaran su versión**

En `packages/flujos/src/p1.ts`, el paso `generar_estrategia` y el paso `persistir_estrategia` suman `versionDeSalida: 1`. Igual en `packages/flujos/src/p2.ts` para `proponer_grilla` y `persistir_grilla`.

Es explícito aunque coincida con el valor por omisión: quien cambie la forma de esa salida tiene que ver el número al lado para acordarse de subirlo.

- [ ] **Step 7: Suite completa**

```bash
pnpm -r typecheck && pnpm test 2>&1 | sed 's/\x1b\[[0-9;]*m//g' | grep -E 'Tests +[0-9]+ (passed|failed)'
```

Esperado: typecheck limpio, 293 pruebas, sin fallos.

- [ ] **Step 8: Commit**

```bash
git add -A
git commit -m "feat: la salida entre pasos lleva versión

Reanudar una corrida cuyo primer paso se completó con otra versión del
código le entregaba al segundo una salida que ya no sabía leer, y eso
llegaba como undefined y reventaba lejos del origen. Ahora se rechaza al
reanudar, con un mensaje que dice que hay que generar de nuevo.

El sobre vive dentro del motor: lo pone al guardar y lo quita al
reutilizar, así que los pasos no se enteran. Una salida sin sobre es de
antes de que existiera y también es incompatible.

El número es un contador humano y no un hash: un hash rechazaría por
cambios cosméticos y entrenaría a la gente a ignorarlo.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

## Task 3: Encolar, leer y reanudar corridas

La capa de dominio que comparten el worker y la web. Va antes que los dos porque los dos la consumen.

**Archivos:**
- Crear: `packages/operaciones/src/corridas.ts`, `packages/operaciones/src/corridas.test.ts`
- Modificar: `packages/operaciones/src/index.ts`

**Interfaces:**
- Consume: el estado `pendiente` de la Task 1
- Produce, desde `@gc/operaciones`:

```ts
export type EstadoDeCorrida = 'pendiente' | 'en_curso' | 'completado' | 'fallido'
export type FlujoEncolable = 'p1_estrategia' | 'p2_grilla'

export interface CorridaEnCurso {
  id: string
  flow: FlujoEncolable
  estado: EstadoDeCorrida
  error: string | null
  pasoActual: string | null
  encoladaHace: number   // segundos desde started_at
}

encolarEstrategia(db, organizationId, args: { slug: string; periodo: string }): Promise<string>
encolarGrilla(db, organizationId, args: { slug: string; mes: string }): Promise<string>
corridaDe(db, organizationId, args: { slug: string; flujo: FlujoEncolable; periodo: string }): Promise<CorridaEnCurso | null>
tomarCorridaPendiente(db): Promise<{ id, organizationId, brandId, flow, input } | null>
```

- [ ] **Step 1: Escribir las pruebas que fallan**

Crea `packages/operaciones/src/corridas.test.ts`:

```ts
import { conBaseDeDatosDePrueba } from '@gc/db/pruebas'
import { esquema } from '@gc/db'
import { and, eq } from 'drizzle-orm'
import { describe, expect, it } from 'vitest'
import { corridaDe, encolarGrilla, tomarCorridaPendiente } from './corridas.js'
import { sembrarConEstrategia } from './pruebas/siembra.js'

describe('encolarGrilla', () => {
  it('deja la corrida en pendiente, con la entrada que el flujo espera', async () => {
    await conBaseDeDatosDePrueba(async (db) => {
      const ref = await sembrarConEstrategia(db)
      const runId = await encolarGrilla(db, ref.organizationId, { slug: 'parcelas', mes: '2026-10' })

      const [fila] = await db
        .select()
        .from(esquema.pipelineRuns)
        .where(eq(esquema.pipelineRuns.id, runId))

      expect(fila!.status).toBe('pendiente')
      expect(fila!.flow).toBe('p2_grilla')
      expect(fila!.brandId).toBe(ref.brandId)
      expect(fila!.input).toEqual({ brandId: ref.brandId, mes: '2026-10' })
    })
  })

  it('rechaza un mes mal escrito antes de encolar nada', async () => {
    await conBaseDeDatosDePrueba(async (db) => {
      const ref = await sembrarConEstrategia(db)

      await expect(
        encolarGrilla(db, ref.organizationId, { slug: 'parcelas', mes: '2026-13' }),
      ).rejects.toThrow()

      const filas = await db.select().from(esquema.pipelineRuns)
      expect(filas).toHaveLength(0)
    })
  })
})

describe('tomarCorridaPendiente', () => {
  it('devuelve la corrida y la deja en_curso', async () => {
    await conBaseDeDatosDePrueba(async (db) => {
      const ref = await sembrarConEstrategia(db)
      const runId = await encolarGrilla(db, ref.organizationId, { slug: 'parcelas', mes: '2026-10' })

      const tomada = await tomarCorridaPendiente(db)

      expect(tomada?.id).toBe(runId)
      const [fila] = await db
        .select()
        .from(esquema.pipelineRuns)
        .where(eq(esquema.pipelineRuns.id, runId))
      expect(fila!.status).toBe('en_curso')
    })
  })

  it('sin corridas pendientes devuelve null', async () => {
    await conBaseDeDatosDePrueba(async (db) => {
      expect(await tomarCorridaPendiente(db)).toBeNull()
    })
  })

  it('dos consumidores concurrentes no toman la misma corrida', async () => {
    await conBaseDeDatosDePrueba(async (db) => {
      const ref = await sembrarConEstrategia(db)
      await encolarGrilla(db, ref.organizationId, { slug: 'parcelas', mes: '2026-10' })

      // Es la garantía de SKIP LOCKED, y es lo que se rompe al tocarlo.
      const [a, b] = await Promise.all([
        tomarCorridaPendiente(db),
        tomarCorridaPendiente(db),
      ])

      const tomadas = [a, b].filter((x) => x !== null)
      expect(tomadas).toHaveLength(1)
    })
  })

  it('toma la más antigua primero', async () => {
    await conBaseDeDatosDePrueba(async (db) => {
      const ref = await sembrarConEstrategia(db)
      const primera = await encolarGrilla(db, ref.organizationId, { slug: 'parcelas', mes: '2026-10' })
      // `started_at` tiene resolución suficiente, pero dos inserciones seguidas
      // pueden compartir marca: se separa explícitamente para que el ORDER BY
      // tenga algo que ordenar y la prueba no pase por casualidad.
      await new Promise((r) => setTimeout(r, 10))
      await encolarGrilla(db, ref.organizationId, { slug: 'parcelas', mes: '2026-11' })

      expect((await tomarCorridaPendiente(db))?.id).toBe(primera)
    })
  })
})

describe('corridaDe', () => {
  it('devuelve la corrida del periodo pedido, con su antigüedad', async () => {
    await conBaseDeDatosDePrueba(async (db) => {
      const ref = await sembrarConEstrategia(db)
      await encolarGrilla(db, ref.organizationId, { slug: 'parcelas', mes: '2026-10' })

      const c = await corridaDe(db, ref.organizationId, {
        slug: 'parcelas', flujo: 'p2_grilla', periodo: '2026-10',
      })

      expect(c?.estado).toBe('pendiente')
      expect(c?.encoladaHace).toBeGreaterThanOrEqual(0)
      expect(c?.pasoActual).toBeNull()
    })
  })

  it('no devuelve la corrida de otro mes', async () => {
    await conBaseDeDatosDePrueba(async (db) => {
      const ref = await sembrarConEstrategia(db)
      await encolarGrilla(db, ref.organizationId, { slug: 'parcelas', mes: '2026-10' })

      const c = await corridaDe(db, ref.organizationId, {
        slug: 'parcelas', flujo: 'p2_grilla', periodo: '2026-11',
      })

      expect(c).toBeNull()
    })
  })

  it('informa el paso en curso cuando lo hay', async () => {
    await conBaseDeDatosDePrueba(async (db) => {
      const ref = await sembrarConEstrategia(db)
      const runId = await encolarGrilla(db, ref.organizationId, { slug: 'parcelas', mes: '2026-10' })
      await db.insert(esquema.pipelineSteps).values({
        organizationId: ref.organizationId,
        runId,
        name: 'proponer_grilla',
        status: 'en_curso',
        idempotencyKey: `${runId}:proponer_grilla`,
      })

      const c = await corridaDe(db, ref.organizationId, {
        slug: 'parcelas', flujo: 'p2_grilla', periodo: '2026-10',
      })

      expect(c?.pasoActual).toBe('proponer_grilla')
    })
  })
})
```

- [ ] **Step 2: Correr y verificar que fallan**

Run: `pnpm --filter @gc/operaciones test corridas`
Esperado: FAIL con "Failed to resolve import ./corridas.js".

- [ ] **Step 3: Implementar**

Crea `packages/operaciones/src/corridas.ts`:

```ts
import { esquema, type BaseDeDatos } from '@gc/db'
import { permanente } from '@gc/shared'
import { trimestreDe, validarMes, validarPeriodo } from '@gc/strategy'
import { and, desc, eq, sql } from 'drizzle-orm'
import { resolverMarca } from './marcas.js'

export type EstadoDeCorrida = 'pendiente' | 'en_curso' | 'completado' | 'fallido'

/** Los dos flujos que la web sabe encolar, con los nombres que `pipeline_runs.flow` guarda. */
export type FlujoEncolable = 'p1_estrategia' | 'p2_grilla'

export interface CorridaEnCurso {
  id: string
  flow: FlujoEncolable
  estado: EstadoDeCorrida
  error: string | null
  /** El paso más reciente por `started_at`, o `null` si todavía no empezó ninguno. */
  pasoActual: string | null
  /** Segundos desde que se encoló. La pantalla lo usa para distinguir "en cola"
   *  de "nadie la tomó porque el worker no está corriendo". */
  encoladaHace: number
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

/**
 * Toma una corrida pendiente y la marca `en_curso`, atómicamente.
 *
 * `FOR UPDATE SKIP LOCKED` es lo que impide que dos workers tomen la misma:
 * el segundo salta la fila bloqueada en vez de esperarla. No hace falta hoy
 * —hay un solo worker— y no cuesta nada tenerlo, que es justo cuando conviene
 * ponerlo.
 *
 * No filtra por organización a propósito: el worker sirve a todas.
 */
export async function tomarCorridaPendiente(db: BaseDeDatos) {
  const filas = await db.execute(sql`
    UPDATE pipeline_runs SET status = 'en_curso'
    WHERE id = (
      SELECT id FROM pipeline_runs
      WHERE status = 'pendiente'
      ORDER BY started_at
      FOR UPDATE SKIP LOCKED
      LIMIT 1
    )
    RETURNING id, organization_id, brand_id, flow, input
  `)

  const fila = filas.rows[0]
  if (!fila) return null

  return {
    id: fila.id as string,
    organizationId: fila.organization_id as string,
    brandId: fila.brand_id as string | null,
    flow: fila.flow as string,
    input: fila.input as Record<string, unknown>,
  }
}

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
  const campo = args.flujo === 'p2_grilla' ? 'mes' : 'period'

  const [fila] = await db
    .select()
    .from(esquema.pipelineRuns)
    .where(
      and(
        eq(esquema.pipelineRuns.organizationId, organizationId),
        eq(esquema.pipelineRuns.brandId, ref.brandId),
        eq(esquema.pipelineRuns.flow, args.flujo),
        sql`${esquema.pipelineRuns.input}->>${sql.raw(`'${campo}'`)} = ${args.periodo}`,
      ),
    )
    .orderBy(desc(esquema.pipelineRuns.startedAt))
    .limit(1)

  if (!fila) return null

  const [paso] = await db
    .select({ name: esquema.pipelineSteps.name })
    .from(esquema.pipelineSteps)
    .where(eq(esquema.pipelineSteps.runId, fila.id))
    .orderBy(desc(esquema.pipelineSteps.startedAt))
    .limit(1)

  return {
    id: fila.id,
    flow: args.flujo,
    estado: fila.status as EstadoDeCorrida,
    error: fila.error,
    pasoActual: paso?.name ?? null,
    encoladaHace: Math.floor((Date.now() - fila.startedAt.getTime()) / 1000),
  }
}
```

Agrega a `packages/operaciones/src/index.ts`, en orden:

```ts
export * from './corridas.js'
```

Comprueba que `validarPeriodo` esté exportado desde `@gc/strategy`; si tiene otro nombre, usa el real.

- [ ] **Step 4: Correr y verificar que pasan**

Run: `pnpm --filter @gc/operaciones test corridas`
Esperado: PASS, 8 pruebas.

- [ ] **Step 5: Confirmar que la de concurrencia puede fallar**

Quita temporalmente `SKIP LOCKED` de la consulta.

Run: `pnpm --filter @gc/operaciones test corridas`
Esperado: FAIL o cuelgue en "dos consumidores concurrentes". Si en vez de fallar se cuelga, es la misma señal: sin `SKIP LOCKED` el segundo espera al primero.

**Restaura** y vuelve a correr: PASS.

- [ ] **Step 6: Confirmar que la del orden puede fallar**

Cambia temporalmente `ORDER BY started_at` por `ORDER BY started_at DESC`.

Run: `pnpm --filter @gc/operaciones test corridas`
Esperado: FAIL en "toma la más antigua primero".

**Restaura** y vuelve a correr: PASS.

- [ ] **Step 7: Suite completa**

```bash
pnpm -r typecheck && pnpm test 2>&1 | sed 's/\x1b\[[0-9;]*m//g' | grep -E 'Tests +[0-9]+ (passed|failed)'
```

Esperado: typecheck limpio, 301 pruebas, sin fallos.

- [ ] **Step 8: Commit**

```bash
git add -A
git commit -m "feat: encolar, leer y tomar corridas

La capa que comparten el worker y la web. Encolar valida la entrada
antes de insertar: una corrida con un mes inválido fallaría recién en el
worker, minutos después y lejos de quien la pidió.

Tomar usa FOR UPDATE SKIP LOCKED, que es lo que impide que dos workers
se lleven la misma corrida. No hace falta hoy y no cuesta nada, que es
justo cuando conviene ponerlo.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

## Task 4: El worker

**Archivos:**
- Crear: `apps/worker/package.json`, `tsconfig.json`, `vitest.config.ts`, `src/flujos.ts`, `src/tomar.ts`, `src/tomar.test.ts`, `src/main.ts`
- Modificar: `CLAUDE.md`

**Interfaces:**
- Consume: `tomarCorridaPendiente` de la Task 3, `crearFlujoEstrategia`/`crearFlujoGrilla` de `@gc/flujos`
- Produce: `tomarYEjecutarUna(db, deps): Promise<'nada' | 'completada' | 'fallida'>`

- [ ] **Step 1: El esqueleto del paquete**

`apps/worker/package.json`:

```json
{
  "name": "@gc/worker",
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
    "@gc/db": "workspace:*",
    "@gc/flujos": "workspace:*",
    "@gc/operaciones": "workspace:*",
    "@gc/pipeline": "workspace:*",
    "@gc/shared": "workspace:*",
    "dotenv": "^16.4.5"
  },
  "devDependencies": {
    "drizzle-orm": "^0.36.0",
    "tsx": "^4.19.1"
  }
}
```

`apps/worker/tsconfig.json`:

```json
{
  "extends": "../../tsconfig.base.json",
  "include": ["src"]
}
```

`apps/worker/vitest.config.ts`:

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

- [ ] **Step 2: Escribir las pruebas que fallan**

Crea `apps/worker/src/tomar.test.ts`:

```ts
import { ClienteFalso } from '@gc/ai'
import { esquema } from '@gc/db'
import { conBaseDeDatosDePrueba } from '@gc/db/pruebas'
import { encolarGrilla } from '@gc/operaciones'
import { sembrarConEstrategia } from '@gc/operaciones/pruebas'
import { eq } from 'drizzle-orm'
import { describe, expect, it } from 'vitest'
import { tomarYEjecutarUna } from './tomar.js'

const ENV = { MODELO_RAZONAMIENTO: 'proveedor/fuerte' }

const GRILLA = JSON.stringify({
  slots: [
    {
      fecha: '2026-10-07', hora: '13:00', canal: 'blog', formato: 'articulo',
      pilar: 'educacion', angulo: 'guía práctica',
      brief: 'Explicar paso a paso cómo verificar la factibilidad antes de comprar.',
    },
  ],
})

describe('tomarYEjecutarUna', () => {
  it('sin corridas pendientes no hace nada', async () => {
    await conBaseDeDatosDePrueba(async (db) => {
      expect(await tomarYEjecutarUna(db, { cliente: new ClienteFalso([]), env: ENV })).toBe('nada')
    })
  })

  it('ejecuta una corrida encolada y la deja completada', async () => {
    await conBaseDeDatosDePrueba(async (db) => {
      const ref = await sembrarConEstrategia(db)
      const runId = await encolarGrilla(db, ref.organizationId, { slug: 'parcelas', mes: '2026-10' })

      const r = await tomarYEjecutarUna(db, { cliente: new ClienteFalso([GRILLA]), env: ENV })

      expect(r).toBe('completada')
      const [fila] = await db
        .select()
        .from(esquema.pipelineRuns)
        .where(eq(esquema.pipelineRuns.id, runId))
      expect(fila!.status).toBe('completado')

      const slots = await db.select().from(esquema.planSlots)
      expect(slots.length).toBeGreaterThan(0)
    })
  })

  it('una corrida que falla queda fallida, con el error guardado', async () => {
    await conBaseDeDatosDePrueba(async (db) => {
      const ref = await sembrarConEstrategia(db)
      const runId = await encolarGrilla(db, ref.organizationId, { slug: 'parcelas', mes: '2026-10' })

      // Sin respuestas en el cliente, el flujo no puede proponer nada.
      const r = await tomarYEjecutarUna(db, { cliente: new ClienteFalso([]), env: ENV })

      expect(r).toBe('fallida')
      const [fila] = await db
        .select()
        .from(esquema.pipelineRuns)
        .where(eq(esquema.pipelineRuns.id, runId))
      expect(fila!.status).toBe('fallido')
      expect(fila!.error).toBeTruthy()
    })
  })

  it('un flujo desconocido deja la corrida fallida sin reintentar', async () => {
    await conBaseDeDatosDePrueba(async (db) => {
      const ref = await sembrarConEstrategia(db)
      const [fila] = await db
        .insert(esquema.pipelineRuns)
        .values({
          organizationId: ref.organizationId,
          brandId: ref.brandId,
          flow: 'flujo_del_futuro',
          status: 'pendiente',
          input: {},
        })
        .returning({ id: esquema.pipelineRuns.id })

      const r = await tomarYEjecutarUna(db, { cliente: new ClienteFalso([]), env: ENV })

      expect(r).toBe('fallida')
      const [despues] = await db
        .select()
        .from(esquema.pipelineRuns)
        .where(eq(esquema.pipelineRuns.id, fila!.id))
      expect(despues!.status).toBe('fallido')
      expect(despues!.error).toMatch(/flujo_del_futuro/)
    })
  })
})
```

`sembrarConEstrategia` vive hoy en `packages/operaciones/src/pruebas/siembra.ts` y no se exporta fuera del paquete. Agrégale a `packages/operaciones/package.json` una subruta de exportación `"./pruebas": "./src/pruebas/siembra.ts"` y usa ese camino, como ya hace `@gc/db` con `@gc/db/pruebas`.

- [ ] **Step 3: Correr y verificar que fallan**

Run: `pnpm install && pnpm --filter @gc/worker test`
Esperado: FAIL con "Failed to resolve import ./tomar.js".

- [ ] **Step 4: El mapa de flujos**

Crea `apps/worker/src/flujos.ts`:

```ts
import { crearFlujoEstrategia, crearFlujoGrilla, type Dependencias } from '@gc/flujos'
import { permanente } from '@gc/shared'
import type { DefinicionDeFlujo } from '@gc/pipeline'

/**
 * Los nombres son los que `pipeline_runs.flow` ya guarda desde que existe el
 * motor, así que este mapa no inventa una taxonomía nueva: la lee.
 */
export function flujoDe(nombre: string, deps: Dependencias): DefinicionDeFlujo {
  if (nombre === 'p1_estrategia') return crearFlujoEstrategia(deps)
  if (nombre === 'p2_grilla') return crearFlujoGrilla(deps)

  throw permanente(
    `El worker no sabe ejecutar el flujo "${nombre}". Es una fila corrupta o de una ` +
      `versión más nueva del código, y reintentarla solo repetiría el fallo.`,
  )
}
```

- [ ] **Step 5: La unidad de trabajo**

Crea `apps/worker/src/tomar.ts`:

```ts
import type { ClienteLlm } from '@gc/ai'
import { esquema, type BaseDeDatos } from '@gc/db'
import { tomarCorridaPendiente } from '@gc/operaciones'
import { ejecutarFlujo } from '@gc/pipeline'
import { eq } from 'drizzle-orm'
import { flujoDe } from './flujos.js'

export interface DependenciasDelWorker {
  cliente: ClienteLlm
  env?: Record<string, string | undefined>
}

export type ResultadoDeTurno = 'nada' | 'completada' | 'fallida'

/**
 * Una unidad de trabajo: toma una corrida pendiente, la ejecuta, devuelve qué
 * pasó. **Todo lo interesante del worker vive aquí y no en el bucle**, porque
 * un bucle no se prueba y esto sí.
 *
 * No lanza: un worker que muere porque una corrida falló deja de atender a las
 * demás. El error ya quedó registrado en `pipeline_runs.error` por el motor, o
 * lo registra esta función cuando el fallo ocurre antes de que el motor entre
 * en juego —un flujo desconocido, por ejemplo.
 */
export async function tomarYEjecutarUna(
  db: BaseDeDatos,
  deps: DependenciasDelWorker,
): Promise<ResultadoDeTurno> {
  const corrida = await tomarCorridaPendiente(db)
  if (!corrida) return 'nada'

  try {
    const flujo = flujoDe(corrida.flow, {
      cliente: deps.cliente,
      ...(deps.env !== undefined ? { env: deps.env } : {}),
    })

    await ejecutarFlujo(db, flujo, corrida.input, {
      organizationId: corrida.organizationId,
      runId: corrida.id,
      ...(corrida.brandId !== null ? { brandId: corrida.brandId } : {}),
    })

    return 'completada'
  } catch (error) {
    // `ejecutarFlujo` ya marcó la corrida fallida en su propio camino de error.
    // Esta escritura cubre el caso en que el fallo fue antes de entrar al motor
    // —un flujo que este worker no conoce— donde nadie más lo haría.
    await db
      .update(esquema.pipelineRuns)
      .set({
        status: 'fallido',
        error: error instanceof Error ? error.message : String(error),
        finishedAt: new Date(),
      })
      .where(eq(esquema.pipelineRuns.id, corrida.id))

    return 'fallida'
  }
}
```

- [ ] **Step 6: Correr y verificar que pasan**

Run: `pnpm --filter @gc/worker test`
Esperado: PASS, 4 pruebas.

- [ ] **Step 7: Confirmar que la del flujo desconocido puede fallar**

En `flujoDe`, cambia temporalmente el `throw permanente(...)` por `return crearFlujoGrilla(deps)`.

Run: `pnpm --filter @gc/worker test`
Esperado: FAIL en "un flujo desconocido".

**Restaura** y vuelve a correr: PASS.

- [ ] **Step 8: El bucle**

Crea `apps/worker/src/main.ts`:

```ts
import { crearCliente } from '@gc/ai'
import { crearConexion } from '@gc/db'
import { config } from 'dotenv'
import { fileURLToPath } from 'node:url'
import { tomarYEjecutarUna } from './tomar.js'

config({ path: fileURLToPath(new URL('../../../.env', import.meta.url)) })

const INTERVALO_MS = 2000

/**
 * El bucle es deliberadamente trivial: todo lo que vale la pena probar vive en
 * `tomarYEjecutarUna`. Es el primer proceso de este repositorio que corre
 * indefinidamente, y un bucle colgado no lo detecta ninguna prueba — así que
 * lo mejor que se puede hacer con él es que no tenga nada dentro.
 *
 * Cuando hay trabajo se encadena sin esperar: si acabas de completar una
 * corrida, es probable que haya otra detrás.
 */
async function principal(): Promise<void> {
  const url = process.env.DATABASE_URL
  if (!url) throw new Error('Falta DATABASE_URL')

  const { db } = crearConexion(url)
  const cliente = crearCliente(process.env.MODO_SECO === '1')

  console.log('[worker] escuchando corridas pendientes')

  for (;;) {
    let resultado: string
    try {
      resultado = await tomarYEjecutarUna(db, { cliente })
    } catch (error) {
      // `tomarYEjecutarUna` no lanza por corridas fallidas; si llega algo aquí
      // es la base caída o un fallo de infraestructura. Se registra y se sigue:
      // un worker que muere por eso deja de atender cuando vuelva.
      console.error('[worker] fallo inesperado:', error)
      resultado = 'nada'
    }

    if (resultado === 'nada') await new Promise((r) => setTimeout(r, INTERVALO_MS))
  }
}

principal().catch((error) => {
  console.error('[worker] no pudo arrancar:', error)
  process.exit(1)
})
```

Comprueba la firma real de `crearCliente` en `packages/ai/src/` y ajusta la línea que lo construye a lo que esa función espera; el CLI ya lo hace en `apps/cli/src/main.ts` y ese es el modelo a copiar.

- [ ] **Step 9: Comprobar que arranca de verdad**

```bash
pnpm --filter @gc/worker start
```

Esperado: imprime `[worker] escuchando corridas pendientes` y se queda. Córtalo con Ctrl+C.

Un proceso que arranca es lo mínimo que ninguna prueba de este plan verifica: hazlo a mano.

- [ ] **Step 10: Aislamiento y suite**

```bash
pnpm comprobar:aislamiento
pnpm -r typecheck
pnpm test 2>&1 | sed 's/\x1b\[[0-9;]*m//g' | grep -E 'RUN  v|Tests +[0-9]+ (passed|failed)'
```

Esperado: aislamiento en verde —**`apps/worker` sí puede resolver `@gc/ai`, y eso es correcto**: lo que el script exige es que `apps/web` y los paquetes que transpila no puedan—; typecheck limpio; **once paquetes** y 305 pruebas.

Si `@gc/worker` no aparece en la salida de las pruebas, detente: un paquete sin script `test` se salta en silencio.

- [ ] **Step 11: Actualizar `CLAUDE.md`**

En el bloque de arquitectura, agrega:

```
apps/worker     toma corridas pendientes y las ejecuta. Lo único que llama al modelo sin que se lo pidan
```

Y en Comandos:

```bash
pnpm --filter @gc/worker start   # el worker, si no lo levantaste con docker compose
```

- [ ] **Step 12: Commit**

```bash
git add -A
git commit -m "feat: el worker que ejecuta las corridas encoladas

Toda la lógica vive en tomarYEjecutarUna y el bucle es trivial a
propósito: es el primer proceso de este repositorio que corre
indefinidamente, y un bucle colgado no lo detecta ninguna prueba, así
que lo mejor que se puede hacer con él es que no tenga nada dentro.

No lanza por una corrida fallida: un worker que muere porque algo falló
deja de atender a lo que venga después.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

## Task 5: El worker en `docker compose`

Es lo que hace que `docker compose up -d` siga siendo el único comando, que era la queja que originó el bloque.

**Archivos:**
- Crear: `apps/worker/Dockerfile`, `.dockerignore` en la raíz
- Modificar: `docker-compose.yml`, `CLAUDE.md`

**Interfaces:**
- Consume: `apps/worker` de la Task 4
- Produce: el servicio `worker` en `docker compose`

- [ ] **Step 1: El Dockerfile**

Crea `apps/worker/Dockerfile`:

```dockerfile
# Imagen de desarrollo: el código se monta como volumen y se ejecuta con tsx,
# no se copia adentro. Copiarlo obligaría a reconstruir la imagen en cada
# cambio, que es exactamente la fricción que este bloque viene a quitar.
FROM node:22-alpine

RUN corepack enable pnpm || npm install -g pnpm@9

WORKDIR /app
CMD ["pnpm", "--filter", "@gc/worker", "start"]
```

`corepack enable` falla en algunas máquinas por permisos —en la de este proyecto, sin ir más lejos— así que el `||` deja la salida por npm.

- [ ] **Step 2: El `.dockerignore`**

Crea `.dockerignore` en la raíz:

```
node_modules
**/node_modules
.next
.git
```

Sin él, el contexto de build arrastra los `node_modules` del host, que además son enlaces de pnpm que no sirven dentro del contenedor.

- [ ] **Step 3: El servicio**

`docker-compose.yml` pasa a:

```yaml
services:
  postgres:
    image: postgres:16
    environment:
      POSTGRES_PASSWORD: postgres
      POSTGRES_DB: gestor
    ports: ["5432:5432"]
    volumes: ["pgdata:/var/lib/postgresql/data"]
    healthcheck:
      test: ["CMD-SHELL", "pg_isready -U postgres"]
      interval: 5s
      timeout: 3s
      retries: 10

  worker:
    build:
      context: .
      dockerfile: apps/worker/Dockerfile
    depends_on:
      postgres:
        condition: service_healthy
    env_file: [.env]
    # Dentro de la red de compose, Postgres es `postgres` y no `localhost`.
    # El .env de la raíz apunta al host, así que se sobrescribe aquí.
    environment:
      DATABASE_URL: postgres://postgres:postgres@postgres:5432/gestor
    volumes:
      - .:/app
      - /app/node_modules
    command: sh -c "pnpm install --frozen-lockfile && pnpm --filter @gc/worker start"

volumes:
  pgdata:
```

El volumen anónimo en `/app/node_modules` impide que el montaje del host tape los módulos instalados dentro del contenedor: son plataformas distintas y los binarios no son intercambiables.

- [ ] **Step 4: Levantarlo y comprobar que consume de verdad**

```bash
docker compose up -d --build
docker compose logs worker --tail 20
```

Esperado: `[worker] escuchando corridas pendientes`.

Ahora encola una corrida a mano contra la base de desarrollo y comprueba que el worker la toma. Usa el CLI para tener con qué:

```bash
docker compose exec -T postgres psql -U postgres -d gestor -c "INSERT INTO pipeline_runs (organization_id, brand_id, flow, status, input) SELECT b.organization_id, b.id, 'p2_grilla', 'pendiente', json_build_object('brandId', b.id, 'mes', '2026-11') FROM brands b WHERE b.slug = 'parcelas';"
```

```bash
sleep 5 && docker compose exec -T postgres psql -U postgres -d gestor -c "SELECT flow, status, error FROM pipeline_runs ORDER BY started_at DESC LIMIT 1;"
```

Esperado: la corrida ya no está en `pendiente`. Va a quedar en `fallido` si no hay clave de OpenRouter configurada, y eso está bien: lo que se comprueba aquí es que **el worker la tomó**, no que el modelo respondiera.

**Limpia después:** borra esa corrida y cualquier slot de `2026-11` que haya quedado, para devolver la base de desarrollo a su estado documentado.

- [ ] **Step 5: Actualizar `CLAUDE.md`**

En Comandos, la línea de `docker compose` pasa a:

```bash
docker compose up -d          # Postgres y el worker. Sin esto fallan seis paquetes y no se genera nada
```

Y en Entorno, agrega que el worker corre en un contenedor con el código montado como volumen, así que un cambio en `apps/worker` exige `docker compose restart worker` pero no reconstruir la imagen.

- [ ] **Step 6: Commit**

```bash
git add -A
git commit -m "feat: el worker se levanta con docker compose

docker compose up -d ya era el comando de arranque; ahora levanta
Postgres y el worker, así que operar el sistema deja de exigir una
terminal abierta.

El código se monta como volumen y corre con tsx en vez de copiarse a la
imagen: copiarlo obligaría a reconstruir en cada cambio, que es la
fricción que este bloque viene a quitar.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

## Task 6: Reanudar, desde el CLI y desde el dominio

**Archivos:**
- Modificar: `packages/operaciones/src/corridas.ts`, `packages/operaciones/src/corridas.test.ts`, `apps/cli/src/main.ts`

**Interfaces:**
- Consume: `corridaDe` y el sobre de versión de la Task 2
- Produce: `reanudarCorridaEncolada(db, organizationId, runId): Promise<void>`, que devuelve la corrida a `pendiente` para que el worker la retome

- [ ] **Step 1: Escribir las pruebas que fallan**

Agrega a `packages/operaciones/src/corridas.test.ts`:

```ts
describe('reanudarCorridaEncolada', () => {
  it('devuelve una corrida fallida a pendiente, y limpia su error', async () => {
    await conBaseDeDatosDePrueba(async (db) => {
      const ref = await sembrarConEstrategia(db)
      const runId = await encolarGrilla(db, ref.organizationId, { slug: 'parcelas', mes: '2026-10' })
      await db
        .update(esquema.pipelineRuns)
        .set({ status: 'fallido', error: 'lo que sea' })
        .where(eq(esquema.pipelineRuns.id, runId))

      await reanudarCorridaEncolada(db, ref.organizationId, runId)

      const [fila] = await db
        .select()
        .from(esquema.pipelineRuns)
        .where(eq(esquema.pipelineRuns.id, runId))
      expect(fila!.status).toBe('pendiente')
      expect(fila!.error).toBeNull()
    })
  })

  it('también reanuda una corrida colgada en en_curso', async () => {
    await conBaseDeDatosDePrueba(async (db) => {
      const ref = await sembrarConEstrategia(db)
      const runId = await encolarGrilla(db, ref.organizationId, { slug: 'parcelas', mes: '2026-10' })
      await db
        .update(esquema.pipelineRuns)
        .set({ status: 'en_curso' })
        .where(eq(esquema.pipelineRuns.id, runId))

      await reanudarCorridaEncolada(db, ref.organizationId, runId)

      const [fila] = await db
        .select()
        .from(esquema.pipelineRuns)
        .where(eq(esquema.pipelineRuns.id, runId))
      expect(fila!.status).toBe('pendiente')
    })
  })

  it('no reanuda una corrida completada', async () => {
    await conBaseDeDatosDePrueba(async (db) => {
      const ref = await sembrarConEstrategia(db)
      const runId = await encolarGrilla(db, ref.organizationId, { slug: 'parcelas', mes: '2026-10' })
      await db
        .update(esquema.pipelineRuns)
        .set({ status: 'completado' })
        .where(eq(esquema.pipelineRuns.id, runId))

      await expect(
        reanudarCorridaEncolada(db, ref.organizationId, runId),
      ).rejects.toThrow(/completado/)
    })
  })

  it('no reanuda la corrida de otra organización', async () => {
    await conBaseDeDatosDePrueba(async (db) => {
      const ref = await sembrarConEstrategia(db)
      const runId = await encolarGrilla(db, ref.organizationId, { slug: 'parcelas', mes: '2026-10' })
      const [otra] = await db
        .insert(esquema.organizations)
        .values({ name: 'Otra', slug: 'otra' })
        .returning({ id: esquema.organizations.id })

      await expect(
        reanudarCorridaEncolada(db, otra!.id, runId),
      ).rejects.toThrow()

      const [fila] = await db
        .select()
        .from(esquema.pipelineRuns)
        .where(eq(esquema.pipelineRuns.id, runId))
      expect(fila!.status).toBe('pendiente')
    })
  })
})
```

La última prueba parte de una corrida ya `pendiente`, así que afirma que **sigue** pendiente: eso no distingue nada por sí solo. Cámbiala para que la corrida esté `fallido` antes del intento y afirme que sigue `fallido` después.

- [ ] **Step 2: Correr y verificar que fallan**

Run: `pnpm --filter @gc/operaciones test corridas`
Esperado: FAIL — `reanudarCorridaEncolada` no existe.

- [ ] **Step 3: Implementar**

Agrega a `packages/operaciones/src/corridas.ts`:

```ts
/**
 * Devuelve una corrida a `pendiente` para que el worker la retome.
 *
 * No distingue "falló" de "se colgó": si el worker muere a mitad, la fila queda
 * `en_curso` para siempre; si un paso agota sus reintentos, queda `fallido`. En
 * ambos casos la operación correcta es la misma, porque el pipeline es
 * idempotente por paso y los ya completados no se reejecutan — el modelo no se
 * vuelve a pagar.
 *
 * Una corrida `completado` sí se rechaza: no hay nada que reanudar, y
 * permitirlo invitaría a usar este botón como "regenerar", que es otra cosa y
 * destruye lo que haya.
 */
export async function reanudarCorridaEncolada(
  db: BaseDeDatos,
  organizationId: string,
  runId: string,
): Promise<void> {
  const [fila] = await db
    .update(esquema.pipelineRuns)
    .set({ status: 'pendiente', error: null, finishedAt: null })
    .where(
      and(
        eq(esquema.pipelineRuns.id, runId),
        eq(esquema.pipelineRuns.organizationId, organizationId),
        inArray(esquema.pipelineRuns.status, ['fallido', 'en_curso']),
      ),
    )
    .returning({ id: esquema.pipelineRuns.id })

  if (fila) return

  const [actual] = await db
    .select({ status: esquema.pipelineRuns.status })
    .from(esquema.pipelineRuns)
    .where(
      and(
        eq(esquema.pipelineRuns.id, runId),
        eq(esquema.pipelineRuns.organizationId, organizationId),
      ),
    )

  if (!actual) throw permanente(`No existe la corrida ${runId} en esta organización`)
  throw permanente(
    `La corrida ${runId} está en estado "${actual.status}" y solo se reanuda una fallida o colgada`,
  )
}
```

Agrega `inArray` al import de `drizzle-orm`.

- [ ] **Step 4: Correr y verificar que pasan**

Run: `pnpm --filter @gc/operaciones test corridas`
Esperado: PASS.

- [ ] **Step 5: Confirmar que la guardia de tenencia puede fallar**

Quita temporalmente `eq(esquema.pipelineRuns.organizationId, organizationId)` del `where` del `UPDATE`.

Run: `pnpm --filter @gc/operaciones test corridas`
Esperado: FAIL en "no reanuda la corrida de otra organización".

**Restaura** y vuelve a correr: PASS.

- [ ] **Step 6: La bandera del CLI**

En `apps/cli/src/main.ts`, agrega el comando `corrida:reanudar --id <uuid>` al texto de ayuda, al conjunto `COMANDOS`, a las opciones de `parseArgs` (`id: { type: 'string' }`) y a la ramificación, llamando a `reanudarCorridaEncolada`.

Es la mitad que faltaba del insumo de Fase 1: el motor ya sabía reanudar y ninguna superficie lo exponía. Dejar el CLI sin la capacidad que la web tendrá es cómo nacen las divergencias entre las dos.

Sigue el estilo de los seis comandos que ya están ahí: mira cómo resuelven la organización, cómo imprimen y cómo manejan el error.

- [ ] **Step 7: Comprobar el comando a mano**

```bash
pnpm cli corrida:reanudar --id 00000000-0000-0000-0000-000000000000
```

Esperado: el mensaje en español de que no existe esa corrida, no una traza cruda.

- [ ] **Step 8: Suite completa y commit**

```bash
pnpm -r typecheck && pnpm test 2>&1 | sed 's/\x1b\[[0-9;]*m//g' | grep -E 'Tests +[0-9]+ (passed|failed)'
```

Esperado: typecheck limpio, 309 pruebas.

```bash
git add -A
git commit -m "feat: reanudar una corrida, desde el dominio y desde el CLI

El motor sabía reanudar desde que existe y ninguna superficie lo
exponía: si la persistencia agotaba sus reintentos, el usuario volvía a
correr el comando y el modelo se cobraba otra vez.

No distingue \"falló\" de \"se colgó\" porque el pipeline es idempotente
por paso: en ambos casos los pasos ya pagados no se reejecutan.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

## Task 7: Encolar y ver el avance desde la web

**Archivos:**
- Modificar: `apps/web/src/acciones.ts`
- Crear: `apps/web/src/componentes/EstadoDeCorrida.tsx` + `.test.tsx`, `apps/web/src/componentes/BotonGenerar.tsx` + `.test.tsx`
- Modificar: `apps/web/src/app/[marca]/grilla/[mes]/page.tsx`, `apps/web/src/app/[marca]/estrategia/page.tsx`

**Interfaces:**
- Consume: `encolarEstrategia`, `encolarGrilla`, `corridaDe`, `reanudarCorridaEncolada`, `CorridaEnCurso` de las tareas 3 y 6
- Produce: `encolarEstrategiaAccion(marca, periodo): Promise<Resultado>`, `encolarGrillaAccion(marca, mes): Promise<Resultado>`, `reanudarCorridaAccion(ruta, runId): Promise<Resultado>` — sin `marca`, porque la ruta a revalidar ya la contiene

- [ ] **Step 1: Las tres Server Actions**

En `apps/web/src/acciones.ts`, siguiendo el patrón de las cinco que ya existen:

```ts
/**
 * Encola y devuelve. **No ejecuta**: el worker toma la corrida y la corre. Es
 * lo que permite que esta acción responda al instante sin romper la regla de
 * que la web no hace trabajo largo ni llama al modelo.
 */
export async function encolarGrillaAccion(marca: string, mes: string): Promise<Resultado> {
  return ejecutar(`/${marca}/grilla/${mes}`, async (db, organizationId) => {
    await encolarGrilla(db, organizationId, { slug: marca, mes })
    return null
  })
}

export async function encolarEstrategiaAccion(marca: string, periodo: string): Promise<Resultado> {
  return ejecutar(`/${marca}/estrategia`, async (db, organizationId) => {
    await encolarEstrategia(db, organizationId, { slug: marca, periodo })
    return null
  })
}

export async function reanudarCorridaAccion(ruta: string, runId: string): Promise<Resultado> {
  return ejecutar(ruta, async (db, organizationId) => {
    await reanudarCorridaEncolada(db, organizationId, runId)
    return null
  })
}
```

Agrega los tres nombres al import de `@gc/operaciones`.

- [ ] **Step 2: Escribir la prueba del componente de estado**

Crea `apps/web/src/componentes/EstadoDeCorrida.test.tsx`:

```tsx
// @vitest-environment jsdom
import type { CorridaEnCurso } from '@gc/operaciones'
import { cleanup, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { reanudarCorridaAccion } from '../acciones.js'
import { EstadoDeCorrida } from './EstadoDeCorrida.js'

vi.mock('../acciones.js', () => ({ reanudarCorridaAccion: vi.fn() }))
vi.mock('next/navigation', () => ({ useRouter: () => ({ refresh: vi.fn() }) }))

afterEach(cleanup)
beforeEach(() => {
  vi.mocked(reanudarCorridaAccion).mockReset()
  vi.mocked(reanudarCorridaAccion).mockResolvedValue({ ok: true, datos: null })
})

function corrida(campos: Partial<CorridaEnCurso> = {}): CorridaEnCurso {
  return {
    id: 'run-1', flow: 'p2_grilla', estado: 'pendiente',
    error: null, pasoActual: null, encoladaHace: 3,
    ...campos,
  }
}

describe('EstadoDeCorrida', () => {
  it('una corrida recién encolada dice que está en cola', () => {
    render(<EstadoDeCorrida corrida={corrida()} ruta="/parcelas/grilla/2026-10" />)
    expect(screen.queryByText(/en cola/i)).not.toBeNull()
    expect(screen.queryByText(/worker/i)).toBeNull()
  })

  it('una pendiente vieja avisa que nadie la tomó y nombra el worker', () => {
    render(<EstadoDeCorrida corrida={corrida({ encoladaHace: 45 })} ruta="/parcelas/grilla/2026-10" />)
    expect(screen.queryByText(/nadie tom/i)).not.toBeNull()
    expect(screen.queryByText(/docker compose up -d/)).not.toBeNull()
  })

  it('traduce el nombre de máquina del paso en curso', () => {
    render(
      <EstadoDeCorrida
        corrida={corrida({ estado: 'en_curso', pasoActual: 'proponer_grilla' })}
        ruta="/parcelas/grilla/2026-10"
      />,
    )
    expect(screen.queryByText(/proponiendo la grilla/i)).not.toBeNull()
    expect(screen.queryByText('proponer_grilla')).toBeNull()
  })

  it('un paso desconocido se muestra tal cual en vez de romper', () => {
    render(
      <EstadoDeCorrida
        corrida={corrida({ estado: 'en_curso', pasoActual: 'paso_del_futuro' })}
        ruta="/parcelas/grilla/2026-10"
      />,
    )
    expect(screen.queryByText(/paso_del_futuro/)).not.toBeNull()
  })

  it('una corrida fallida muestra su error y ofrece reanudar con su id', async () => {
    render(
      <EstadoDeCorrida
        corrida={corrida({ estado: 'fallido', error: 'La base no respondió' })}
        ruta="/parcelas/grilla/2026-10"
      />,
    )
    expect(screen.queryByText('La base no respondió')).not.toBeNull()

    await userEvent.click(screen.getByRole('button', { name: 'Reanudar' }))

    expect(vi.mocked(reanudarCorridaAccion)).toHaveBeenCalledTimes(1)
    expect(vi.mocked(reanudarCorridaAccion)).toHaveBeenCalledWith('/parcelas/grilla/2026-10', 'run-1')
  })

  it('una corrida completada no se muestra', () => {
    const { container } = render(
      <EstadoDeCorrida corrida={corrida({ estado: 'completado' })} ruta="/parcelas/grilla/2026-10" />,
    )
    expect(container.textContent).toBe('')
  })
})
```

- [ ] **Step 3: Correr y verificar que falla**

Run: `pnpm --filter @gc/web test EstadoDeCorrida`
Esperado: FAIL con "Failed to resolve import ./EstadoDeCorrida.js".

- [ ] **Step 4: Implementar el componente**

Crea `apps/web/src/componentes/EstadoDeCorrida.tsx`:

```tsx
'use client'

import type { CorridaEnCurso } from '@gc/operaciones'
import { useRouter } from 'next/navigation'
import { useEffect, useState } from 'react'
import { reanudarCorridaAccion } from '../acciones.js'

/** Segundos tras los cuales una corrida `pendiente` deja de ser "en cola" y
 *  pasa a ser "nadie la tomó". Es el único detector del modo de falla que
 *  introduce tener un consumidor aparte: si el worker no corre, la pantalla
 *  diría "generando" para siempre. */
const SEGUNDOS_PARA_SOSPECHAR = 30

const REFRESCO_MS = 2000

/** Los nombres de paso son de máquina. Uno que no esté aquí se muestra tal
 *  cual: un paso nuevo en el motor no debe tumbar una pantalla. */
const PASOS_EN_PROSA: Record<string, string> = {
  generar_estrategia: 'Generando la estrategia',
  persistir_estrategia: 'Guardando la estrategia',
  proponer_grilla: 'Proponiendo la grilla',
  persistir_grilla: 'Guardando la grilla',
}

export function EstadoDeCorrida({ corrida, ruta }: { corrida: CorridaEnCurso; ruta: string }) {
  const router = useRouter()
  const [ocupado, setOcupado] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const viva = corrida.estado === 'pendiente' || corrida.estado === 'en_curso'

  // Refresca mientras hay algo que esperar, y **para cuando no lo hay**. Un
  // temporizador que no se detiene es la clase de cosa que se descubre semanas
  // después preguntándose por qué el ventilador no se apaga.
  useEffect(() => {
    if (!viva) return
    const t = setInterval(() => router.refresh(), REFRESCO_MS)
    return () => clearInterval(t)
  }, [viva, router])

  if (corrida.estado === 'completado') return null

  async function reanudar() {
    setOcupado(true)
    setError(null)
    const r = await reanudarCorridaAccion(ruta, corrida.id)
    if (!r.ok) setError(r.mensaje)
    setOcupado(false)
  }

  if (corrida.estado === 'fallido') {
    return (
      <div className="mb-4 rounded border border-red-300 bg-red-50 p-3 text-sm text-red-900">
        <p className="mb-2 font-medium">La generación falló.</p>
        <p className="mb-2 whitespace-pre-wrap">{corrida.error}</p>
        <p className="mb-2 text-xs">
          Reanudar retoma donde quedó: los pasos que ya se completaron no se vuelven a ejecutar,
          así que el modelo no se cobra de nuevo.
        </p>
        <button
          type="button"
          disabled={ocupado}
          onClick={() => void reanudar()}
          className="rounded border border-red-400 px-2 py-1 text-xs font-medium hover:bg-red-100 disabled:opacity-50"
        >
          Reanudar
        </button>
        {error && <p className="mt-2 text-xs">{error}</p>}
      </div>
    )
  }

  const abandonada = corrida.estado === 'pendiente' && corrida.encoladaHace > SEGUNDOS_PARA_SOSPECHAR

  if (abandonada) {
    return (
      <div className="mb-4 rounded border border-amber-300 bg-amber-50 p-3 text-sm text-amber-900">
        <p className="mb-2">
          Nadie tomó esta generación en {corrida.encoladaHace} segundos. Lo normal es que el worker
          no esté corriendo.
        </p>
        <p>
          Levántalo con{' '}
          <code className="rounded bg-amber-100 px-1.5 py-0.5 text-xs">docker compose up -d</code>
        </p>
      </div>
    )
  }

  return (
    <div className="mb-4 rounded border border-blue-300 bg-blue-50 p-3 text-sm text-blue-900">
      {corrida.estado === 'pendiente'
        ? 'En cola…'
        : `${corrida.pasoActual ? (PASOS_EN_PROSA[corrida.pasoActual] ?? corrida.pasoActual) : 'Generando'}…`}
    </div>
  )
}
```

- [ ] **Step 5: Correr y verificar que pasa**

Run: `pnpm --filter @gc/web test EstadoDeCorrida`
Esperado: PASS, 6 pruebas.

- [ ] **Step 6: Confirmar que tres de ellas pueden fallar**

Una mutación por prueba, restaurando entre cada una:

| Prueba | Mutación | Esperado |
|---|---|---|
| pendiente vieja avisa | `SEGUNDOS_PARA_SOSPECHAR` a `99999` | FAIL |
| traduce el paso | devolver `corrida.pasoActual` sin mirar el mapa | FAIL |
| completada no se muestra | quitar el `return null` de `completado` | FAIL |

Pega la salida de cada una.

- [ ] **Step 7: El botón de generar**

Crea `apps/web/src/componentes/BotonGenerar.tsx`:

```tsx
'use client'

import { useState } from 'react'
import { encolarEstrategiaAccion, encolarGrillaAccion } from '../acciones.js'

/**
 * Encola y devuelve. No espera al modelo: la pantalla se refresca sola y el
 * `EstadoDeCorrida` toma el relevo mostrando el avance.
 *
 * `advertencia`, cuando viene, obliga a confirmar. Lo usa la grilla para
 * decir que regenerar reemplaza los slots y pierde los descartes.
 */
export function BotonGenerar({
  marca,
  periodo,
  que,
  etiqueta,
  advertencia,
}: {
  marca: string
  periodo: string
  que: 'estrategia' | 'grilla'
  etiqueta: string
  advertencia?: string | undefined
}) {
  const [confirmando, setConfirmando] = useState(false)
  const [ocupado, setOcupado] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function generar() {
    setOcupado(true)
    setError(null)
    const r =
      que === 'grilla'
        ? await encolarGrillaAccion(marca, periodo)
        : await encolarEstrategiaAccion(marca, periodo)
    if (!r.ok) setError(r.mensaje)
    setOcupado(false)
    setConfirmando(false)
  }

  if (advertencia && confirmando) {
    return (
      <div className="max-w-sm rounded border border-amber-300 bg-amber-50 p-3 text-left text-sm text-amber-900">
        <p className="mb-2">{advertencia}</p>
        <div className="flex flex-wrap gap-2">
          <button
            type="button"
            disabled={ocupado}
            onClick={() => void generar()}
            className="rounded bg-indigo-600 px-2 py-1 text-xs font-medium text-white hover:bg-indigo-700 disabled:opacity-50"
          >
            Sí, generar
          </button>
          <button
            type="button"
            disabled={ocupado}
            onClick={() => setConfirmando(false)}
            className="rounded px-2 py-1 text-xs font-medium text-amber-700 hover:bg-amber-100 disabled:opacity-50"
          >
            Cancelar
          </button>
        </div>
        {error && <p className="mt-2 text-xs text-red-800">{error}</p>}
      </div>
    )
  }

  return (
    <div className="flex flex-col items-end gap-1">
      <button
        type="button"
        disabled={ocupado}
        onClick={() => (advertencia ? setConfirmando(true) : void generar())}
        className="rounded bg-indigo-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-indigo-700 disabled:opacity-50"
      >
        {etiqueta}
      </button>
      {error && <p className="text-xs text-red-800">{error}</p>}
    </div>
  )
}
```

- [ ] **Step 8: Su prueba**

Crea `apps/web/src/componentes/BotonGenerar.test.tsx`:

```tsx
// @vitest-environment jsdom
import { cleanup, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { encolarEstrategiaAccion, encolarGrillaAccion } from '../acciones.js'
import { BotonGenerar } from './BotonGenerar.js'

vi.mock('../acciones.js', () => ({
  encolarGrillaAccion: vi.fn(),
  encolarEstrategiaAccion: vi.fn(),
}))

afterEach(cleanup)
beforeEach(() => {
  for (const m of [encolarGrillaAccion, encolarEstrategiaAccion]) {
    vi.mocked(m).mockReset()
    vi.mocked(m).mockResolvedValue({ ok: true, datos: null })
  }
})

describe('BotonGenerar', () => {
  it('sin advertencia encola al primer clic', async () => {
    render(<BotonGenerar marca="parcelas" periodo="2026-10" que="grilla" etiqueta="Generar grilla" />)
    await userEvent.click(screen.getByRole('button', { name: 'Generar grilla' }))

    expect(vi.mocked(encolarGrillaAccion)).toHaveBeenCalledTimes(1)
    expect(vi.mocked(encolarGrillaAccion)).toHaveBeenCalledWith('parcelas', '2026-10')
  })

  it('con advertencia no encola hasta que se confirma, y la muestra', async () => {
    render(
      <BotonGenerar
        marca="parcelas" periodo="2026-10" que="grilla" etiqueta="Regenerar grilla"
        advertencia="Regenerar reemplaza los slots y pierdes los descartes."
      />,
    )

    await userEvent.click(screen.getByRole('button', { name: 'Regenerar grilla' }))
    expect(vi.mocked(encolarGrillaAccion)).not.toHaveBeenCalled()
    expect(screen.queryByText(/pierdes los descartes/)).not.toBeNull()

    await userEvent.click(screen.getByRole('button', { name: 'Sí, generar' }))
    expect(vi.mocked(encolarGrillaAccion)).toHaveBeenCalledTimes(1)
  })

  it('cancelar no encola', async () => {
    render(
      <BotonGenerar
        marca="parcelas" periodo="2026-10" que="grilla" etiqueta="Regenerar grilla"
        advertencia="Regenerar reemplaza los slots."
      />,
    )
    await userEvent.click(screen.getByRole('button', { name: 'Regenerar grilla' }))
    await userEvent.click(screen.getByRole('button', { name: 'Cancelar' }))

    expect(vi.mocked(encolarGrillaAccion)).not.toHaveBeenCalled()
    expect(screen.queryByRole('button', { name: 'Regenerar grilla' })).not.toBeNull()
  })

  it('el flujo de estrategia llama a la acción de estrategia y no a la de grilla', async () => {
    render(
      <BotonGenerar marca="parcelas" periodo="2026-Q4" que="estrategia" etiqueta="Generar estrategia" />,
    )
    await userEvent.click(screen.getByRole('button', { name: 'Generar estrategia' }))

    expect(vi.mocked(encolarEstrategiaAccion)).toHaveBeenCalledWith('parcelas', '2026-Q4')
    expect(vi.mocked(encolarGrillaAccion)).not.toHaveBeenCalled()
  })
})
```

- [ ] **Step 9: Correr, y confirmar que la de la advertencia puede fallar**

Run: `pnpm --filter @gc/web test BotonGenerar`
Esperado: PASS, 4 pruebas.

Cambia temporalmente el `onClick` del botón principal por `() => void generar()`, ignorando `advertencia`.

Esperado: FAIL en "no encola hasta que se confirma".

**Restaura** y vuelve a correr: PASS.

- [ ] **Step 10: Cablear las dos pantallas**

En `apps/web/src/app/[marca]/grilla/[mes]/page.tsx`: leer la corrida con `corridaDe(db, organizationId, { slug: marca, flujo: 'p2_grilla', periodo: mes })`, renderizar `<EstadoDeCorrida>` bajo la cabecera cuando exista, y reemplazar el bloque que hoy imprime `pnpm cli grilla:generar` por `<BotonGenerar ... etiqueta="Generar grilla" />`.

Cuando **sí** hay grilla en borrador, la cabecera suma un `<BotonGenerar ... etiqueta="Regenerar grilla" advertencia="..." />`. El texto de la advertencia es de la Task 9; hasta entonces usa: *"Regenerar la grilla de {mes} reemplaza todas sus publicaciones. Las que hayas descartado o editado se pierden."*

En `apps/web/src/app/[marca]/estrategia/page.tsx`: lo mismo con `flujo: 'p1_estrategia'` y `periodo` el trimestre, reemplazando el bloque que imprime `pnpm cli estrategia:generar`.

Las dos rutas conservan su `export const dynamic = 'force-dynamic'`.

- [ ] **Step 11: Suite, aislamiento y build**

```bash
pnpm -r typecheck
pnpm test 2>&1 | sed 's/\x1b\[[0-9;]*m//g' | grep -E 'Tests +[0-9]+ (passed|failed)'
pnpm comprobar:aislamiento
pnpm --filter @gc/web build
```

Esperado: typecheck limpio; 319 pruebas; aislamiento en verde; build con las rutas del dominio en `ƒ`.

- [ ] **Step 12: Commit**

```bash
git add -A
git commit -m "feat: generar y ver el avance desde la web

Las acciones encolan y devuelven; el worker ejecuta. La pantalla que
disparó la generación muestra su estado, y se refresca sola mientras
hay algo que esperar — y para cuando no lo hay.

Una corrida pendiente que nadie tomó en 30 segundos deja de decir \"en
cola\" y pasa a nombrar el worker: es el único detector del modo de
falla que introduce tener un consumidor aparte.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

## Task 8: Crear marca y perfil desde la web

**Archivos:**
- Modificar: `apps/web/src/acciones.ts`, `apps/web/src/app/page.tsx`, `apps/web/src/app/[marca]/perfil/page.tsx`, `packages/operaciones/src/perfiles.ts`
- Crear: `apps/web/src/componentes/FormularioDeMarca.tsx` + `.test.tsx`

**Interfaces:**
- Consume: `Resultado<T>` y el arnés de componentes ya existentes
- Produce: `crearMarcaAccion(slug, nombre, presupuesto): Promise<Resultado>`, y `perfilConHistorial` pasa a devolver `null` en vez de lanzar cuando la marca no tiene perfil

- [ ] **Step 1: La prueba del hueco del perfil**

`perfilConHistorial` lanza `permanente` si la marca no tiene ninguno. Hoy es inalcanzable porque toda marca nace del CLI con su perfil detrás; en cuanto la web pueda crear marcas, la primera visita a esa pantalla revienta.

Agrega a `packages/operaciones/src/perfiles.test.ts`:

```ts
  it('perfilConHistorial devuelve null cuando la marca todavía no tiene perfil', async () => {
    await conBaseDeDatosDePrueba(async (db) => {
      const [org] = await db
        .insert(esquema.organizations)
        .values({ name: 'Principal', slug: 'principal' })
        .returning({ id: esquema.organizations.id })
      await db
        .insert(esquema.brands)
        .values({ organizationId: org!.id, slug: 'nueva', name: 'Nueva' })

      expect(await perfilConHistorial(db, org!.id, 'nueva')).toBeNull()
    })
  })
```

- [ ] **Step 2: Correr, implementar, correr**

Run: `pnpm --filter @gc/operaciones test perfiles` → FAIL.

En `packages/operaciones/src/perfiles.ts`, `perfilConHistorial` pasa a `Promise<PerfilConHistorial | null>` y el `if (!vigente)` devuelve `null` en vez de lanzar, con un comentario que diga por qué: una marca recién creada desde la web todavía no tiene perfil, y eso es un estado normal, no un error.

Run de nuevo → PASS. Y `pnpm -r typecheck` te va a señalar el sitio de la web que asume no-nulo; arréglalo en el Step 5.

- [ ] **Step 3: La acción de crear marca**

En `apps/web/src/acciones.ts`:

```ts
export async function crearMarcaAccion(
  slug: string,
  nombre: string,
  presupuestoUsd: string,
): Promise<Resultado> {
  return ejecutar('/', async (db, organizationId) => {
    await crearMarca(db, organizationId, {
      slug,
      nombre,
      ...(presupuestoUsd !== '' ? { presupuesto: presupuestoUsd } : {}),
    })
    return null
  })
}
```

Comprueba la firma real de `crearMarca` en `packages/operaciones/src/marcas.ts` y ajusta los nombres de los argumentos a los que espera. La validación del slug vive en el dominio, no aquí.

- [ ] **Step 4: El formulario y su prueba**

Crea `apps/web/src/componentes/FormularioDeMarca.tsx`, un componente de cliente con tres campos (slug, nombre, presupuesto opcional), que llama a `crearMarcaAccion` y muestra el mensaje de error tal cual si falla. Sigue el patrón de `EditorDePerfil.tsx`: estado local, `disabled` mientras está ocupado, y el mensaje del dominio sin envolver.

Crea `apps/web/src/componentes/FormularioDeMarca.test.tsx` con tres pruebas, cada una falsificada con su propia mutación:

1. Que enviar llame a `crearMarcaAccion` con los tres valores escritos.
2. Que un error del dominio se muestre tal cual y **no** se limpien los campos — perder lo escrito ante un slug repetido es la clase de detalle que enfurece.
3. Que con el presupuesto vacío la acción reciba cadena vacía y no `undefined` ni `"0"`.

- [ ] **Step 5: Las dos pantallas**

En `apps/web/src/app/page.tsx`, agregar el `<FormularioDeMarca />`. Esa ruta ya declara `force-dynamic`; confírmalo.

En `apps/web/src/app/[marca]/perfil/page.tsx`, manejar el `null`: cuando no hay perfil, mostrar el editor con una plantilla de partida. Usa `PERFIL_VALIDO` de `@gc/brand` como plantilla si está exportado; si no, un objeto mínimo que cumpla el esquema, y dilo en el informe.

- [ ] **Step 6: Suite, build y commit**

```bash
pnpm -r typecheck && pnpm test 2>&1 | sed 's/\x1b\[[0-9;]*m//g' | grep -E 'Tests +[0-9]+ (passed|failed)' && pnpm --filter @gc/web build
```

Esperado: typecheck limpio, 323 pruebas, build con las rutas del dominio en `ƒ`.

```bash
git add -A
git commit -m "feat: crear marca y arrancar su perfil desde la web

perfilConHistorial lanzaba cuando la marca no tenía perfil. Era
inalcanzable mientras toda marca naciera del CLI con el suyo detrás; en
cuanto la web puede crearlas, la primera visita a esa pantalla
reventaba. Ahora devuelve null y la pantalla muestra el editor vacío.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

## Task 9: Los slots descartados no cuentan al regenerar

Con el botón de regenerar en pantalla, esto deja de ser teórico: `expandirDerivados` y `validarGrilla` no miran `status`, así que recontarían en cadencia y en distribución de pilares los slots que ya descartaste.

**Archivos:**
- Modificar: `packages/strategy/src/validacion.ts`, `packages/strategy/src/derivados.ts` y sus pruebas
- Modificar: `packages/flujos/src/p2.ts`
- Modificar: `apps/web/src/app/[marca]/grilla/[mes]/page.tsx`

**Interfaces:**
- Consume: el `BotonGenerar` con advertencia de la Task 7
- Produce: nada nuevo hacia otras tareas

- [ ] **Step 1: Entender qué recibe cada función**

Antes de escribir nada:

```bash
grep -n "descartado\|status" packages/strategy/src/validacion.ts packages/strategy/src/derivados.ts packages/flujos/src/p2.ts
```

`TipoSlotPropuesto` no tiene campo de estado: la propuesta del modelo no conoce descartes. Los descartados viven en `plan_slots`, y quien los lee es `p2.ts` al comprobar el estado de la grilla.

**Determina y reporta dónde está realmente el recuento** antes de cambiar código. Si resulta que `validarGrilla` solo ve la propuesta nueva —y por tanto nunca vio un descarte—, entonces el defecto registrado no existe en el camino de regeneración, y lo correcto es **decirlo en el informe y no inventar un arreglo**. Este plan no puede resolverlo por ti sin leer el código contigo.

- [ ] **Step 2: Escribir la prueba de lo que sí sea el defecto**

Con lo que encuentres en el Step 1, escribe la prueba que lo fija: una grilla con slots descartados que se regenera, y la afirmación de que los descartados no participan del cálculo.

Si el Step 1 concluye que no hay defecto, **salta a los pasos 4 y 5**: la advertencia en pantalla sigue haciendo falta igual, porque regenerar sí destruye los descartes aunque no los recuente.

- [ ] **Step 3: Implementar y falsificar**

Rompe el arreglo a propósito y confirma que la prueba se pone roja.

- [ ] **Step 4: La advertencia definitiva**

En `apps/web/src/app/[marca]/grilla/[mes]/page.tsx`, el `advertencia` del botón de regenerar pasa a nombrar el número real:

```tsx
advertencia={
  `Regenerar la grilla de ${mes} reemplaza todas sus publicaciones. ` +
  (descartados > 0
    ? `Las ${descartados} que descartaste vuelven a aparecer, y las ediciones que hiciste a mano se pierden.`
    : 'Las ediciones que hayas hecho a mano se pierden.')
}
```

donde `descartados` es `grilla.slots.filter((s) => s.descartado).length`.

- [ ] **Step 5: Suite, build y commit**

```bash
pnpm -r typecheck && pnpm test 2>&1 | sed 's/\x1b\[[0-9;]*m//g' | grep -E 'Tests +[0-9]+ (passed|failed)' && pnpm --filter @gc/web build
```

```bash
git add -A
git commit -m "fix: regenerar avisa lo que destruye, y no recuenta descartes

Con el botón de regenerar en pantalla, perder los descartes pasa de ser
imposible a ser un clic. La confirmación nombra cuántos son.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

## Verificación final de la rama

- [ ] **Las pruebas de dominio**

```bash
pnpm test 2>&1 | sed 's/\x1b\[[0-9;]*m//g' | grep -E 'RUN  v|Tests +[0-9]+ (passed|failed)'
```

Esperado: **once paquetes**, cero fallos. `@gc/worker` entre ellos.

- [ ] **El bundle y el aislamiento**

```bash
pnpm -r typecheck && pnpm --filter @gc/web build && pnpm comprobar:aislamiento
```

Esperado: typecheck limpio; build con las rutas del dominio en `ƒ`; aislamiento en verde **con `apps/worker` fuera del cierre de `apps/web`**.

- [ ] **El uso real, de principio a fin, sin tocar la terminal**

```bash
docker compose up -d --build
```

Y desde `http://localhost:3000`, con la marca `parcelas`:

1. Ir a la grilla de `2026-11`, que no existe. Pulsar **Generar grilla**.
2. La pantalla debe pasar a "En cola…" y luego al paso en curso, sola, sin recargar a mano.
3. Al terminar, la grilla aparece.
4. Detener el worker (`docker compose stop worker`), encolar otra generación, y comprobar que a los 30 segundos la pantalla avisa que nadie la tomó.
5. Levantar el worker de nuevo y comprobar que la toma.
6. Provocar un fallo —quitar la clave de OpenRouter del `.env` y reiniciar el worker— y comprobar que la pantalla muestra el error y ofrece **Reanudar**.

**Restaurar la base de desarrollo al terminar:** borrar la grilla de `2026-11` y sus corridas, y dejar `parcelas` con su estrategia `2026-Q3` y la grilla de `2026-09` en borrador, como documenta `CLAUDE.md`.

- [ ] **Actualizar `pendientes.md`**

Mover a cerrados los insumos de Fase 1 que esta rama resolvió (reanudar, versionado de salida, y lo que el Step 1 de la Task 9 haya concluido sobre los descartados), con una línea por cada uno diciendo cómo se resolvió. Registrar lo que quede abierto: la agenda mensual, y que el cuarto insumo —los tres nombres para el mismo concepto— no entró.

- [ ] **Cerrar la rama**

Usa la skill `superpowers:finishing-a-development-branch`.

---

## Notas para quien ejecute

**El orden importa.** Las tareas 1 y 2 tocan el motor y la base, y todo lo demás las asume. La 3 es la capa que consumen el worker (4) y la web (7). La 5 depende de la 4. Las tareas 8 y 9 son independientes entre sí.

**Los conteos son acumulativos y orientativos:** 289 → 290 (T1) → 293 (T2) → 301 (T3) → 305 (T4) → 309 (T6) → 319 (T7) → 323 (T8). **Si necesitas una prueba más para que algo afirme de verdad lo que su nombre promete, escríbela** y dilo en el informe. En la rama anterior un agente descartó una prueba necesaria para calzar con un conteo que yo le había dado; el conteo sirve para detectar pasos saltados, no para mandar sobre la cobertura.

**Lo que el spec pedía y este plan NO cubre.** El §7.4 del spec —unificar `brandSlug`, `nombreVisible` y `slug`, más las dos interfaces idénticas por accidente— quedó fuera. La razón es de tamaño: una rama anterior ya descubrió que ese cambio toca nueve sitios y no cinco, y este plan ya son nueve tareas. El worker sí agrega un décimo sitio que elige nombre, así que la deuda empeora un poco. Queda registrado en `pendientes.md` y es candidato natural a una rama corta propia.

**Tres pasos están especificados en prosa y no en código**, a propósito y no por descuido: la bandera del CLI (Task 6, Step 6), el cableado de las dos pantallas (Task 7, Step 10) y el formulario de marca (Task 8, Step 4). Los tres consisten en repetir un patrón que ya existe varias veces en el archivo que se edita, y transcribirlo aquí haría que el plan y el código divergieran en cuanto uno de los dos cambiara. Cada uno nombra el archivo modelo que hay que leer primero. **Si al leerlo el patrón no queda claro, dilo en el informe en vez de improvisar uno nuevo.**

**La Task 9 tiene un paso de investigación deliberado.** Su Step 1 puede concluir que el defecto registrado no existe en ese camino. Concluirlo y decirlo es el resultado correcto; inventar un arreglo para un defecto que no está, no.
