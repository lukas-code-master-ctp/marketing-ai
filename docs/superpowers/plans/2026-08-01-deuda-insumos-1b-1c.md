# Deuda de insumos para 1B y 1C — Plan de implementación

> **Para trabajadores agénticos:** SUB-SKILL REQUERIDA: usa `superpowers:subagent-driven-development` (recomendado) o `superpowers:executing-plans` para implementar este plan tarea por tarea. Los pasos usan casillas (`- [ ]`) para seguimiento.

**Objetivo:** cerrar los cinco insumos que la revisión de `feat/app-web-1a` dejó registrados, para que los bloques 1B y 1C arranquen sin deuda de diseño heredada.

**Arquitectura:** `p1`, `p2` y los flujos que llaman al modelo salen a un paquete nuevo `@gc/flujos`, de modo que `@gc/strategy` y `@gc/operaciones` dejen de depender de `@gc/ai` y la web no pueda resolverlo. La lectura de estrategia por trimestre, hoy triplicada, queda en una sola función con la política de archivadas como parámetro. La web suma un arnés de pruebas de componentes de cliente y cierra seis ítems de deuda menor.

**Stack:** pnpm workspaces, TypeScript 5 ESM, Vitest 2.1 contra Postgres real, Next.js 15 App Router, Zod 3, Drizzle ORM.

**Spec:** [2026-08-01-deuda-insumos-1b-1c-design.md](../specs/2026-08-01-deuda-insumos-1b-1c-design.md)

## Restricciones globales

Copiadas de `CLAUDE.md` y del spec. Aplican a **todas** las tareas.

- **`pnpm test` desde la raíz, NUNCA `pnpm -r test`.** Todos los paquetes comparten la base de pruebas y cada prueba la vacía al empezar; en paralelo se pisan. El script de la raíz los serializa con `--workspace-concurrency=1`.
- **Un solo `.env`, en la raíz.** Ningún paquete tiene el suyo.
- **Idioma:** esquema y columnas en inglés `snake_case`. API de dominio, variables, comentarios, prompts y todo texto que ve el usuario, en español neutro.
- **Ninguna salida del modelo se parsea con expresiones regulares.** Toda tarea declara un esquema Zod y valida. Validar entrada de usuario con regex sí es válido.
- **La capa web nunca ejecuta trabajo largo ni llama al modelo.**
- **Cada ruta de Next necesita su propio `export const dynamic = 'force-dynamic'`.** No se propaga entre árboles de rutas.
- **Los modelos se leen del entorno**, nunca literales en código.
- **Una prueba que no puede fallar es peor que ninguna.** Al escribir una prueba de regresión, rompe el código a propósito y confirma que se pone roja **antes** de darla por buena.
- **No hay migraciones en este plan.** Ninguna tarea toca `packages/db/migrations/`.
- **Punto de partida:** `master` en `2d31e2a`, 252 pruebas verdes repartidas en nueve paquetes (`db` 22, `shared` 34, `ai` 29, `brand` 13, `pipeline` 14, `strategy` 93, `operaciones` 31, `cli` 3, `web` 13).
- **Antes de empezar cualquier tarea:** `docker compose up -d`.

---

## Estructura de archivos

### Paquete nuevo

| Archivo | Responsabilidad |
|---|---|
| `packages/flujos/package.json` | Manifiesto. Es el único paquete además de `@gc/ai` que declara `@gc/ai` |
| `packages/flujos/tsconfig.json` | Extiende `tsconfig.base.json` |
| `packages/flujos/vitest.config.ts` | Idéntico al de `@gc/strategy` |
| `packages/flujos/src/index.ts` | Barril: `p1`, `p2`, `tipos`, `flujos` |
| `packages/flujos/src/p1.ts` + `.test.ts` | Flujo P1, movido desde `@gc/strategy` |
| `packages/flujos/src/p2.ts` + `.test.ts` | Flujo P2, movido desde `@gc/strategy` |
| `packages/flujos/src/tipos.ts` | `Dependencias`, movido desde `@gc/strategy` |
| `packages/flujos/src/flujos.ts` | `generarEstrategia`, `generarGrilla`, movidos desde `@gc/operaciones` |
| `packages/flujos/src/prompts/*.md` | Movidos desde `@gc/strategy` |

### Archivos modificados

| Archivo | Cambio |
|---|---|
| `packages/strategy/src/index.ts` | Deja de exportar `p1`, `p2`, `tipos`; exporta `estrategias` |
| `packages/strategy/src/estrategias.ts` (nuevo) | `leerEstrategiaDelTrimestre`, el lector único |
| `packages/strategy/src/estrategias.test.ts` (nuevo) | Su cobertura |
| `packages/strategy/package.json` | Sin `@gc/ai` ni `@gc/pipeline` |
| `packages/operaciones/src/grilla.ts` | Recibe `verGrilla`; borra `cargarEstrategiaDelTrimestre` |
| `packages/operaciones/src/perfiles.ts` | `estrategiaDelTrimestre` delega y devuelve la unión |
| `packages/operaciones/src/marcas.ts` | `resolverOrganizacion` recibe permiso de creación |
| `packages/operaciones/src/index.ts` | Sin `flujos` |
| `packages/operaciones/package.json` | Sin `@gc/ai` ni `@gc/pipeline` |
| `apps/cli/package.json` + `src/main.ts` + `src/humo.test.ts` | Consumen `@gc/flujos` |
| `apps/web/package.json` | Suma las cuatro dependencias del arnés |
| `apps/web/vitest.config.ts` | Suma `@vitejs/plugin-react` |
| `apps/web/next.config.ts` | `transpilePackages` sin `@gc/ai` ni `@gc/pipeline`; regla de webpack apuntando a `packages/flujos/src` |
| `apps/web/src/datos.ts` | `React.cache`, y `organizacionPorDefecto` sin permiso de creación |
| `apps/web/src/acciones.ts` | `Resultado<T>`, `reabrirGrillaAccion` |
| `apps/web/src/calendario.ts` + `.test.ts` | `slotsFueraDeLaRejilla` |
| `apps/web/src/componentes/*.tsx` | Ver tareas 4–7 |
| `packages/strategy/src/esquemas.ts` | `.max()` en `angulo` y `brief` |
| `CLAUDE.md` | Bloque de arquitectura actualizado |

---

## Task 1: Separar `@gc/flujos`

Es la tarea de riesgo del plan: mueve 93 pruebas y toca los imports del CLI. Va primera y con la suite completa como red. Nada aquí cambia comportamiento observable.

**Archivos:**
- Crear: `packages/flujos/package.json`, `packages/flujos/tsconfig.json`, `packages/flujos/vitest.config.ts`, `packages/flujos/src/index.ts`
- Mover: `packages/strategy/src/{p1,p1.test,p2,p2.test,tipos}.ts`, `packages/strategy/src/prompts/` → `packages/flujos/src/`
- Mover: `packages/operaciones/src/flujos.ts` → `packages/flujos/src/flujos.ts` (parcial: `verGrilla` se queda)
- Modificar: `packages/strategy/src/index.ts`, `packages/strategy/package.json`, `packages/operaciones/src/{index,grilla}.ts`, `packages/operaciones/package.json`, `apps/cli/{package.json,src/main.ts,src/humo.test.ts}`, `apps/web/{package.json,next.config.ts}`, `CLAUDE.md`
- Renombrar: `packages/operaciones/src/flujos.test.ts` → `packages/operaciones/src/ver-grilla.test.ts`

**Interfaces:**
- Consume: nada (primera tarea)
- Produce: el paquete `@gc/flujos` con el barril exportando `TAREA_ESTRATEGIA`, `EntradaP1`, `SalidaP1`, `crearFlujoEstrategia`, `TAREA_GRILLA`, `EntradaP2`, `SalidaP2`, `crearFlujoGrilla`, `Dependencias`, `generarEstrategia(db, cliente, organizationId, args): Promise<SalidaP1>`, `generarGrilla(db, cliente, organizationId, args): Promise<SalidaP2>`. Y `verGrilla(db, organizationId, args): Promise<FilaDeGrilla[]>` pasa a exportarse desde `@gc/operaciones/grilla.ts`.

- [ ] **Step 1: Registrar el punto de partida**

Run:
```bash
docker compose up -d && pnpm test 2>&1 | grep -E "Tests +[0-9]+ (passed|failed)"
```

Esperado: nueve líneas `Tests N passed`, sumando 252. Si no suman 252, **detente y reporta**: el plan asume ese punto de partida.

- [ ] **Step 2: Crear el esqueleto del paquete**

`packages/flujos/package.json`:

```json
{
  "name": "@gc/flujos",
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
    "@gc/operaciones": "workspace:*",
    "@gc/pipeline": "workspace:*",
    "@gc/shared": "workspace:*",
    "@gc/strategy": "workspace:*",
    "drizzle-orm": "^0.36.0",
    "zod": "^3.23.8"
  }
}
```

`packages/flujos/tsconfig.json`:

```json
{
  "extends": "../../tsconfig.base.json",
  "include": ["src"]
}
```

`packages/flujos/vitest.config.ts`:

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

- [ ] **Step 3: Mover los archivos con `git mv`**

`git mv` y no copiar-y-borrar: preserva el historial de archivos que llevan comentarios explicando decisiones tomadas hace cuatro ramas.

```bash
mkdir -p packages/flujos/src
git mv packages/strategy/src/p1.ts packages/flujos/src/p1.ts
git mv packages/strategy/src/p1.test.ts packages/flujos/src/p1.test.ts
git mv packages/strategy/src/p2.ts packages/flujos/src/p2.ts
git mv packages/strategy/src/p2.test.ts packages/flujos/src/p2.test.ts
git mv packages/strategy/src/tipos.ts packages/flujos/src/tipos.ts
git mv packages/strategy/src/prompts packages/flujos/src/prompts
git mv packages/operaciones/src/flujos.ts packages/flujos/src/flujos.ts
git mv packages/operaciones/src/flujos.test.ts packages/operaciones/src/ver-grilla.test.ts
```

- [ ] **Step 4: `verGrilla` vuelve a `@gc/operaciones`**

`verGrilla` estaba en `flujos.ts` por historia, no por diseño: es una lectura de `plan_slots` que no toca el modelo. Se queda.

Corta de `packages/flujos/src/flujos.ts` el bloque `export interface FilaDeGrilla { ... }` completo (con su comentario) y la función `export async function verGrilla(...)` entera, y pégalos al final de `packages/operaciones/src/grilla.ts`.

`packages/flujos/src/flujos.ts` queda solo con `generarEstrategia` y `generarGrilla`, y sus imports pasan a ser:

```ts
import type { ClienteLlm } from '@gc/ai'
import type { BaseDeDatos } from '@gc/db'
import { resolverMarca } from '@gc/operaciones'
import { ejecutarFlujo } from '@gc/pipeline'
import { crearFlujoEstrategia, type SalidaP1 } from './p1.js'
import { crearFlujoGrilla, type SalidaP2 } from './p2.js'
```

En `packages/operaciones/src/grilla.ts`, el import de `drizzle-orm` de la primera línea debe pasar a incluir lo que `verGrilla` usa:

```ts
import { and, asc, eq, gte, inArray, lt, ne } from 'drizzle-orm'
```

- [ ] **Step 5: Reapuntar los imports internos de los archivos movidos**

En `packages/flujos/src/p1.ts`, reemplaza:

```ts
import { Estrategia, type TipoEstrategia } from './esquemas.js'
import { validarPeriodo } from './periodos.js'
```

por:

```ts
import { Estrategia, validarPeriodo, type TipoEstrategia } from '@gc/strategy'
```

En `packages/flujos/src/p2.ts`, todo import relativo a `./esquemas.js`, `./validacion.js`, `./derivados.js` o `./periodos.js` pasa a `'@gc/strategy'`. Los imports a `./tipos.js` se quedan relativos.

Haz lo mismo en `p1.test.ts` y `p2.test.ts`.

Para encontrarlos todos:

