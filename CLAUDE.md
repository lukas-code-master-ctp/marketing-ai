# Gestor de contenido multimarca

Sistema que automatiza la creación y publicación de contenido en redes para tres startups, cada una con su propio branding. Orquestado por IA vía OpenRouter.

**Estado: motor completo y app web local.** Genera estrategia trimestral y grilla mensual, y las revisas y apruebas en el navegador. Publicar en redes es Fase 3 y no existe todavía.

## Documentos que mandan

| Documento | Qué contiene |
|---|---|
| [Diseño general](docs/superpowers/specs/2026-07-31-gestor-contenido-multimarca-design.md) | Arquitectura de las cuatro fases, y la realidad de cada API de red social |
| [pendientes.md](docs/superpowers/specs/pendientes.md) | **Léelo antes de planificar nada.** Deuda registrada, decisiones tomadas, y lo que se descartó a propósito |

Cada bloque de trabajo tiene su spec y su plan en `docs/superpowers/`. Los planes son el registro de por qué el código es como es.

## Comandos

```bash
docker compose up -d          # Postgres. Sin esto fallan seis paquetes
pnpm test                     # NUNCA `pnpm -r test` — ver abajo
pnpm -r typecheck
pnpm --filter @gc/web dev     # http://localhost:3000
pnpm --filter @gc/web build   # parte de "terminado" para la app web
pnpm cli                      # ayuda del CLI
```

## Reglas que no son negociables

Cada una existe porque romperla ya costó trabajo real.

**`pnpm test`, nunca `pnpm -r test`.** Todos los paquetes comparten la base de pruebas y cada prueba la vacía al empezar. En paralelo se pisan. El script de la raíz los serializa.

**Un solo `.env`, en la raíz.** Ningún paquete tiene el suyo. Las pruebas lo cargan con `setupFiles: ['../../vitest.setup.ts']`; `next.config.ts` y el CLI lo resuelven desde `import.meta.url`. Una copia por paquete rompería cualquier clon nuevo.

**Una migración aplicada es inmutable.** Un error se corrige con otra migración, jamás editando la anterior — el registro de drizzle no la reejecuta y el envoltorio `DO $$ ... EXCEPTION` la descartaría en silencio. Las migraciones nuevas van **sin** ese envoltorio: una que se salta sola es peor que una que falla.

**Idioma.** Esquema y columnas en inglés `snake_case`. API de dominio, variables, comentarios, prompts y **todo texto que ve el usuario** en español.

**Los enumerados se hacen cumplir con `CHECK` en Postgres.** `text(col, { enum })` de Drizzle no genera restricción alguna.

**La tenencia se verifica dentro de cada escritura**, no confiando en una lectura previa: `WHERE id = ? AND organization_id = ?`, `.returning()`, y `permanente` si no vuelve fila. Hay doce claves foráneas compuestas que además lo exigen desde la base.

**Los modelos se leen del entorno**, nunca literales en código. Solo `@gc/ai` sabe que OpenRouter existe.

**Ninguna salida del modelo se parsea con expresiones regulares.** Toda tarea declara un esquema Zod y valida. Validar entrada de usuario con regex sí es válido.

**La capa web nunca ejecuta trabajo largo ni llama al modelo.** Generar es del CLI. La web lee, edita y aprueba.

**`@gc/ai` es inalcanzable desde `apps/web`, y eso lo garantiza pnpm.** Los flujos
que llaman al modelo viven en `@gc/flujos`, que la web no declara. Si algún día
`@gc/operaciones` o `@gc/strategy` vuelven a depender de `@gc/ai` —incluso como
`devDependency`, que pnpm materializa dentro del paquete y vuelve resoluble desde
cualquier archivo suyo—, la regla "la web nunca llama al modelo" vuelve a ser una
convención. La web transpila y carga cinco paquetes (`transpilePackages` en
`apps/web/next.config.ts`), y cualquiera de ellos puede reabrir el agujero, no
solo `@gc/operaciones`. Se comprueba resolviendo de verdad, desde `apps/web` y
desde cada uno de esos cinco paquetes:

```bash
pnpm comprobar:aislamiento
```