```bash
grep -n "from './\(esquemas\|validacion\|derivados\|periodos\)" packages/flujos/src/*.ts
```

Esperado tras el arreglo: sin resultados.

- [ ] **Step 6: El barril del paquete nuevo**

`packages/flujos/src/index.ts`:

```ts
export * from './flujos.js'
export * from './p1.js'
export * from './p2.js'
export * from './tipos.js'
```

- [ ] **Step 7: Los dos paquetes que quedan atrás sueltan `@gc/ai`**

`packages/strategy/src/index.ts` queda:

```ts
export * from './derivados.js'
export * from './esquemas.js'
export * from './periodos.js'
export * from './validacion.js'
```

En `packages/strategy/package.json`, borra las líneas `"@gc/ai": "workspace:*",` y `"@gc/pipeline": "workspace:*",` del bloque `dependencies`.

`packages/operaciones/src/index.ts` queda:

```ts
export * from './marcas.js'
export * from './perfiles.js'
export * from './grilla.js'
```

En `packages/operaciones/package.json`, borra las mismas dos líneas.

- [ ] **Step 8: Arreglar el import de `ver-grilla.test.ts`**

En `packages/operaciones/src/ver-grilla.test.ts`, la línea 3 pasa de:

```ts
import { verGrilla } from './flujos.js'
import { descartarSlot, grillaDelMes } from './grilla.js'
```

a:

```ts
import { descartarSlot, grillaDelMes, verGrilla } from './grilla.js'
```

- [ ] **Step 9: Reapuntar el CLI**

En `apps/cli/package.json`, agrega a `dependencies` (orden alfabético):

```json
    "@gc/flujos": "workspace:*",
```

En `apps/cli/src/main.ts`, el bloque de import pasa de:

```ts
import {
  cargarPerfilDeArchivo, crearMarca, generarEstrategia, generarGrilla, reabrirGrilla,
  resolverOrganizacion, verGrilla,
} from '@gc/operaciones'
```

a:

```ts
import { generarEstrategia, generarGrilla } from '@gc/flujos'
import {
  cargarPerfilDeArchivo, crearMarca, reabrirGrilla, resolverOrganizacion, verGrilla,
} from '@gc/operaciones'
```

En `apps/cli/src/humo.test.ts`, mueve `generarEstrategia` y `generarGrilla` (si aparecen en el import de `@gc/operaciones` de la línea 11) a un import nuevo desde `@gc/flujos`. Para ver qué importa hoy:

```bash
sed -n '1,15p' apps/cli/src/humo.test.ts
```

- [ ] **Step 10: Reapuntar `next.config.ts`**

En `apps/web/next.config.ts`, `transpilePackages` queda:

```ts
  // Los paquetes del workspace se distribuyen como TypeScript sin compilar.
  // La lista incluye los transitivos y no solo los que la app importa directo:
  // @gc/operaciones arrastra @gc/brand. @gc/ai y @gc/pipeline ya no aparecen
  // porque, desde que los flujos viven en @gc/flujos, la web no los alcanza —
  // y eso es una garantía del resolvedor de pnpm, no una convención.
  transpilePackages: [
    '@gc/brand', '@gc/db', '@gc/operaciones', '@gc/shared', '@gc/strategy',
  ],
```

Y la regla de webpack cambia su `include` de `packages/strategy/src` a `packages/flujos/src`, porque los prompts se movieron con `p1`/`p2`:

```ts
      include: fileURLToPath(new URL('../../packages/flujos/src', import.meta.url)),
```

En el comentario largo que precede a esa regla, reemplaza las dos menciones de `@gc/strategy` por `@gc/flujos`.

- [ ] **Step 11: Instalar y comprobar que todo compila**

Run:
```bash
pnpm install && pnpm -r typecheck
```

Esperado: sin errores. Si `tsc` reporta un import roto en `@gc/flujos`, vuelve al Step 5.

- [ ] **Step 12: La suite completa, con el conteo por paquete**

Run:
```bash
pnpm test 2>&1 | grep -E "RUN  v|Tests +[0-9]+ (passed|failed)"
```

Esperado: **diez** paquetes ahora, no nueve, y la suma sigue siendo 252. `@gc/strategy` baja y `@gc/flujos` aparece con lo que perdió.

Si `@gc/flujos` **no aparece** en la salida, detente: un paquete sin script `test` se salta en silencio y el total bajaría sin que nadie lo note. Revisa que su `package.json` tenga `"test": "vitest run"`.

- [ ] **Step 13: Comprobar la garantía, que es el punto de toda la tarea**

Run:
```bash
pnpm --filter @gc/web why @gc/ai
```

Esperado: que **no** liste ninguna cadena de dependencia. Si `@gc/ai` sigue apareciendo, algún manifiesto no soltó la dependencia — revisa el Step 7.

Como segunda comprobación, que el import falle de verdad:

```bash
cd apps/web && node -e "import('@gc/ai').then(()=>console.log('RESUELVE — MAL'),()=>console.log('NO RESUELVE — BIEN'))" ; cd ../..
```

Esperado: `NO RESUELVE — BIEN`.

- [ ] **Step 14: Limpiar el manifiesto de `apps/web`**

Borra `"@gc/brand": "workspace:*",` de `dependencies` en `apps/web/package.json` y corre:

```bash
pnpm install && pnpm --filter @gc/web typecheck && pnpm --filter @gc/web build
```

Si ambos pasan, el ítem queda cerrado. **Si alguno falla, restaura la línea** y agrega encima el comentario que explique por qué se queda — es un tipo que llega de forma transitiva o un paquete que `transpilePackages` necesita resolver desde la raíz de la app, y eso es información que el próximo lector va a querer.

- [ ] **Step 15: El build de la web, con las rutas dinámicas**

Run:
```bash
pnpm --filter @gc/web build
```

Esperado: build exitoso, y en el listado de rutas `/`, `/[marca]/grilla/[mes]`, `/[marca]/perfil` y `/[marca]/estrategia` salen con `ƒ` (dinámicas), **no** con `○` (estáticas).

- [ ] **Step 16: Actualizar `CLAUDE.md`**

En el bloque de arquitectura, reemplaza la línea de `@gc/strategy` y agrega la del paquete nuevo:

```
@gc/strategy    esquemas, validación, derivados, periodos, lectura de estrategia
@gc/flujos      flujos P1 (estrategia) y P2 (grilla): lo único que llama al modelo
```

Y en las reglas no negociables, después de la regla de la capa web, agrega:

```
**`@gc/ai` es inalcanzable desde `apps/web`, y eso lo garantiza pnpm.** Los flujos
que llaman al modelo viven en `@gc/flujos`, que la web no declara. Si algún día
`@gc/operaciones` o `@gc/strategy` vuelven a depender de `@gc/ai`, la regla "la
web nunca llama al modelo" vuelve a ser una convención. Se comprueba con
`pnpm --filter @gc/web why @gc/ai`.
```

- [ ] **Step 17: Commit**

```bash
git add -A
git commit -m "refactor: @gc/flujos separa lo que llama al modelo

p1, p2, tipos, los prompts y los dos flujos de generación salen a un
paquete propio. @gc/strategy y @gc/operaciones sueltan @gc/ai y
@gc/pipeline, así que apps/web deja de poder resolverlos: la regla \"la
web nunca llama al modelo\" pasa de ser una línea en un package.json a
un error de resolución de pnpm.

verGrilla vuelve a @gc/operaciones. Estaba en flujos.ts por historia y
no por diseño: es una lectura de plan_slots que nunca tocó el modelo.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

## Task 2: El lector de estrategia unificado

**Archivos:**
- Crear: `packages/strategy/src/estrategias.ts`, `packages/strategy/src/estrategias.test.ts`
- Modificar: `packages/strategy/src/index.ts`, `packages/flujos/src/p2.ts`, `packages/operaciones/src/grilla.ts`, `packages/operaciones/src/perfiles.ts`, `apps/web/src/app/[marca]/estrategia/page.tsx`

**Interfaces:**
- Consume: el paquete `@gc/flujos` de la Task 1
- Produce: desde `@gc/strategy`, `leerEstrategiaDelTrimestre(db: BaseDeDatos, brandId: string, mes: string, opciones: { archivadas: PoliticaDeArchivadas }): Promise<LecturaDeEstrategia>` y los tipos `PoliticaDeArchivadas` y `LecturaDeEstrategia`. Desde `@gc/operaciones`, `estrategiaDelTrimestre(db, organizationId, slug, mes): Promise<LecturaDeEstrategia>` — nota el cambio de tipo de retorno respecto de hoy.

- [ ] **Step 1: Escribir la prueba que falla**

Crea `packages/strategy/src/estrategias.test.ts`:

```ts
import { conBaseDeDatosDePrueba } from '@gc/db/pruebas'
import { esquema } from '@gc/db'
import { describe, expect, it } from 'vitest'
import { leerEstrategiaDelTrimestre } from './estrategias.js'

const ESTRATEGIA_VALIDA = {
  objetivos: [{ nombre: 'Reconocimiento', metrica: 'Alcance mensual', meta: '50k' }],
  mensajesClave: ['Parcelas con agua y luz', 'Financiamiento directo sin banco'],
  mixDeCanales: [{ canal: 'instagram', publicacionesPorSemana: 3 }],
  reciclaje: [],
  temasPrioritarios: ['Riego tecnificado'],
}

/** Organización + marca + una estrategia con el estado que se pida. */
async function sembrar(db: Parameters<Parameters<typeof conBaseDeDatosDePrueba>[0]>[0], estado: string, datos: unknown = ESTRATEGIA_VALIDA) {
  const [org] = await db
    .insert(esquema.organizations)
    .values({ name: 'Principal', slug: 'principal' })
    .returning({ id: esquema.organizations.id })
  const [marca] = await db
    .insert(esquema.brands)
    .values({ organizationId: org!.id, slug: 'parcelas', name: 'Parcelas' })
    .returning({ id: esquema.brands.id })
  await db.insert(esquema.strategies).values({
    organizationId: org!.id,
    brandId: marca!.id,
    period: '2026-Q3',
    status: estado as 'borrador',
    data: datos,
  })
  return marca!.id
}

describe('leerEstrategiaDelTrimestre', () => {
  it('con archivadas: "excluir" no devuelve una archivada', async () => {
    await conBaseDeDatosDePrueba(async (db) => {
      const brandId = await sembrar(db, 'archivada')
      const r = await leerEstrategiaDelTrimestre(db, brandId, '2026-09', { archivadas: 'excluir' })
      expect(r.tipo).toBe('ausente')
      expect(r.periodo).toBe('2026-Q3')
    })
  })

  it('con archivadas: "incluir" sí devuelve una archivada, con su estado', async () => {
    await conBaseDeDatosDePrueba(async (db) => {
      const brandId = await sembrar(db, 'archivada')
      const r = await leerEstrategiaDelTrimestre(db, brandId, '2026-09', { archivadas: 'incluir' })
      expect(r.tipo).toBe('ok')
      if (r.tipo !== 'ok') throw new Error('inalcanzable')
      expect(r.estado).toBe('archivada')
      expect(r.estrategia.mixDeCanales[0]!.canal).toBe('instagram')
    })
  })

  it('una estrategia corrupta sale como "invalida" por las dos políticas', async () => {
    await conBaseDeDatosDePrueba(async (db) => {
      const brandId = await sembrar(db, 'aprobada', { objetivos: 'esto no es un arreglo' })
      for (const archivadas of ['excluir', 'incluir'] as const) {
        const r = await leerEstrategiaDelTrimestre(db, brandId, '2026-09', { archivadas })
        expect(r.tipo).toBe('invalida')
        if (r.tipo !== 'invalida') throw new Error('inalcanzable')
        expect(r.estado).toBe('aprobada')
      }
    })
  })

  it('sin estrategia para el trimestre devuelve "ausente" nombrando el periodo', async () => {
    await conBaseDeDatosDePrueba(async (db) => {
      const brandId = await sembrar(db, 'aprobada')
      const r = await leerEstrategiaDelTrimestre(db, brandId, '2026-12', { archivadas: 'incluir' })
      expect(r).toEqual({ tipo: 'ausente', periodo: '2026-Q4' })
    })
  })
})
```

- [ ] **Step 2: Correr la prueba y verificar que falla**

Run: `pnpm --filter @gc/strategy test estrategias`
Esperado: FAIL con "Failed to resolve import ./estrategias.js".

- [ ] **Step 3: Escribir el lector**

Crea `packages/strategy/src/estrategias.ts`:

```ts
import { esquema, ESTADOS_STRATEGY, type BaseDeDatos } from '@gc/db'
import { and, eq, ne } from 'drizzle-orm'
import { Estrategia, type TipoEstrategia } from './esquemas.js'
import { trimestreDe } from './periodos.js'

type Estado = (typeof ESTADOS_STRATEGY)[number]

/**
 * Qué hacer con las estrategias archivadas. No tiene valor por defecto a
 * propósito: es la diferencia que separa a los consumidores de esta función y
 * dejarla implícita fue justamente el defecto que la unificación cierra.
 *
 * `excluir` es para quien calcula —P2 al generar la grilla, `validarGrilla` al
 * releerla— porque ahí hay que medir contra la estrategia que rige hoy.
 * `incluir` es para quien muestra, donde ocultar la fila es menos útil que
 * mostrarla con su estado.
 */
export type PoliticaDeArchivadas = 'excluir' | 'incluir'

/**
 * Se devuelve un resultado en vez de lanzar porque quien llama necesita
 * distinguir "no hay" de "hay pero no valida", y con dos errores
 * indistinguibles no podía: la grilla convierte el segundo caso en un
 * problema bloqueante con su remedio, y P2 los convierte a ambos en
 * `permanente` con mensajes distintos.
 *
 * `estado` viaja también en `invalida` porque la vista de solo lectura lo
 * muestra tal cual, y esa es su razón para incluir archivadas.
 */
export type LecturaDeEstrategia =
  | { tipo: 'ok'; periodo: string; id: string; estado: Estado; estrategia: TipoEstrategia }
  | { tipo: 'ausente'; periodo: string }
  | { tipo: 'invalida'; periodo: string; id: string; estado: Estado }

/**
 * La estrategia del trimestre al que pertenece `mes`.
 *
 * Reemplaza a tres funciones que leían lo mismo con cuatro diferencias entre
 * ellas —archivadas, forma del error, identificación de la marca y si
 * validaban— que ningún nombre delataba. La tercera, la de `perfiles.ts`, ni
 * siquiera validaba: devolvía la columna cruda y dejaba que la página la
 * parseara, así que una estrategia corrupta se comportaba distinto según por
 * dónde se entrara.
 */