El script (`scripts/comprobar-aislamiento.mjs`) lee la lista de paquetes a
auditar directamente de `transpilePackages` en `next.config.ts` —así una
entrada nueva ahí queda auditada sola— e intenta resolver `@gc/ai`,
`@gc/pipeline` y `@gc/flujos` desde cada uno y desde `apps/web`: todos deben
fallar. Incluye además un control positivo, desde `packages/flujos`, donde
`@gc/ai` y `@gc/pipeline` sí deben resolver; sin eso, un script roto que
dijera "no resuelve" a todo pasaría en verde sin comprobar nada. **No usa
`import()`**: los paquetes del workspace son TypeScript sin compilar, así que
`import()` rechaza para todos con `ERR_UNKNOWN_FILE_EXTENSION` y un `catch`
genérico diría "no resuelve" hasta de los declarados —una comprobación que no
puede fallar. `pnpm --filter @gc/web why @gc/ai` sirve para ver la cadena,
pero no discrimina por sí solo: no recorre las `devDependencies` de un paquete
transitivo, que es justo por donde se coló el agujero la primera vez.

Corolario: **el sembrador de pruebas de `@gc/operaciones` no arranca el motor.**
`src/pruebas/siembra.ts` inserta las filas de la grilla directamente; que P2
produzca esa forma lo verifica `p2.test.ts`, en `@gc/flujos`.

**Cada ruta de Next necesita su propio `export const dynamic = 'force-dynamic'`.** No se propaga entre árboles de rutas. Sin él la página se prerenderiza y congela sus datos en el build. Verificar en `pnpm --filter @gc/web build` que salga `ƒ` y no `○`.

## Arquitectura

```
@gc/shared      taxonomía de errores: transitorio | permanente | ambiguo
@gc/db          esquema Drizzle, 11 tablas, 5 migraciones
@gc/ai          única puerta a un modelo: ejecutarTarea, presupuesto, modo seco
@gc/pipeline    motor: reintentos, backoff, idempotencia por paso, reanudación
@gc/brand       perfiles de marca versionados
@gc/strategy    esquemas, validación, derivados, periodos, lectura de estrategia
@gc/flujos      flujos P1 (estrategia) y P2 (grilla): lo único que llama al modelo
@gc/operaciones operaciones que comparten CLI y web
apps/cli        comandos de operación
apps/web        Next.js App Router, Server Components y Server Actions
```

`esTransitorio` es el **único** punto donde se decide reintentar, y clasifica por SQLSTATE — por eso cubre toda llamada a la base sin envolverlas una por una.

P1 y P2 están partidos en dos pasos, modelo y persistencia, para que un fallo de base no recobre llamadas al modelo ya pagadas.

## Cómo se trabaja aquí

Spec → plan → ejecución por subagentes con revisión independiente por tarea → revisión adversarial de toda la rama. Las skills de `superpowers` implementan ese flujo.

No es ceremonia: en cuatro planes ese proceso encontró unos veinte defectos reales, **casi todos en los planes y no en la implementación** — idempotencia rota, aprobaciones destruidas en silencio, llamadas al modelo sin registrar, una migración editada después de aplicarse.

Dos hábitos que valen más que el resto:

**Una prueba que no puede fallar es peor que ninguna.** Este proyecto encontró cuatro que aparentaban cubrir algo y no lo cubrían. Al escribir una prueba de regresión, rompe el código a propósito y confirma que se pone roja.

**La verificación tiene que parecerse al uso.** Las pruebas de dominio no ven el bundle, el bundle no ve el navegador, y ninguno ve lo que pasa al usar el CLI a mano. Por eso las tres comprobaciones son obligatorias y las tres han encontrado cosas que las otras no.

## Entorno

Windows. `corepack enable` falla por permisos: pnpm está instalado con `npm install -g pnpm@9`. Postgres en Docker, bases `gestor` (desarrollo, con datos de marcha en seco) y `gestor_test`.

La base de desarrollo tiene la marca `parcelas` con perfil cargado, estrategia `2026-Q3` y la grilla de `2026-09` en borrador. **Si una verificación manual la modifica, restáurala.**