export async function leerEstrategiaDelTrimestre(
  db: BaseDeDatos,
  brandId: string,
  mes: string,
  opciones: { archivadas: PoliticaDeArchivadas },
): Promise<LecturaDeEstrategia> {
  const periodo = trimestreDe(mes)

  // `(brand_id, period)` es único, así que hay a lo más una fila: no hace
  // falta ordenar, y "la más reciente" deja de ser un criterio.
  const filtro =
    opciones.archivadas === 'excluir'
      ? and(
          eq(esquema.strategies.brandId, brandId),
          eq(esquema.strategies.period, periodo),
          ne(esquema.strategies.status, 'archivada'),
        )
      : and(eq(esquema.strategies.brandId, brandId), eq(esquema.strategies.period, periodo))

  const [fila] = await db.select().from(esquema.strategies).where(filtro)

  if (!fila) return { tipo: 'ausente', periodo }

  const r = Estrategia.safeParse(fila.data)
  if (!r.success) return { tipo: 'invalida', periodo, id: fila.id, estado: fila.status }

  return { tipo: 'ok', periodo, id: fila.id, estado: fila.status, estrategia: r.data }
}
```

Agrega a `packages/strategy/src/index.ts`, en orden alfabético:

```ts
export * from './estrategias.js'
```

- [ ] **Step 4: Correr la prueba y verificar que pasa**

Run: `pnpm --filter @gc/strategy test estrategias`
Esperado: PASS, 4 pruebas.

- [ ] **Step 5: Confirmar que la prueba puede fallar**

Cambia temporalmente en `estrategias.ts` la política a que siempre incluya archivadas: borra la rama `'excluir'` del ternario y deja solo el `and` de dos condiciones.

Run: `pnpm --filter @gc/strategy test estrategias`
Esperado: FAIL en "no devuelve una archivada".

**Restaura el ternario** y vuelve a correr: PASS.

- [ ] **Step 6: P2 pasa a envolver**

En `packages/flujos/src/p2.ts`, reemplaza la función privada `cargarEstrategiaVigente` entera (desde `async function cargarEstrategiaVigente(` hasta su llave de cierre) por:

```ts
/**
 * Envoltorio sobre `leerEstrategiaDelTrimestre` que traduce sus dos casos de
 * fallo a los `permanente` que este flujo lanzaba antes, con los mismos
 * textos: quien genera una grilla no puede continuar sin estrategia, así que
 * distinguir "no hay" de "hay pero no valida" solo cambia el mensaje.
 */
async function cargarEstrategiaVigente(
  db: BaseDeDatos,
  brandId: string,
  mes: string,
  nombreVisible?: string,
): Promise<{ id: string; estrategia: TipoEstrategia }> {
  const lectura = await leerEstrategiaDelTrimestre(db, brandId, mes, { archivadas: 'excluir' })

  if (lectura.tipo === 'ausente') {
    throw permanente(
      `La marca ${nombreVisible ?? brandId} no tiene estrategia vigente para ${lectura.periodo}. ` +
        `Genérala antes de la grilla de ${mes}.`,
    )
  }

  if (lectura.tipo === 'invalida') {
    throw permanente(`La estrategia guardada de ${nombreVisible ?? brandId} no valida`)
  }

  return { id: lectura.id, estrategia: lectura.estrategia }
}
```

Agrega `leerEstrategiaDelTrimestre` al import de `@gc/strategy` que ya existe en ese archivo, y borra de sus imports lo que quede sin uso (`ne` de `drizzle-orm`, probablemente).

- [ ] **Step 7: `grilla.ts` borra su copia**

En `packages/operaciones/src/grilla.ts`:

1. Borra el bloque `type LecturaDeEstrategia = ...` y la función `async function cargarEstrategiaDelTrimestre(...)` entera, **incluido su comentario `⚠️` de doce líneas** — existía solo para advertir de la confusión que esta tarea elimina.
2. Agrega `leerEstrategiaDelTrimestre` al import de `@gc/strategy`, y borra de él `Estrategia` y `type TipoEstrategia` si quedaron sin uso.
3. Dentro de `recalcularProblemas`, cambia la llamada:

```ts
  const lectura = await leerEstrategiaDelTrimestre(db, brandId, mes, { archivadas: 'excluir' })
```

4. Borra `ne` del import de `drizzle-orm` si quedó sin uso.

- [ ] **Step 8: `perfiles.ts` delega**

En `packages/operaciones/src/perfiles.ts`, borra la interfaz `EstrategiaDelTrimestre` y reemplaza `estrategiaDelTrimestre` entera por:

```ts
/**
 * La estrategia del trimestre al que pertenece `mes`, por slug de marca.
 *
 * `archivadas: 'incluir'` porque alimenta una vista de solo lectura: mostrar
 * la fila con su estado —"Archivada" incluido— es más útil que esconderla.
 * La política va explícita aquí, que es el punto de haberla vuelto un
 * parámetro; antes era una diferencia silenciosa con la gemela de `grilla.ts`.
 *
 * Devuelve la unión y no `| null`: la página necesita distinguir "no hay" de
 * "hay pero está corrupta", y antes esto entregaba la columna cruda sin
 * validar y la dejaba parseando por su cuenta.
 */
export async function estrategiaDelTrimestre(
  db: BaseDeDatos,
  organizationId: string,
  slug: string,
  mes: string,
): Promise<LecturaDeEstrategia> {
  const ref = await resolverMarca(db, organizationId, slug)
  return leerEstrategiaDelTrimestre(db, ref.brandId, mes, { archivadas: 'incluir' })
}
```

El import de `@gc/strategy` de ese archivo pasa a:

```ts
import { leerEstrategiaDelTrimestre, type LecturaDeEstrategia } from '@gc/strategy'
```

`trimestreDe` deja de usarse ahí; bórralo del import. Y borra `and` del import de `drizzle-orm` si quedó sin uso.

- [ ] **Step 9: La página de estrategia consume la unión**

En `apps/web/src/app/[marca]/estrategia/page.tsx`:

1. El import de la línea 2 pasa a `import { trimestreDe } from '@gc/strategy'` — `Estrategia` ya no se usa aquí, porque el lector valida.
2. Reemplaza el bloque `{!resultado ? (...) : (...)}` por:

```tsx
      {resultado.tipo === 'ausente' ? (
        <div className="mt-4 rounded border border-dashed border-gray-300 p-8 text-center text-gray-600">
          <p>La marca no tiene estrategia cargada para el trimestre {periodo}.</p>
          <p className="mt-2">
            Genérala con{' '}
            <code className="rounded bg-gray-100 px-1.5 py-0.5 text-sm text-gray-800">
              pnpm cli estrategia:generar --marca {marca} --periodo {periodo}
            </code>
          </p>
        </div>
      ) : resultado.tipo === 'invalida' ? (
        <>
          <p className="mb-6 text-sm text-gray-600">
            Periodo: {resultado.periodo} · Estado:{' '}
            {ETIQUETAS_DE_ESTADO[resultado.estado] ?? resultado.estado}
          </p>
          <div className="rounded border border-red-300 bg-red-50 p-3 text-sm text-red-800">
            <p className="mb-2">
              La estrategia guardada para este periodo no valida contra su esquema, así que no se
              puede mostrar.
            </p>
            <p>
              Regenérala con{' '}
              <code className="rounded bg-red-100 px-1.5 py-0.5 text-xs">
                pnpm cli estrategia:generar --marca {marca} --periodo {resultado.periodo}
              </code>
            </p>
          </div>
        </>
      ) : (
        <ContenidoDeEstrategia
          periodo={resultado.periodo}
          estado={resultado.estado}
          estrategia={resultado.estrategia}
        />
      )}
```

3. `ContenidoDeEstrategia` deja de parsear, porque recibe la estrategia ya validada. Reemplaza la función entera por:

```tsx
function ContenidoDeEstrategia({
  periodo,
  estado,
  estrategia,
}: {
  periodo: string
  estado: string
  estrategia: TipoEstrategia
}) {
  return (
    <>
      <p className="mb-6 text-sm text-gray-600">
        Periodo: {periodo} · Estado: {ETIQUETAS_DE_ESTADO[estado] ?? estado}
      </p>

      <div className="space-y-8">
        <section>
          <h2 className="mb-2 text-sm font-semibold text-gray-700">Objetivos</h2>
          <ul className="space-y-1 text-sm text-gray-800">
            {estrategia.objetivos.map((o, i) => (
              <li key={i}>
                {o.nombre} — {o.metrica}: {o.meta}
              </li>
            ))}
          </ul>
        </section>

        <section>
          <h2 className="mb-2 text-sm font-semibold text-gray-700">Mensajes clave</h2>
          <ul className="list-disc space-y-1 pl-5 text-sm text-gray-800">
            {estrategia.mensajesClave.map((m, i) => (
              <li key={i}>{m}</li>
            ))}
          </ul>
        </section>

        <section>
          <h2 className="mb-2 text-sm font-semibold text-gray-700">Mix de canales</h2>
          <ul className="space-y-1 text-sm text-gray-800">
            {estrategia.mixDeCanales.map((c, i) => (
              <li key={i}>
                {c.canal}: {c.publicacionesPorSemana} / semana
              </li>
            ))}
          </ul>
        </section>

        <section>
          <h2 className="mb-2 text-sm font-semibold text-gray-700">Reglas de reciclaje</h2>
          {estrategia.reciclaje.length === 0 ? (
            <p className="text-sm text-gray-500">Sin reglas de reciclaje.</p>
          ) : (
            <ul className="space-y-1 text-sm text-gray-800">
              {estrategia.reciclaje.map((r, i) => (
                <li key={i}>
                  {r.desde} → {r.hacia.join(', ')} ({r.diasDespues} días después)
                </li>
              ))}
            </ul>
          )}
        </section>

        <section>
          <h2 className="mb-2 text-sm font-semibold text-gray-700">Temas prioritarios</h2>
          <ul className="list-disc space-y-1 pl-5 text-sm text-gray-800">
            {estrategia.temasPrioritarios.map((t, i) => (
              <li key={i}>{t}</li>
            ))}
          </ul>
        </section>
      </div>
    </>
  )
}
```

Agrega `type TipoEstrategia` al import de `@gc/strategy` de la línea 2.

- [ ] **Step 10: La prueba del tercer camino**

El spec exige que una estrategia corrupta salga como `invalida` **por los tres caminos**. P2 y `grillaDelMes` ya tienen su cobertura; el de `perfiles.ts` es nuevo, porque antes esa función ni siquiera validaba.

Agrega a `packages/operaciones/src/perfiles.test.ts`:

```ts
  it('estrategiaDelTrimestre marca como inválida una estrategia corrupta, en vez de devolverla cruda', async () => {
    await conBaseDeDatosDePrueba(async (db) => {
      const ref = await sembrarConGrilla(db)
      await db
        .update(esquema.strategies)
        .set({ data: { objetivos: 'esto no es un arreglo' } })
        .where(eq(esquema.strategies.brandId, ref.brandId))

      const r = await estrategiaDelTrimestre(db, ref.organizationId, 'parcelas', '2026-09')

      expect(r.tipo).toBe('invalida')
      if (r.tipo !== 'invalida') throw new Error('inalcanzable')
      expect(r.periodo).toBe('2026-Q3')
    })
  })

  it('estrategiaDelTrimestre sí devuelve una archivada, con su estado', async () => {
    await conBaseDeDatosDePrueba(async (db) => {
      const ref = await sembrarConGrilla(db)
      await db
        .update(esquema.strategies)
        .set({ status: 'archivada' })
        .where(eq(esquema.strategies.brandId, ref.brandId))

      const r = await estrategiaDelTrimestre(db, ref.organizationId, 'parcelas', '2026-09')

      expect(r.tipo).toBe('ok')
      if (r.tipo !== 'ok') throw new Error('inalcanzable')
      expect(r.estado).toBe('archivada')
    })
  })
```

Ajusta los imports del archivo para que traiga `esquema` de `@gc/db`, `eq` de `drizzle-orm`, `estrategiaDelTrimestre` de `./perfiles.js` y `sembrarConGrilla` de `./pruebas/siembra.js`.

Run: `pnpm --filter @gc/operaciones test perfiles`
Esperado: PASS.

Para confirmar que la primera puede fallar, cambia temporalmente en `estrategias.ts` el `if (!r.success) return { tipo: 'invalida', ... }` por `if (false)`. Esperado: FAIL — y además el `safeParse` sin usar hará ruidoso el error. **Restaura.**

- [ ] **Step 11: Suite completa y typecheck**

Run:
```bash
pnpm -r typecheck && pnpm test 2>&1 | grep -E "RUN  v|Tests +[0-9]+ (passed|failed)"
```

Esperado: typecheck limpio; 258 pruebas (252 + 4 del lector + 2 de `perfiles`), sin fallos.

- [ ] **Step 12: Build de la web**

Run: `pnpm --filter @gc/web build`
Esperado: build exitoso, las cuatro rutas con `ƒ`.

- [ ] **Step 13: Commit**

```bash
git add -A
git commit -m "refactor: un solo lector de estrategia por trimestre

Tres funciones leían lo mismo con cuatro diferencias entre ellas
—archivadas, forma del error, identificación de la marca y si
validaban— que ningún nombre delataba. grilla.ts llevaba un comentario
de doce líneas cuyo único propósito era advertir de la confusión.

Queda una, con la política de archivadas como parámetro explícito en
cada sitio de llamada. Eso cierra un defecto que no estaba registrado:
la copia de perfiles.ts devolvía la columna cruda sin validar, así que
una estrategia corrupta se comportaba distinto según por dónde se
entrara. Ahora sale como \"invalida\" por los tres caminos.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

## Task 3: La web deja de poder crear la organización

**Archivos:**
- Modificar: `packages/operaciones/src/marcas.ts`, `packages/operaciones/src/marcas.test.ts`, `apps/web/src/datos.ts`, `apps/web/src/datos.test.ts`

**Interfaces:**
- Consume: nada de las tareas previas
- Produce: `OpcionesDeOrganizacion` gana `crearSiFalta?: boolean` (por defecto `true`). `organizacionPorDefecto(db)` en la web pasa por `React.cache` y llama con `crearSiFalta: false`.

- [ ] **Step 1: Escribir la prueba que falla**

Agrega a `packages/operaciones/src/marcas.test.ts`, dentro del `describe` de `resolverOrganizacion` (si no existe uno, créalo al final del archivo):

```ts
  it('con crearSiFalta: false y ninguna organización, falla en vez de insertar', async () => {
    await conBaseDeDatosDePrueba(async (db) => {
      await expect(
        resolverOrganizacion(db, { crearSiFalta: false, env: {} }),
      ).rejects.toThrow(/no hay ninguna organización/i)

      const filas = await db.select().from(esquema.organizations)
      expect(filas).toHaveLength(0)
    })
  })

  it('sin la opción sigue creando la organización por defecto', async () => {
    await conBaseDeDatosDePrueba(async (db) => {
      const id = await resolverOrganizacion(db, { env: {} })

      const filas = await db.select().from(esquema.organizations)
      expect(filas).toHaveLength(1)
      expect(filas[0]!.slug).toBe('principal')
      expect(filas[0]!.id).toBe(id)
    })
  })
```

Asegúrate de que el archivo importe `esquema` de `@gc/db`; si no, agrégalo.

- [ ] **Step 2: Correr y verificar que falla**

Run: `pnpm --filter @gc/operaciones test marcas`
Esperado: FAIL — la primera prueba porque `crearSiFalta` no existe en el tipo (error de TypeScript en tiempo de ejecución de vitest) y porque igual inserta.

- [ ] **Step 3: Implementar**

En `packages/operaciones/src/marcas.ts`, la interfaz pasa a:

```ts
export interface OpcionesDeOrganizacion {
  org?: string
  env?: Record<string, string | undefined>
  /**
   * Si no existe ninguna organización, ¿se crea la por defecto?
   *
   * Por defecto `true`, que es lo que el CLI necesita para que un clon nuevo
   * arranque con un solo comando. La web pasa `false`: resuelve la
   * organización en cada petición, incluidas las de lectura, y con esto
   * activado un `GET /` escribía en la base — además por la rama que no es
   * segura ante concurrencia.
   */
  crearSiFalta?: boolean
}
```

Y dentro de `resolverOrganizacion`, el bloque de cero organizaciones pasa a:

```ts
  if (todas.length === 0) {
    if (opciones.crearSiFalta === false) {
      throw permanente(
        'No hay ninguna organización en la base. Créala desde la línea de comandos con ' +
          '"pnpm cli marca:crear --slug <slug> --nombre <nombre>", que crea la organización ' +
          'por defecto junto con la primera marca.',
      )
    }

    const [nueva] = await db
      .insert(esquema.organizations)
      .values({ name: ORGANIZACION_POR_DEFECTO, slug: SLUG_POR_DEFECTO })
      .returning({ id: esquema.organizations.id })
    return nueva!.id
  }
```

Se compara contra `false` explícito y no con `!opciones.crearSiFalta`: con `exactOptionalPropertyTypes` activado, omitir la propiedad y pasarla como `undefined` son cosas distintas, y ambas deben significar "sí, crea".

- [ ] **Step 4: Correr y verificar que pasa**

Run: `pnpm --filter @gc/operaciones test marcas`
Esperado: PASS.

- [ ] **Step 5: Confirmar que la prueba puede fallar**

Cambia temporalmente `opciones.crearSiFalta === false` por `false`.

Run: `pnpm --filter @gc/operaciones test marcas`
Esperado: FAIL en "falla en vez de insertar".

**Restaura** y vuelve a correr: PASS.

- [ ] **Step 6: La web usa la puerta cerrada, y una sola vez por petición**

En `apps/web/src/datos.ts`, reemplaza `organizacionPorDefecto` por:

```ts
/**
 * `cache` de React deduplica la llamada dentro de una misma petición:
 * `layout.tsx` y `page.tsx` la piden por separado y antes eran dos consultas
 * idénticas. No es estado global —el ámbito es la petición— así que no
 * comparte nada entre usuarios ni entre peticiones.
 *
 * `crearSiFalta: false` porque esto corre en el camino de lectura: sin él, un
 * `GET /` sobre una base vacía insertaba una fila. Crear la organización es
 * del CLI.
 */
export const organizacionPorDefecto = cache(async (db: BaseDeDatos): Promise<string> => {
  return resolverOrganizacion(db, { crearSiFalta: false })
})
```

Y agrega el import al principio del archivo:

```ts
import { cache } from 'react'
```

- [ ] **Step 7: Prueba de la capa web**

Agrega a `apps/web/src/datos.test.ts`:

```ts
  it('organizacionPorDefecto no crea la organización cuando no existe', async () => {
    await conBaseDeDatosDePrueba(async (db) => {
      await expect(organizacionPorDefecto(db)).rejects.toThrow(/No hay ninguna organización/)

      const filas = await db.select().from(esquema.organizations)
      expect(filas).toHaveLength(0)
    })
  })
```

Ajusta los imports del archivo para que traiga `organizacionPorDefecto` de `./datos.js` y `esquema` de `@gc/db`.

- [ ] **Step 8: Correr la suite completa**

Run:
```bash
pnpm -r typecheck && pnpm test 2>&1 | grep -E "Tests +[0-9]+ (passed|failed)"
```

Esperado: typecheck limpio, 261 pruebas, sin fallos.

- [ ] **Step 9: Commit**

```bash
git add -A
git commit -m "fix: un GET a la web ya no puede crear la organización

resolverOrganizacion recibe si tiene permiso de crear. El CLI sí, la
web no: resolvía la organización en cada petición, así que un GET a /
sobre una base vacía insertaba una fila, y encima por la rama que no es
segura ante concurrencia.

De paso, React.cache deduplica la resolución dentro de la petición:
layout.tsx y page.tsx la pedían por separado.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

## Task 4: El arnés de componentes y cuatro de las cinco garantías

**Archivos:**
- Modificar: `apps/web/package.json`, `apps/web/vitest.config.ts`
- Crear: `apps/web/src/componentes/FichaDeSlot.test.tsx`, `apps/web/src/componentes/RejillaDelMes.test.tsx`, `apps/web/src/componentes/PanelDeDetalle.test.tsx`

**Interfaces:**
- Consume: los componentes tal como están hoy
- Produce: el arnés, y `Resultado<T = null> = { ok: true; datos: T } | { ok: false; mensaje: string; reintentable: boolean }` con `ejecutar<T>` en `acciones.ts`. Las tareas 5, 6 y 7 escriben pruebas de componente asumiendo ambas cosas.

La quinta garantía —"el número de versión del perfil es el recién guardado"— **no** entra aquí: hoy es falsa, y volverla verdadera es la Task 5. Afirmarla ahora sería escribir una prueba roja y dejarla.

- [ ] **Step 1: Instalar las dependencias del arnés**

Run:
```bash
pnpm --filter @gc/web add -D jsdom @testing-library/react @testing-library/dom @testing-library/user-event @vitejs/plugin-react
```

- [ ] **Step 2: Enseñarle JSX a vitest**

`apps/web/vitest.config.ts` queda:

```ts
import react from '@vitejs/plugin-react'
import { defineConfig } from 'vitest/config'

export default defineConfig({
  // Sin el plugin, vitest no transforma el JSX de los `.tsx` y las pruebas de
  // componente fallan al parsear.
  plugins: [react()],
  test: {
    // `node` sigue siendo el entorno por defecto: `datos.test.ts` y
    // `calendario.test.ts` golpean Postgres. Las pruebas de componente piden
    // jsdom archivo por archivo con `// @vitest-environment jsdom` en su
    // primera línea, en vez de partir esta configuración en dos proyectos.
    environment: 'node',
    // `.tsx` incluido: sin él, la primera prueba de un componente se saltaría
    // en silencio y el paquete seguiría dando "todo verde".
    include: ['src/**/*.test.{ts,tsx}'],
    setupFiles: ['../../vitest.setup.ts'],
    fileParallelism: false,
  },
})
```

- [ ] **Step 3: `Resultado` pasa a llevar datos**

Va aquí y no en la Task 5 porque los mocks de las pruebas de componente devuelven `Resultado`, y si el tipo cambia después habría que reescribir los tres archivos de prueba que esta tarea crea. Es un refactor de tipos sin cambio de comportamiento: lo cubren `typecheck` y las pruebas que ya existen.

En `apps/web/src/acciones.ts`, el tipo y el ayudante pasan a:

```ts
/**
 * `null` por defecto y no `void`: con `void` la propiedad `datos` seguiría
 * siendo obligatoria y las cuatro acciones que no devuelven nada tendrían que
 * declararla igual. Con `null`, `ejecutar` devuelve lo que devuelva su
 * callback y ninguna de ellas se toca.
 */
export type Resultado<T = null> =
  | { ok: true; datos: T }
  | { ok: false; mensaje: string; reintentable: boolean }

async function ejecutar<T = null>(
  ruta: string,
  fn: (db: Awaited<ReturnType<typeof conexion>>, organizationId: string) => Promise<T>,
): Promise<Resultado<T>> {
  const db = conexion()
  try {
    const datos = await fn(db, await organizacionPorDefecto(db))
    revalidatePath(ruta)
    return { ok: true, datos }
  } catch (error) {
    return {
      ok: false,
      mensaje: error instanceof Error ? error.message : String(error),
      reintentable: clasificarError(error) === 'transitorio',
    }
  }
}
```

Los callbacks de las cuatro acciones existentes deben devolver `null` explícito, para que `T` se infiera como `null` y no como `void`. Por ejemplo:

```ts
export async function descartarSlotAccion(
  marca: string,
  mes: string,
  slotId: string,
): Promise<Resultado> {
  return ejecutar(`/${marca}/grilla/${mes}`, async (db, organizationId) => {
    await descartarSlot(db, organizationId, slotId)
    return null
  })
}
```

Aplica el mismo patrón a `editarSlotAccion`, `aprobarGrillaAccion` y `guardarPerfilAction`.

Run: `pnpm --filter @gc/web typecheck`
Esperado: sin errores.

- [ ] **Step 4: La primera garantía — las fichas descartadas se leen como descartadas**

Crea `apps/web/src/componentes/FichaDeSlot.test.tsx`:

```tsx
// @vitest-environment jsdom
import type { SlotDeLaGrilla } from '@gc/operaciones'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup } from '@testing-library/react'
import { FichaDeSlot } from './FichaDeSlot.js'

afterEach(cleanup)

function slot(campos: Partial<SlotDeLaGrilla> = {}): SlotDeLaGrilla {
  return {
    id: 'slot-1',
    fecha: '2026-09-03',
    hora: '10:00',
    canal: 'instagram',
    formato: 'carrusel',
    pilar: 'educativo',
    angulo: 'Cómo elegir una parcela',
    brief: 'Un brief cualquiera con largo suficiente.',
    descartado: false,
    esDerivado: false,
    idDelPadre: null,
    ...campos,
  }
}

describe('FichaDeSlot', () => {
  it('un slot descartado se distingue visualmente de uno vigente', () => {
    const { container: vigente } = render(<FichaDeSlot slot={slot()} onSeleccionar={vi.fn()} />)
    const claseVigente = vigente.querySelector('button')!.className
    cleanup()

    const { container: descartado } = render(
      <FichaDeSlot slot={slot({ descartado: true })} onSeleccionar={vi.fn()} />,
    )
    const claseDescartada = descartado.querySelector('button')!.className

    expect(claseDescartada).not.toBe(claseVigente)
    expect(claseDescartada).toContain('line-through')
  })

  it('un derivado se marca con la flecha y el vigente no', () => {
    render(<FichaDeSlot slot={slot({ esDerivado: true })} onSeleccionar={vi.fn()} />)
    expect(screen.getByRole('button').textContent).toContain('↳')
  })

  it('al pulsarla avisa con su id y con el propio botón', async () => {
    const alSeleccionar = vi.fn()
    render(<FichaDeSlot slot={slot()} onSeleccionar={alSeleccionar} />)

    await userEvent.click(screen.getByRole('button'))

    expect(alSeleccionar).toHaveBeenCalledOnce()
    expect(alSeleccionar.mock.calls[0]![0]).toBe('slot-1')
    expect(alSeleccionar.mock.calls[0]![1]).toBe(screen.getByRole('button'))
  })
})
```

- [ ] **Step 5: Correr y verificar que pasa**

Run: `pnpm --filter @gc/web test FichaDeSlot`
Esperado: PASS, 3 pruebas.

Si falla al parsear el JSX, el plugin de React no quedó bien configurado: vuelve al Step 2.

- [ ] **Step 6: Confirmar que la primera puede fallar**

En `FichaDeSlot.tsx`, borra temporalmente ` line-through` de la clase del caso descartado.

Run: `pnpm --filter @gc/web test FichaDeSlot`
Esperado: FAIL en "se distingue visualmente".

**Restaura** y vuelve a correr: PASS.

- [ ] **Step 7: La segunda garantía — cada slot cae en una celda**

Crea `apps/web/src/componentes/RejillaDelMes.test.tsx`:

```tsx
// @vitest-environment jsdom
import type { SlotDeLaGrilla } from '@gc/operaciones'
import { cleanup, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { semanasDelMes } from '../calendario.js'
import { RejillaDelMes } from './RejillaDelMes.js'

// Los componentes de cliente importan las Server Actions. Sustituirlas evita
// arrastrar la base y el 'use server' a una prueba que mide renderizado.
// Solo las dos que el árbol bajo prueba importa: RejillaDelMes monta
// PanelDeDetalle, y ese es todo el consumo de acciones que hay aquí. Declarar
// de más obliga a mantener firmas que esta prueba no ejercita.
vi.mock('../acciones.js', () => ({
  descartarSlotAccion: vi.fn(async () => ({ ok: true, datos: null })),
  editarSlotAccion: vi.fn(async () => ({ ok: true, datos: null })),
}))

afterEach(cleanup)

function slot(id: string, fecha: string, campos: Partial<SlotDeLaGrilla> = {}): SlotDeLaGrilla {
  return {
    id,
    fecha,
    hora: '10:00',
    canal: 'instagram',
    formato: 'carrusel',
    pilar: 'educativo',
    angulo: `Ángulo de ${id}`,
    brief: 'Un brief cualquiera con largo suficiente.',
    descartado: false,
    esDerivado: false,
    idDelPadre: null,
    ...campos,
  }
}

describe('RejillaDelMes', () => {
  it('cada slot del mes aparece en la rejilla, incluidos los descartados', () => {
    const slots = [
      slot('a', '2026-09-01'),
      slot('b', '2026-09-15'),
      slot('c', '2026-09-30', { descartado: true }),
    ]

    render(
      <RejillaDelMes
        marca="parcelas"
        mes="2026-09"
        estado="borrador"
        semanas={semanasDelMes('2026-09')}
        slots={slots}
      />,
    )

    for (const s of slots) {
      expect(screen.queryByText(s.angulo)).not.toBeNull()
    }
  })

  it('un slot en un día de relleno del mes vecino también aparece', () => {
    // 2026-09-01 es martes, así que la primera semana arrastra el lunes 31 de
    // agosto: un slot ahí cae en una celda renderizada y debe verse.
    const semanas = semanasDelMes('2026-09')
    expect(semanas[0]![0]).toBe('2026-08-31')

    render(
      <RejillaDelMes
        marca="parcelas"
        mes="2026-09"
        estado="borrador"
        semanas={semanas}
        slots={[slot('vecino', '2026-08-31')]}
      />,
    )

    expect(screen.queryByText('Ángulo de vecino')).not.toBeNull()
  })
})
```

- [ ] **Step 8: Correr, y comprobar el supuesto de la segunda prueba**

Run: `pnpm --filter @gc/web test RejillaDelMes`
Esperado: PASS, 2 pruebas.

Si falla en `expect(semanas[0]![0]).toBe('2026-08-31')`, el supuesto sobre el calendario de septiembre de 2026 es falso: corrige la fecha esperada al valor real que reporte vitest y ajusta la fecha del slot para que calce con el primer día de relleno.

- [ ] **Step 9: La tercera y la cuarta garantías — el foco y el reintento**

Crea `apps/web/src/componentes/PanelDeDetalle.test.tsx`:

```tsx
// @vitest-environment jsdom
import type { SlotDeLaGrilla } from '@gc/operaciones'
import { cleanup, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { descartarSlotAccion } from '../acciones.js'
import { semanasDelMes } from '../calendario.js'
import { RejillaDelMes } from './RejillaDelMes.js'

// Solo las dos que el árbol bajo prueba importa: RejillaDelMes monta
// PanelDeDetalle, y ese es todo el consumo de acciones que hay aquí. Declarar
// de más obliga a mantener firmas que esta prueba no ejercita.
vi.mock('../acciones.js', () => ({
  descartarSlotAccion: vi.fn(async () => ({ ok: true, datos: null })),
  editarSlotAccion: vi.fn(async () => ({ ok: true, datos: null })),
}))

afterEach(cleanup)
beforeEach(() => vi.mocked(descartarSlotAccion).mockClear())

const SLOT: SlotDeLaGrilla = {
  id: 'slot-1',
  fecha: '2026-09-03',
  hora: '10:00',
  canal: 'instagram',
  formato: 'carrusel',
  pilar: 'educativo',
  angulo: 'Cómo elegir una parcela',
  brief: 'Un brief cualquiera con largo suficiente.',
  descartado: false,
  esDerivado: false,
  idDelPadre: null,
}

function montar(slots: SlotDeLaGrilla[] = [SLOT]) {
  return render(
    <RejillaDelMes
      marca="parcelas"
      mes="2026-09"
      estado="borrador"
      semanas={semanasDelMes('2026-09')}
      slots={slots}
    />,
  )
}

describe('PanelDeDetalle a través de la rejilla', () => {
  it('el foco entra al diálogo al abrirlo y vuelve a la ficha al cerrarlo', async () => {
    montar()
    const ficha = screen.getByText(SLOT.angulo).closest('button')!

    await userEvent.click(ficha)
    const dialogo = screen.getByRole('dialog')
    expect(document.activeElement).toBe(dialogo)

    await userEvent.click(screen.getByLabelText('Cerrar'))
    expect(screen.queryByRole('dialog')).toBeNull()
    expect(document.activeElement).toBe(ficha)
  })

  it('Escape cierra el diálogo y devuelve el foco', async () => {
    montar()
    const ficha = screen.getByText(SLOT.angulo).closest('button')!

    await userEvent.click(ficha)
    await userEvent.keyboard('{Escape}')

    expect(screen.queryByRole('dialog')).toBeNull()
    expect(document.activeElement).toBe(ficha)
  })

  it('"Reintentar" repite el descarte que falló, sin degradarlo', async () => {
    // Primer intento transitorio, segundo exitoso.
    vi.mocked(descartarSlotAccion)
      .mockResolvedValueOnce({ ok: false, mensaje: 'La base no respondió', reintentable: true })
      .mockResolvedValueOnce({ ok: true, datos: null })

    montar()
    await userEvent.click(screen.getByText(SLOT.angulo).closest('button')!)
    await userEvent.click(screen.getByRole('button', { name: 'Descartar' }))

    expect(screen.queryByText('La base no respondió')).not.toBeNull()

    await userEvent.click(screen.getByRole('button', { name: 'Reintentar' }))

    expect(vi.mocked(descartarSlotAccion)).toHaveBeenCalledTimes(2)
    expect(vi.mocked(descartarSlotAccion).mock.calls[1]).toEqual(['parcelas', '2026-09', 'slot-1'])
  })

  it('un error no reintentable no ofrece reintentar', async () => {
    vi.mocked(descartarSlotAccion).mockResolvedValueOnce({
      ok: false,
      mensaje: 'La grilla de 2026-09 está en estado "aprobada"',
      reintentable: false,
    })

    montar()
    await userEvent.click(screen.getByText(SLOT.angulo).closest('button')!)
    await userEvent.click(screen.getByRole('button', { name: 'Descartar' }))

    expect(screen.queryByText(/está en estado "aprobada"/)).not.toBeNull()
    expect(screen.queryByRole('button', { name: 'Reintentar' })).toBeNull()
  })
})
```

- [ ] **Step 10: Correr y verificar**

Run: `pnpm --filter @gc/web test PanelDeDetalle`
Esperado: PASS, 4 pruebas.

Si alguna falla, **no la ajustes para que pase**: el spec anticipa que alguna de estas garantías podía no cumplirse. Diagnostica el componente y arréglalo ahí, dejando la prueba como está. Si la garantía resulta estar mal enunciada, dilo en el reporte de la tarea en vez de reescribirla en silencio.

- [ ] **Step 11: Confirmar que la del foco puede fallar**

En `RejillaDelMes.tsx`, comenta temporalmente la línea `disparadorRef.current?.focus()` dentro de `cerrar()`.

Run: `pnpm --filter @gc/web test PanelDeDetalle`
Esperado: FAIL en las dos pruebas de foco.

**Restaura** y vuelve a correr: PASS.

- [ ] **Step 12: Suite completa**

Run:
```bash
pnpm -r typecheck && pnpm test 2>&1 | grep -E "Tests +[0-9]+ (passed|failed)"
```

Esperado: typecheck limpio, 270 pruebas, sin fallos.

- [ ] **Step 13: Commit**

```bash
git add -A
git commit -m "test: arnés de componentes de cliente para la web

jsdom y testing-library, con las Server Actions sustituidas: la prueba
afirma qué llama el componente y qué muestra, no qué escribe la base —
eso ya está cubierto contra Postgres real en @gc/operaciones.

Cierra cuatro de las cinco garantías que la revisión de 1A listó como
\"fallarían en silencio\": las fichas descartadas se leen como
descartadas, cada slot cae en una celda, Reintentar repite la operación
que falló sin degradarla, y el foco entra al diálogo y vuelve a la
ficha. La quinta depende de un cambio que todavía no existe.

El entorno jsdom se pide por archivo y no en la configuración: las
pruebas que golpean Postgres siguen en node.

Resultado pasa a poder llevar datos en la misma tarea porque los mocks
de las pruebas lo devuelven: cambiar el tipo después habría obligado a
reescribir los tres archivos que esta agrega.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

## Task 5: `Resultado<T>` y la versión que muestra el editor de perfil

**Archivos:**
- Modificar: `apps/web/src/acciones.ts`, `apps/web/src/componentes/EditorDePerfil.tsx`
- Crear: `apps/web/src/componentes/EditorDePerfil.test.tsx`

**Interfaces:**
- Consume: el arnés y el `Resultado<T = null>` de la Task 4
- Produce: `guardarPerfilAction(slug, textoJson): Promise<Resultado<{ version: number }>>`. Las otras acciones siguen devolviendo `Resultado` (es decir, `Resultado<null>`).

- [ ] **Step 1: Escribir la prueba que falla**

Crea `apps/web/src/componentes/EditorDePerfil.test.tsx`:

```tsx
// @vitest-environment jsdom
import { cleanup, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { guardarPerfilAction } from '../acciones.js'
import { EditorDePerfil } from './EditorDePerfil.js'

vi.mock('../acciones.js', () => ({
  guardarPerfilAction: vi.fn(async () => ({ ok: true, datos: { version: 8 } })),
}))

afterEach(cleanup)
beforeEach(() => vi.mocked(guardarPerfilAction).mockClear())

const PROPS = {
  marca: 'parcelas',
  version: 7,
  perfil: { pilares: [] },
  versiones: [{ version: 7, createdAt: new Date('2026-08-01T00:00:00Z') }],
}

describe('EditorDePerfil', () => {
  it('anuncia la versión que devolvió la acción, no la que traía de props', async () => {
    vi.mocked(guardarPerfilAction).mockResolvedValueOnce({ ok: true, datos: { version: 8 } })

    render(<EditorDePerfil {...PROPS} />)
    await userEvent.click(screen.getByRole('button', { name: 'Guardar' }))

    expect(screen.queryByText('Perfil guardado como versión 8.')).not.toBeNull()
    expect(screen.queryByText('Perfil guardado como versión 7.')).toBeNull()
  })

  it('un JSON inválido muestra el mensaje del dominio y no ofrece reintentar', async () => {
    vi.mocked(guardarPerfilAction).mockResolvedValueOnce({
      ok: false,
      mensaje: 'El texto no es JSON válido: Unexpected token',
      reintentable: false,
    })

    render(<EditorDePerfil {...PROPS} />)
    await userEvent.click(screen.getByRole('button', { name: 'Guardar' }))

    expect(screen.getByRole('alert').textContent).toContain('no es JSON válido')
    expect(screen.queryByRole('button', { name: 'Reintentar' })).toBeNull()
  })

  it('"Reintentar" vuelve a llamar con el mismo texto', async () => {
    vi.mocked(guardarPerfilAction)
      .mockResolvedValueOnce({ ok: false, mensaje: 'La base no respondió', reintentable: true })
      .mockResolvedValueOnce({ ok: true, datos: { version: 8 } })

    render(<EditorDePerfil {...PROPS} />)
    await userEvent.click(screen.getByRole('button', { name: 'Guardar' }))
    await userEvent.click(screen.getByRole('button', { name: 'Reintentar' }))

    expect(vi.mocked(guardarPerfilAction)).toHaveBeenCalledTimes(2)
    expect(vi.mocked(guardarPerfilAction).mock.calls[0]).toEqual(
      vi.mocked(guardarPerfilAction).mock.calls[1],
    )
    expect(screen.queryByText('Perfil guardado como versión 8.')).not.toBeNull()
  })
})
```

- [ ] **Step 2: Correr y verificar que falla**

Run: `pnpm --filter @gc/web test EditorDePerfil`
Esperado: FAIL en la primera — muestra "versión 7", que es la de props.

- [ ] **Step 3: `guardarPerfilAction` devuelve la versión**

`Resultado<T>` y `ejecutar<T>` ya existen desde la Task 4. Lo que falta es que esta acción los aproveche: `cargarPerfilDeObjeto` ya devuelve la versión que quedó, y hasta ahora se descartaba.

En `apps/web/src/acciones.ts`, `guardarPerfilAction` pasa a:

```ts
export async function guardarPerfilAction(
  slug: string,
  textoJson: string,
): Promise<Resultado<{ version: number }>> {
  let perfil: unknown
  try {
    perfil = JSON.parse(textoJson)
  } catch (error) {
    return {
      ok: false,
      mensaje: `El texto no es JSON válido: ${error instanceof Error ? error.message : String(error)}`,
      reintentable: false,
    }
  }

  // `cargarPerfilDeObjeto` ya devuelve la versión que quedó. Devolverla al
  // cliente es lo que permite que el editor anuncie la versión real en vez de
  // la que traía en props, que es la anterior hasta que la revalidación llega.
  return ejecutar(`/${slug}/perfil`, (db, organizationId) =>
    cargarPerfilDeObjeto(db, organizationId, { slug, perfil }).then((version) => ({ version })),
  )
}
```

- [ ] **Step 4: El editor usa la versión devuelta**

En `apps/web/src/componentes/EditorDePerfil.tsx`:

1. Cambia el estado:

```ts
  const [versionGuardada, setVersionGuardada] = useState<number | null>(null)
```

sustituyendo a `const [guardadoOk, setGuardadoOk] = useState(false)`.

2. En `guardar()`, reemplaza `setGuardadoOk(false)` inicial por `setVersionGuardada(null)`, y `setGuardadoOk(true)` por `setVersionGuardada(resultado.datos.version)`.

3. En el `onChange` del textarea, `setGuardadoOk(false)` pasa a `setVersionGuardada(null)`.

4. El mensaje pasa a:

```tsx
          {versionGuardada !== null && (
            <span className="text-sm text-green-700">
              Perfil guardado como versión {versionGuardada}.
            </span>
          )}
```

5. Actualiza el comentario del componente: donde dice que `versiones` (prop) crece tras el guardado, agrega que **el número anunciado sale del retorno de la acción y no de `version`**, porque la prop llega recién con la revalidación y hasta entonces vale la versión anterior.

- [ ] **Step 5: Correr y verificar que pasa**

Run: `pnpm --filter @gc/web test EditorDePerfil`
Esperado: PASS, 3 pruebas.

- [ ] **Step 6: Confirmar que la primera puede fallar**

Cambia temporalmente `setVersionGuardada(resultado.datos.version)` por `setVersionGuardada(version)`.

Run: `pnpm --filter @gc/web test EditorDePerfil`
Esperado: FAIL en "anuncia la versión que devolvió la acción".

**Restaura** y vuelve a correr: PASS.

- [ ] **Step 7: Suite completa y build**

Run:
```bash
pnpm -r typecheck && pnpm test 2>&1 | grep -E "Tests +[0-9]+ (passed|failed)" && pnpm --filter @gc/web build
```

Esperado: typecheck limpio, 273 pruebas sin fallos, build exitoso con las cuatro rutas en `ƒ`.

- [ ] **Step 8: Commit**

```bash
git add -A
git commit -m "fix: el editor de perfil anuncia la versión que realmente quedó

Leía el número de sus props, que se actualiza recién cuando llega la
revalidación del servidor: entre que la acción responde y eso ocurre,
el mensaje afirmaba la versión anterior.

Resultado pasa a poder llevar datos y guardarPerfilAction devuelve la
versión. Con eso queda cerrada la quinta garantía del arnés.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

## Task 6: Reabrir la grilla desde la web

**Archivos:**
- Modificar: `apps/web/src/acciones.ts`, `apps/web/src/app/[marca]/grilla/[mes]/page.tsx`, `apps/web/src/componentes/PanelDeDetalle.tsx`
- Crear: `apps/web/src/componentes/BotonReabrirGrilla.tsx`, `apps/web/src/componentes/BotonReabrirGrilla.test.tsx`

**Interfaces:**
- Consume: `Resultado` de la Task 5; el arnés de la Task 4; `reabrirGrilla(db, organizationId, { slug, mes })` que ya existe en `@gc/operaciones`
- Produce: `reabrirGrillaAccion(marca, mes): Promise<Resultado>` y el componente `BotonReabrirGrilla({ marca, mes })`

- [ ] **Step 1: La Server Action**

Agrega a `apps/web/src/acciones.ts`, junto a `aprobarGrillaAccion`:

```ts
/**
 * Devuelve una grilla aprobada a borrador. `reabrirGrilla` solo acepta esa
 * transición: desde `en_ejecucion` o `cerrada` no, porque ahí ya hay
 * publicaciones en vuelo o cerradas y reabrir no las deshace.
 */
export async function reabrirGrillaAccion(marca: string, mes: string): Promise<Resultado> {
  return ejecutar(`/${marca}/grilla/${mes}`, async (db, organizationId) => {
    await reabrirGrilla(db, organizationId, { slug: marca, mes })
    return null
  })
}
```

Y agrega `reabrirGrilla` al import de `@gc/operaciones` de ese archivo.

- [ ] **Step 2: Escribir la prueba del botón**

Crea `apps/web/src/componentes/BotonReabrirGrilla.test.tsx`:

```tsx
// @vitest-environment jsdom
import { cleanup, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { reabrirGrillaAccion } from '../acciones.js'
import { BotonReabrirGrilla } from './BotonReabrirGrilla.js'

vi.mock('../acciones.js', () => ({
  reabrirGrillaAccion: vi.fn(async () => ({ ok: true, datos: null })),
}))

afterEach(cleanup)
beforeEach(() => vi.mocked(reabrirGrillaAccion).mockClear())

describe('BotonReabrirGrilla', () => {
  it('no reabre hasta que se confirma', async () => {
    render(<BotonReabrirGrilla marca="parcelas" mes="2026-09" />)

    await userEvent.click(screen.getByRole('button', { name: 'Reabrir grilla' }))
    expect(vi.mocked(reabrirGrillaAccion)).not.toHaveBeenCalled()

    await userEvent.click(screen.getByRole('button', { name: 'Sí, reabrir' }))
    expect(vi.mocked(reabrirGrillaAccion)).toHaveBeenCalledExactlyOnceWith('parcelas', '2026-09')
  })

  it('cancelar no reabre', async () => {
    render(<BotonReabrirGrilla marca="parcelas" mes="2026-09" />)

    await userEvent.click(screen.getByRole('button', { name: 'Reabrir grilla' }))
    await userEvent.click(screen.getByRole('button', { name: 'Cancelar' }))

    expect(vi.mocked(reabrirGrillaAccion)).not.toHaveBeenCalled()
    expect(screen.queryByRole('button', { name: 'Reabrir grilla' })).not.toBeNull()
  })

  it('un fallo transitorio ofrece reintentar y repite la misma llamada', async () => {
    vi.mocked(reabrirGrillaAccion)
      .mockResolvedValueOnce({ ok: false, mensaje: 'La base no respondió', reintentable: true })
      .mockResolvedValueOnce({ ok: true, datos: null })

    render(<BotonReabrirGrilla marca="parcelas" mes="2026-09" />)
    await userEvent.click(screen.getByRole('button', { name: 'Reabrir grilla' }))
    await userEvent.click(screen.getByRole('button', { name: 'Sí, reabrir' }))

    expect(screen.queryByText('La base no respondió')).not.toBeNull()

    await userEvent.click(screen.getByRole('button', { name: 'Reintentar' }))
    expect(vi.mocked(reabrirGrillaAccion)).toHaveBeenCalledTimes(2)
  })
})
```

- [ ] **Step 3: Correr y verificar que falla**

Run: `pnpm --filter @gc/web test BotonReabrirGrilla`
Esperado: FAIL con "Failed to resolve import ./BotonReabrirGrilla.js".

- [ ] **Step 4: Escribir el componente**

Crea `apps/web/src/componentes/BotonReabrirGrilla.tsx`:

```tsx
'use client'

import { useState } from 'react'
import { reabrirGrillaAccion } from '../acciones.js'

/**
 * La puerta de vuelta de la aprobación. Solo se renderiza cuando `page.tsx`
 * decide que el estado es `aprobada`; tras reabrir, la Server Action revalida
 * la ruta y el servidor vuelve a renderizar con `estado === 'borrador'`, lo
 * que hace desaparecer este botón sin estado local que lo controle.
 *
 * Pide confirmación por simetría con `BotonAprobarGrilla`, no porque reabrir
 * sea destructivo: no lo es. Lo que dice la confirmación es lo que sí importa
 * —que la grilla vuelve a ser regenerable por el motor— porque regenerar sí
 * reemplaza los slots.
 */
export function BotonReabrirGrilla({ marca, mes }: { marca: string; mes: string }) {
  const [confirmando, setConfirmando] = useState(false)
  const [ocupado, setOcupado] = useState(false)
  const [error, setError] = useState<{ mensaje: string; reintentable: boolean } | null>(null)

  async function reabrir() {
    setOcupado(true)
    setError(null)

    const resultado = await reabrirGrillaAccion(marca, mes)
    if (!resultado.ok) {
      setError({ mensaje: resultado.mensaje, reintentable: resultado.reintentable })
      setOcupado(false)
      return
    }

    setOcupado(false)
    setConfirmando(false)
  }

  return (
    <div className="flex flex-col items-end gap-1">
      {!confirmando ? (
        <button
          type="button"
          onClick={() => setConfirmando(true)}
          className="rounded border border-gray-300 px-3 py-1.5 text-sm font-medium text-gray-700 hover:bg-gray-50"
        >
          Reabrir grilla
        </button>
      ) : (
        <div className="max-w-sm rounded border border-amber-300 bg-amber-50 p-3 text-left text-sm text-amber-900">
          <p className="mb-2">
            Reabrir la grilla de {mes} la devuelve a borrador: sus publicaciones vuelven a poder
            editarse y descartarse, y el motor vuelve a poder regenerar el mes — lo que reemplaza
            los slots que haya.
          </p>
          <div className="flex flex-wrap gap-2">
            <button
              type="button"
              disabled={ocupado}
              onClick={() => void reabrir()}
              className="rounded bg-indigo-600 px-2 py-1 text-xs font-medium text-white hover:bg-indigo-700 disabled:opacity-50"
            >
              Sí, reabrir
            </button>
            <button
              type="button"
              disabled={ocupado}
              onClick={() => {
                setConfirmando(false)
                setError(null)
              }}
              className="rounded px-2 py-1 text-xs font-medium text-amber-700 hover:bg-amber-100 disabled:opacity-50"
            >
              Cancelar
            </button>
          </div>
        </div>
      )}
      {error && (
        <div className="max-w-xs rounded border border-red-300 bg-red-50 p-2 text-right text-xs text-red-800">
          <p>{error.mensaje}</p>
          {error.reintentable && (
            <button type="button" onClick={() => void reabrir()} className="font-medium underline">
              Reintentar
            </button>
          )}
        </div>
      )}
    </div>
  )
}
```

- [ ] **Step 5: Correr y verificar que pasa**

Run: `pnpm --filter @gc/web test BotonReabrirGrilla`
Esperado: PASS, 3 pruebas.

- [ ] **Step 6: Confirmar que la primera puede fallar**

Cambia temporalmente el `onClick` del botón "Reabrir grilla" por `() => void reabrir()`.

Run: `pnpm --filter @gc/web test BotonReabrirGrilla`
Esperado: FAIL en "no reabre hasta que se confirma".

**Restaura** y vuelve a correr: PASS.

- [ ] **Step 7: Colgarlo de la cabecera**

En `apps/web/src/app/[marca]/grilla/[mes]/page.tsx`, agrega el import:

```tsx
import { BotonReabrirGrilla } from '../../../../componentes/BotonReabrirGrilla.js'
```

Y debajo del bloque de `BotonAprobarGrilla`:

```tsx
          {grilla.estado === 'aprobada' && <BotonReabrirGrilla marca={marca} mes={mes} />}
```

- [ ] **Step 8: Quitar las dos instrucciones de terminal que ya no aplican**

Ahora que reabrir vive en la pantalla, los dos textos que mandaban al usuario a la terminal quedan desactualizados.

En `apps/web/src/componentes/PanelDeDetalle.tsx`, el bloque `{estado === 'aprobada' && (...)}` dentro del párrafo de no-editable pasa a:

```tsx
            {estado === 'aprobada' && (
              <> Para volver a editarla, usa «Reabrir grilla» en la cabecera del mes.</>
            )}
```

En `apps/web/src/componentes/BotonAprobarGrilla.tsx`, el párrafo de confirmación pasa a:

```tsx
          <p className="mb-2">
            Aprobar la grilla de {mes} la deja fija: sus publicaciones dejan de poder editarse o
            descartarse, y el mes ya no se regenera. Se puede deshacer con «Reabrir grilla», que
            aparece en esta misma cabecera una vez aprobada.
          </p>
```

- [ ] **Step 9: Suite completa y build**

Run:
```bash
pnpm -r typecheck && pnpm test 2>&1 | grep -E "Tests +[0-9]+ (passed|failed)" && pnpm --filter @gc/web build
```

Esperado: typecheck limpio, 276 pruebas sin fallos, build exitoso con las cuatro rutas en `ƒ`.

- [ ] **Step 10: Commit**

```bash
git add -A
git commit -m "feat: reabrir la grilla desde la web

reabrirGrilla ya existía y estaba probada, pero solo se alcanzaba por
terminal: aprobar dejaba el mes inmutable desde la pantalla que lo
aprobó. Ahora el botón aparece en la cabecera cuando el estado es
aprobada.

Los dos textos que mandaban al usuario a correr pnpm cli grilla:reabrir
apuntan a la pantalla.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

## Task 7: Slots fuera de la rejilla y cotas de longitud

**Archivos:**
- Modificar: `apps/web/src/calendario.ts`, `apps/web/src/calendario.test.ts`, `apps/web/src/componentes/RejillaDelMes.tsx`, `apps/web/src/componentes/RejillaDelMes.test.tsx`, `packages/strategy/src/esquemas.ts`, `packages/strategy/src/esquemas.test.ts`, `packages/operaciones/src/grilla.test.ts`

**Interfaces:**
- Consume: el arnés de la Task 4
- Produce: `slotsFueraDeLaRejilla(slots: SlotDeLaGrilla[], semanas: string[][]): SlotDeLaGrilla[]` en `apps/web/src/calendario.ts`

- [ ] **Step 1: Escribir la prueba de la función pura**

Agrega a `apps/web/src/calendario.test.ts`:

```ts
describe('slotsFueraDeLaRejilla', () => {
  const base = {
    hora: '10:00',
    canal: 'instagram',
    formato: 'carrusel',
    pilar: 'educativo',
    angulo: 'Un ángulo',
    brief: 'Un brief cualquiera con largo suficiente.',
    descartado: false,
    esDerivado: false,
    idDelPadre: null,
  }

  it('devuelve vacío cuando todos los slots caen en una celda', () => {
    const semanas = semanasDelMes('2026-09')
    const slots = [
      { ...base, id: 'a', fecha: '2026-09-01' },
      { ...base, id: 'b', fecha: '2026-09-30' },
      // Un día de relleno del mes vecino sí se renderiza, así que no está fuera.
      { ...base, id: 'c', fecha: semanas[0]![0]! },
    ]

    expect(slotsFueraDeLaRejilla(slots, semanas)).toEqual([])
  })

  it('encuentra el slot cuya fecha no aparece en ninguna semana', () => {
    const semanas = semanasDelMes('2026-09')
    const perdido = { ...base, id: 'perdido', fecha: '2026-11-15' }

    const fuera = slotsFueraDeLaRejilla([{ ...base, id: 'a', fecha: '2026-09-10' }, perdido], semanas)

    expect(fuera).toEqual([perdido])
  })

  it('conserva el orden de entrada', () => {
    const semanas = semanasDelMes('2026-09')
    const uno = { ...base, id: 'uno', fecha: '2026-11-15' }
    const dos = { ...base, id: 'dos', fecha: '2026-01-02' }

    expect(slotsFueraDeLaRejilla([uno, dos], semanas).map((s) => s.id)).toEqual(['uno', 'dos'])
  })
})
```

Agrega `slotsFueraDeLaRejilla` al import de `./calendario.js` del archivo.

- [ ] **Step 2: Correr y verificar que falla**

Run: `pnpm --filter @gc/web test calendario`
Esperado: FAIL con "slotsFueraDeLaRejilla is not a function".

- [ ] **Step 3: Implementar**

Agrega al final de `apps/web/src/calendario.ts`:

```ts
/**
 * Los slots cuya fecha no aparece en ninguna de las semanas renderizadas.
 *
 * Un slot así no se muestra pero sí cuenta —en `porCanal` y en los problemas
 * que calcula `grillaDelMes`— y esa es la peor combinación: la cabecera dice
 * que hay algo que la rejilla no enseña. La rejilla los pinta aparte.
 *
 * Vive aquí y no dentro del componente por el mismo motivo que
 * `derivadosVigentesDe`: es una derivación sobre los datos cargados, y el
 * renderizado tiene arnés pero la lógica que decide qué se muestra merece su
 * propia prueba, independiente de cómo se pinte.
 */
export function slotsFueraDeLaRejilla(
  slots: SlotDeLaGrilla[],
  semanas: string[][],
): SlotDeLaGrilla[] {
  const renderizadas = new Set(semanas.flat())
  return slots.filter((s) => !renderizadas.has(s.fecha))
}
```

- [ ] **Step 4: Correr y verificar que pasa**

Run: `pnpm --filter @gc/web test calendario`
Esperado: PASS.

- [ ] **Step 5: Confirmar que puede fallar**

Cambia temporalmente `!renderizadas.has(s.fecha)` por `renderizadas.has(s.fecha)`.

Run: `pnpm --filter @gc/web test calendario`
Esperado: FAIL en las tres pruebas nuevas.

**Restaura** y vuelve a correr: PASS.

- [ ] **Step 6: La prueba de que la rejilla los muestra**

Agrega a `apps/web/src/componentes/RejillaDelMes.test.tsx`, dentro del `describe` existente:

```tsx
  it('un slot fuera de las semanas renderizadas se muestra aparte y no desaparece', () => {
    render(
      <RejillaDelMes
        marca="parcelas"
        mes="2026-09"
        estado="borrador"
        semanas={semanasDelMes('2026-09')}
        slots={[slot('dentro', '2026-09-10'), slot('fuera', '2026-11-15')]}
      />,
    )

    expect(screen.queryByText('Ángulo de dentro')).not.toBeNull()
    expect(screen.queryByText('Ángulo de fuera')).not.toBeNull()
    expect(screen.queryByText(/fuera de 2026-09/i)).not.toBeNull()
  })
```

- [ ] **Step 7: Correr y verificar que falla**

Run: `pnpm --filter @gc/web test RejillaDelMes`
Esperado: FAIL — "Ángulo de fuera" no está en el documento.

- [ ] **Step 8: La rejilla los pinta**

En `apps/web/src/componentes/RejillaDelMes.tsx`:

1. Agrega `slotsFueraDeLaRejilla` al import de `../calendario.js`.
2. Junto a las otras derivaciones, antes del `return`:

```tsx
  // Un slot cuya fecha no cae en ninguna celda existía y contaba en la
  // cabecera, pero no se veía por ningún lado. No debería ocurrir —la
  // generación valida que las fechas caigan en el mes— pero si ocurre, es
  // preferible verlo que perderlo.
  const fueraDeLaRejilla = slotsFueraDeLaRejilla(slots, semanas)
```

3. Entre el `</div>` que cierra la rejilla y el bloque de `{seleccionado && (`:

```tsx
      {fueraDeLaRejilla.length > 0 && (
        <section className="mt-4 rounded border border-amber-300 bg-amber-50 p-3">
          <h2 className="mb-2 text-sm font-semibold text-amber-900">
            {fueraDeLaRejilla.length === 1
              ? '1 publicación cae fuera de '
              : `${fueraDeLaRejilla.length} publicaciones caen fuera de `}
            {mes}
          </h2>
          <p className="mb-2 text-xs text-amber-800">
            Su fecha no corresponde a ningún día de este calendario, así que no aparece arriba —
            pero sí cuenta en los totales de la cabecera.
          </p>
          <div className="flex flex-col gap-1">
            {fueraDeLaRejilla.map((s) => (
              <div key={s.id}>
                <span className="mr-2 text-xs text-amber-900">{s.fecha}</span>
                <FichaDeSlot slot={s} onSeleccionar={abrir} />
              </div>
            ))}
          </div>
        </section>
      )}
```

- [ ] **Step 9: Correr y verificar que pasa**

Run: `pnpm --filter @gc/web test RejillaDelMes`
Esperado: PASS, 4 pruebas.

- [ ] **Step 10: Las cotas de longitud**

En `packages/strategy/src/esquemas.ts`, los dos campos pasan a:

```ts
  // Los mensajes van en español porque estos dos campos son los únicos que la
  // interfaz web deja editar a mano (`editarSlot`), y ahí el texto del rechazo
  // se muestra tal cual al usuario. Las cotas superiores existen por el mismo
  // motivo que las inferiores: sin ellas un pegado accidental persistía
  // completo. Los números salen de para qué sirve cada campo —el ángulo es una
  // frase, el brief es un párrafo de encargo— y quedan muy por encima de lo
  // que produce el modelo, así que no rechazan generación legítima.
  angulo: z
    .string()
    .min(5, 'debe tener al menos 5 caracteres')
    .max(200, 'no puede pasar de 200 caracteres'),
  brief: z
    .string()
    .min(20, 'debe tener al menos 20 caracteres')
    .max(2000, 'no puede pasar de 2000 caracteres'),
```

- [ ] **Step 11: La prueba de las cotas**

Agrega a `packages/strategy/src/esquemas.test.ts`:

```ts
  it('SlotPropuesto rechaza un ángulo o un brief pasados de largo', () => {
    const base = {
      fecha: '2026-09-03',
      hora: '10:00',
      canal: 'instagram' as const,
      formato: 'carrusel',
      pilar: 'educativo',
      angulo: 'Un ángulo razonable',
      brief: 'Un brief cualquiera con largo suficiente para pasar el mínimo.',
    }

    expect(SlotPropuesto.safeParse({ ...base, angulo: 'a'.repeat(201) }).success).toBe(false)
    expect(SlotPropuesto.safeParse({ ...base, angulo: 'a'.repeat(200) }).success).toBe(true)
    expect(SlotPropuesto.safeParse({ ...base, brief: 'b'.repeat(2001) }).success).toBe(false)
    expect(SlotPropuesto.safeParse({ ...base, brief: 'b'.repeat(2000) }).success).toBe(true)
  })
```

Asegúrate de que el archivo importe `SlotPropuesto`.

- [ ] **Step 12: La prueba de que `editarSlot` hereda la cota**

Agrega a `packages/operaciones/src/grilla.test.ts`, dentro del `describe('descartarSlot, editarSlot y aprobarGrilla')`:

```ts
  it('editarSlot rechaza un brief pasado de largo, con el mensaje en español', async () => {
    await conBaseDeDatosDePrueba(async (db) => {
      const ref = await sembrarConGrilla(db)
      const g = await grillaDelMes(db, ref.organizationId, 'parcelas', '2026-09')
      const slot = g.slots[0]!

      await expect(
        editarSlot(db, ref.organizationId, slot.id, {
          angulo: 'Un ángulo razonable',
          brief: 'b'.repeat(2001),
        }),
      ).rejects.toThrow(/no puede pasar de 2000 caracteres/)

      // Y la fila no se tocó.
      const despues = await grillaDelMes(db, ref.organizationId, 'parcelas', '2026-09')
      expect(despues.slots[0]!.brief).toBe(slot.brief)
    })
  })
```

- [ ] **Step 13: Correr y confirmar que las cotas pueden fallar**

Run: `pnpm --filter @gc/strategy test esquemas && pnpm --filter @gc/operaciones test grilla`
Esperado: PASS.

Ahora borra temporalmente `.max(2000, 'no puede pasar de 2000 caracteres')` de `brief`.

Run: `pnpm --filter @gc/strategy test esquemas && pnpm --filter @gc/operaciones test grilla`
Esperado: FAIL en ambas.

**Restaura** y vuelve a correr: PASS.

- [ ] **Step 14: Suite completa y build**

Run:
```bash
pnpm -r typecheck && pnpm test 2>&1 | grep -E "RUN  v|Tests +[0-9]+ (passed|failed)" && pnpm --filter @gc/web build
```

Esperado: typecheck limpio, 282 pruebas en diez paquetes sin fallos, build exitoso con las cuatro rutas en `ƒ`.

- [ ] **Step 15: Commit**

```bash
git add -A
git commit -m "fix: nada queda contado e invisible, y el texto tiene cota

Un slot cuya fecha no cae en ninguna celda de la rejilla no se veía,
pero sí contaba en los totales de la cabecera. Ahora se muestran en un
grupo aparte que dice exactamente eso. La derivación es una función
pura probada, como derivadosVigentesDe.

angulo y brief ganan .max(): tenían mínimo y no máximo, así que un
pegado accidental persistía completo. La cota es del dominio, no del
formulario, así que aplica también a lo que genera el modelo.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

## Verificación final de la rama

Antes de considerar la rama terminada, las tres comprobaciones obligatorias del proyecto — las tres han encontrado cosas que las otras no.

- [ ] **Las pruebas de dominio**

```bash
pnpm test 2>&1 | grep -E "RUN  v|Tests +[0-9]+ (passed|failed)"
```

Esperado: diez paquetes, 282 pruebas, cero fallos.

- [ ] **El bundle**

```bash
pnpm -r typecheck && pnpm --filter @gc/web build
```

Esperado: typecheck limpio; build exitoso; `/`, `/[marca]/grilla/[mes]`, `/[marca]/perfil` y `/[marca]/estrategia` con `ƒ` y no `○`.

- [ ] **La garantía que motivó la rama**

```bash
pnpm --filter @gc/web why @gc/ai
```

Esperado: ninguna cadena de dependencia.

- [ ] **El uso real, a mano**

La base de desarrollo tiene la marca `parcelas` con perfil cargado, estrategia `2026-Q3` y la grilla de `2026-09` en borrador. **Si esta verificación la modifica, restáurala.**

```bash
pnpm --filter @gc/web dev
```

En `http://localhost:3000`:
1. La grilla de `2026-09` carga y muestra sus slots.
2. Aprobar la grilla: el botón «Reabrir grilla» aparece y el de aprobar desaparece.
3. Reabrir: vuelve a borrador y los botones se invierten. **Deja el mes en borrador.**
4. La pantalla de estrategia muestra la de `2026-Q3` con su estado.
5. La de perfil guarda y anuncia el número de versión nuevo.

Y el CLI, que es el otro consumidor de los paquetes que se movieron:

```bash
pnpm cli grilla:ver --marca parcelas --mes 2026-09
pnpm cli estrategia:generar --marca parcelas --periodo 2026-Q4 --seco
```

Esperado: el primero lista los slots; el segundo genera con las muestras locales sin gastar tokens. **Si el segundo dejó una estrategia `2026-Q4` que antes no existía, bórrala** para devolver la base de desarrollo a su estado documentado.

- [ ] **Actualizar `pendientes.md`**

Los cinco puntos de "Prioridad 1 — insumos para el diseño de los bloques 1B y 1C" pasan a una sección `## ✅ Cerrado`, con una línea por punto que diga cómo se resolvió y un enlace al spec y al plan. Sigue el formato de la sección "✅ Cerrado: los tres puntos de Prioridad 1 originales" que ya existe.

Registra también lo que **no** se cerró y por qué: las páginas async de servidor siguen sin pruebas de renderizado, y la rama de auto-creación de organización sigue sin ser segura ante concurrencia (Prioridad 2), ahora solo alcanzable desde el CLI.

- [ ] **Cerrar la rama**

Usa la skill `superpowers:finishing-a-development-branch`.

---

## Notas para quien ejecute

**El orden importa.** La Task 1 es la que puede romper todo y va primera, con la suite completa como red. Las tareas 5, 6 y 7 dependen del arnés de la Task 4. La Task 2 depende del paquete de la Task 1. Solo la Task 3 es independiente.

**Los conteos de pruebas son acumulativos y están calculados:** 252 → 258 (T2) → 261 (T3) → 270 (T4) → 273 (T5) → 276 (T6) → 282 (T7). Si un total no calza, algo se saltó en silencio — averigua qué antes de seguir.

**Cuando una prueba nueva nace roja, el componente es el sospechoso, no la prueba.** El spec anticipa que alguna de las cinco garantías podía no cumplirse. Arregla el código y deja la prueba como está; si la garantía resulta mal enunciada, dilo explícitamente en el reporte en vez de reescribirla.
