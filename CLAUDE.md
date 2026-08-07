# Gestor de contenido multimarca

Sistema que automatiza la creación y publicación de contenido en redes para tres startups, cada una con su propio branding. Orquestado por IA vía OpenRouter.

**Estado: motor completo, app web desplegada, y el worker fuera de cualquier máquina local.** Genera estrategia trimestral y grilla mensual; las revisas, editas el perfil de marca con un formulario guiado y las apruebas en el navegador. **Está desplegada** en `https://marketing-ai-web.vercel.app`, contra la base de Cloud SQL: las siete migraciones aplicadas, el inicio de sesión con Google funcionando de punta a punta, y la organización `principal` con la marca `parcelas` creada desde el CLI apuntado a la base remota. El worker (bloque 1C-B) dejó de ser un proceso que alguien tiene que tener corriendo a mano: vive como servicio de Cloud Run, lo despierta Cloud Tasks cuando la web encola algo, y Cloud Scheduler lo llama cada cinco minutos como red de seguridad. La lista de redes autorizadas de la instancia de Cloud SQL sigue **vacía**. Publicar en redes es Fase 3 y no existe todavía.

## Documentos que mandan

| Documento | Qué contiene |
|---|---|
| [Diseño general](docs/superpowers/specs/2026-07-31-gestor-contenido-multimarca-design.md) | Arquitectura de las cuatro fases, y la realidad de cada API de red social |
| [pendientes.md](docs/superpowers/specs/pendientes.md) | **Léelo antes de planificar nada.** Deuda registrada, decisiones tomadas, y lo que se descartó a propósito |

Cada bloque de trabajo tiene su spec y su plan en `docs/superpowers/`. Los planes son el registro de por qué el código es como es.

## Comandos

```bash
docker compose up -d postgres # la base. Sin esto fallan diez paquetes
docker compose up -d          # lo anterior más el worker — que exige credenciales, ver abajo
pnpm test                     # NUNCA `pnpm -r test` — ver abajo
pnpm -r typecheck
pnpm --filter @gc/web dev     # http://localhost:3000
pnpm --filter @gc/web build   # parte de "terminado" para la app web
pnpm cli                      # ayuda del CLI
pnpm --filter @gc/worker start   # el worker, si no lo levantaste con docker compose
pnpm comprobar:aislamiento    # que la web no alcance al modelo
pnpm comprobar:volumenes      # que el compose tape todos los node_modules del workspace
```

Los dos primeros están separados a propósito: para trabajar en los paquetes o
en la web basta la base, y ese comando no depende de tener credenciales ni
`.env`. Prometer que `docker compose up -d` "levanta todo" sería falso en
cuanto falte la clave, y dejaría un servicio en rojo en `docker compose ps` en
una máquina perfectamente sana.

El worker ahora se niega a arrancar por **dos** motivos distintos, y en este
orden. Primero, antes de tocar la base o el modelo, `main.ts` exige
`WORKER_TOKEN` —el token compartido que la ruta HTTP del worker exige en la
cabecera `x-token-worker` (ver la sección de arquitectura y despliegue más
abajo)— y sale con `Falta WORKER_TOKEN` si no está. Recién después, al
construir el cliente del modelo, exige `OPENROUTER_API_KEY` o
`IA_EN_SECO=true`. Las dos son la misma política: prefiere no arrancar antes
que arrancar sano y, según cuál falte, marcar fallida toda la cola o dejar la
ruta abierta sin el cerrojo compartido. **Esto vale también dentro de
`docker compose`**: `WORKER_TOKEN` la fija `docker-compose.yml` (vale
`"local"`, que alcanza porque ahí nadie llama al worker por HTTP), así que con
el `.env` tal como está hoy —clave vacía y `IA_EN_SECO=false`— el contenedor
`worker` pasa esa primera comprobación, arranca, falla con
`Falta OPENROUTER_API_KEY` y queda en `Exited (1)`. No es un problema del
contenedor; es la misma negativa de siempre, y se ve con `docker compose logs
worker`. Carga la clave o pon `IA_EN_SECO=true` en el `.env` de la raíz.

La app exige sesión. En local, con `SESION_DE_DESARROLLO=true`, funciona
**sin** `AUTH_SECRET` — comprobado levantando el servidor con la variable
vacía: `GET /ruta-inexistente` da 404 y `GET /` da 307 a la grilla, igual que
con el secreto puesto. Lo que sí queda, en cada petición de página, es
`[auth][error] MissingSecret` en el log: el middleware llama a `auth()`, que
internamente pide su propia sesión a `@auth/core` y esa petición interna es
la que falla por falta de secreto; `parseSessionResponse` traduce esa
respuesta no-OK en sesión `null` **antes** de llegar al callback
`authorized`, que con la sesión de desarrollo devuelve `true`
(`apps/web/src/auth.config.ts`) y deja pasar igual. No hay ningún 500. Con
`SESION_DE_DESARROLLO=false` tampoco lo hay: el mismo `MissingSecret` queda
en el log, pero sin sesión real `authorized` deniega y redirige a
`/entrar?callbackUrl=…`. Y `sesionActual()` (`apps/web/src/auth.ts`)
cortocircuita antes de llamar a `auth()` cuando hay sesión de desarrollo, así
que las Server Actions tampoco se ven afectadas.

El costo real de dejar `AUTH_SECRET` vacío en local no es un 500: es ese
error rojo en el log, en cada petición de página, que quien no sepa esto va a
perseguir creyendo que algo se rompió. `SESION_DE_DESARROLLO=true` evita
pasar por Google —entra como `desarrollo@local`— pero no evita esa petición
interna ni su log. La variable **se ignora fuera de
`NODE_ENV=development`**, así que dejarla encendida no abre nada en
producción.

## Reglas que no son negociables

Cada una existe porque romperla ya costó trabajo real.

**`pnpm test`, nunca `pnpm -r test`.** Todos los paquetes comparten la base de pruebas y cada prueba la vacía al empezar. En paralelo se pisan. El script de la raíz los serializa.

**Un solo `.env`, en la raíz.** Ningún paquete tiene el suyo. Las pruebas lo cargan con `setupFiles: ['../../vitest.setup.ts']`; `next.config.ts` y el CLI lo resuelven desde `import.meta.url`. Una copia por paquete rompería cualquier clon nuevo.

**Una migración aplicada es inmutable.** Un error se corrige con otra migración, jamás editando la anterior — el registro de drizzle no la reejecuta y el envoltorio `DO $$ ... EXCEPTION` la descartaría en silencio. Las migraciones nuevas van **sin** ese envoltorio: una que se salta sola es peor que una que falla.

**El conector de Cloud SQL decide si autentica con un `instanceof`, y eso
exige una sola copia de `google-auth-library` en el árbol de dependencias.**
`crearConexion` (`packages/db/src/cliente.ts`) arma un `GoogleAuth` y se lo
entrega al `Connector` de `@google-cloud/cloud-sql-connector` por su opción
`auth`. Con qué credenciales lo arma depende de dónde corre: en Vercel, con
las del JSON de la cuenta de servicio (`GOOGLE_CREDENCIALES_JSON`); **dentro
de Cloud Run, sin `credentials` en absoluto**, porque ahí hay una cuenta de
servicio adherida al proceso y `GoogleAuth` la resuelve sola por el servidor
de metadatos. La señal que distingue los dos casos es `K_SERVICE`
(`packages/db/src/destino.ts`): Cloud Run la define en toda revisión, y
ningún otro entorno de este repositorio la define, así que su presencia es lo
que le dice a `destinoDeConexion` que `GOOGLE_CREDENCIALES_JSON` ya no hace
falta — en Vercel, sin esa identidad adherida, la variable sigue siendo
obligatoria. En los dos casos, adentro, el `sqladmin-fetcher` del conector
decide si usa el objeto que le llega con `loginAuth instanceof GoogleAuth` —
y esa comparación solo da cierto si `google-auth-library` resuelve, para
`@gc/db` y para el conector, al **mismo archivo**. Si pnpm instala dos
copias —porque el rango que declara el conector deja de coincidir con el que
declara `packages/db/package.json`—, el objeto cae por la rama equivocada y
la petición sale **sin credenciales**: un `401 Login Required` que no
menciona versiones ni copias. Ya mordió una vez, en la prueba de humo contra
la instancia real. Ni el resto de la suite ni `pnpm -r typecheck` ven qué
copia resuelve cada paquete —eso exige mirar el árbol de `node_modules`, no
los tipos ni el comportamiento normal—, así que hace falta una prueba
dedicada, que sí corre dentro de `pnpm test`:
`packages/db/src/resolucion-google-auth-library.test.ts`, que afirma con
`require.resolve` en vez de confiar en que los rangos declarados coincidan.
Esa misma prueba comprueba también que `@gc/despertador` —que importa
`GoogleAuth` por su cuenta para firmar contra la API REST de Cloud Tasks, sin
pasar por el `instanceof` del conector pero como tercer declarante del mismo
rango— resuelve al mismo archivo. **Si alguna de las dos aserciones se pone
roja:** alinea el rango de `google-auth-library` en `packages/db/package.json`
y en `packages/despertador/package.json` con el que exige
`@google-cloud/cloud-sql-connector` (revisa su `package.json`) y corre
`pnpm install` para que las tres vuelvan a resolver a una sola copia.

**Idioma.** Esquema y columnas en inglés `snake_case`. API de dominio, variables, comentarios, prompts y **todo texto que ve el usuario** en español.

**Los enumerados se hacen cumplir con `CHECK` en Postgres.** `text(col, { enum })` de Drizzle no genera restricción alguna.

**La tenencia se verifica dentro de cada escritura**, no confiando en una lectura previa: `WHERE id = ? AND organization_id = ?`, `.returning()`, y `permanente` si no vuelve fila. Hay doce claves foráneas compuestas que además lo exigen desde la base.

**Los modelos se leen del entorno**, nunca literales en código. Solo `@gc/ai` sabe que OpenRouter existe.

**Ninguna salida del modelo se parsea con expresiones regulares.** Toda tarea declara un esquema Zod y valida. Validar entrada de usuario con regex sí es válido.

**La capa web nunca ejecuta trabajo largo ni llama al modelo.** Generar es del CLI y del worker. La web lee, edita y aprueba.

**Proteger las páginas no protege las Server Actions.** Son endpoints HTTP con
identificador estable: cualquiera que lo conozca puede llamarlos sin pasar por
la página. La comprobación de sesión vive en el ayudante `ejecutar` de
`apps/web/src/acciones.ts`, por el que pasan las nueve acciones, no en los
componentes de servidor. Una acción que no use ese ayudante nace desprotegida.

**La configuración de Auth.js está partida en dos archivos, y quien edite uno
tiene que saber que el otro existe.** `apps/web/src/auth.config.ts` es la
mitad que el middleware puede cargar en el runtime Edge; `apps/web/src/auth.ts`
la extiende con el proveedor de Google y los callbacks completos, para todo lo
que sí corre en Node. Los dos quedan acoplados por el orden del spread con el
que `auth.ts` combina sus callbacks con los de `authConfig`: ese orden decide
cuál versión de cada callback compartido gana. El porqué de la partición —el
choque con el runtime Edge— está comentado en la cabecera de
`apps/web/src/auth.config.ts`; el detalle exacto del spread —qué versión de
cada callback compartido gana— está comentado en la cabecera de
`apps/web/src/auth.ts`. No se repiten aquí para no duplicar una línea de
código que se desactualizaría en silencio si alguien la reordena.

**El middleware necesita su propio callback `authorized`.** `NextAuth(authConfig)`
a secas no bloquea nada: `handleAuth` de Auth.js arranca con
`let authorized = true`, y sin ese callback deja pasar cualquier petición
aunque no haya sesión. El callback vive en `apps/web/src/auth.config.ts`,
compartido con `auth.ts` (ver arriba); `apps/web/src/middleware.ts` solo lo
consume, con `export const { auth: middleware } = NextAuth(authConfig)` — no
en la raíz del paquete, porque este proyecto usa `src/app`.

**Sacar a alguien de `CORREOS_PERMITIDOS` le quita la sesión de inmediato**,
porque el callback `jwt` revalida la lista en cada lectura, no solo al entrar.
El precio es que esa variable pasó a ser obligatoria en cada petición: un
despliegue con `CORREOS_PERMITIDOS` vacía por descuido no solo bloquea
entradas nuevas, también tumba las sesiones vivas. Falla cerrado, que es la
dirección correcta — pero hay que saber que esa es la dirección que toma.

**El error de una corrida que ejecutó el motor lo escribe el motor.** `ejecutarFlujo` la marca fallida antes de relanzar, con la clase del error delante (`[permanente] …`). Quien lo llame anota el fallo solo si nadie lo anotó ya — el worker lo hace con un `AND status <> 'fallido'` — porque sobrescribir ese mensaje pierde el diagnóstico bueno. Lo que sí hay que anotar es lo que falla **antes** de entrar al motor: ahí la corrida ya está `en_curso` y nadie más la sacaría de ese estado.

**`@gc/ai` es inalcanzable desde `apps/web`, y lo sostienen `tsc` y una
comprobación del grafo de dependencias — no el bundler.** Los flujos que llaman
al modelo viven en `@gc/flujos`, que la web no declara. La garantía se apoya en
tres piezas, y conviene saber exactamente qué hace cada una porque el reparto
no es el intuitivo:

1. **`tsc --noEmit` es lo que bloquea el import escrito a mano.** Un
   `import { ClienteOpenRouter } from '@gc/ai'` en `apps/web` falla con
   `TS2307: Cannot find module '@gc/ai'`, porque TypeScript resuelve como Node
   y `apps/web/node_modules/@gc` no tiene `ai`. Es una garantía de tipos.
2. **`pnpm comprobar:aislamiento` es lo que vigila el grafo.** Comprueba que ni
   `apps/web` ni ningún paquete de su cierre transitivo de dependencias de
   workspace pueda resolver `@gc/ai`, `@gc/pipeline` ni `@gc/flujos`. Atrapa la
   regresión que `tsc` no puede ver: si `@gc/operaciones` o `@gc/strategy`
   vuelven a declarar `@gc/ai` —incluso como `devDependency`, que pnpm
   materializa dentro del paquete y vuelve resoluble desde cualquier archivo
   suyo—, el import pasa a compilar y `tsc` calla.
3. **CI corre las dos en cada push** (`.github/workflows/ci.yml`). Sin eso la
   segunda es un script que alguien tiene que acordarse de ejecutar, y la fuga
   que vigila no rompe ni el build, ni el typecheck, ni las pruebas.

**Lo que NO la sostiene: la resolución de módulos del bundler.** El webpack de
Next resuelve `@gc/ai` desde `apps/web` perfectamente. Está comprobado: con un
import de `ClienteOpenRouter` en `apps/web/src/datos.ts` y
`typescript: { ignoreBuildErrors: true }` para aislar webpack de `tsc`, el
build compila y `https://openrouter.ai/api/v1/chat/completions` queda dentro de
`apps/web/.next/server/chunks/`. El motivo es que Next agrega
`node_modules/.pnpm/node_modules` a `resolve.modules` —el almacén plano de
pnpm, que tiene un enlace a **todos** los paquetes del workspace, los declare
quien los declare— porque Next mismo está instalado ahí dentro. Node nunca mira
ese directorio; webpack sí. Así que no es cierto que "sea un error de
resolución y no una revisión de código que puede pasarse": es un error de
compilación de tipos más una comprobación de grafo, las dos automatizadas.

Sigue alcanzando porque las dos regresiones posibles están cubiertas y las dos
corren solas: escribir el import lo para `tsc`, y volver a declarar la
dependencia lo para la comprobación de aislamiento. Lo que no hay es una
barrera que actúe si alguien apaga las dos a la vez.

```bash
pnpm comprobar:aislamiento
```

El script (`scripts/comprobar-aislamiento.mjs`) **deriva el conjunto auditado
del cierre transitivo de dependencias de workspace de `apps/web`**, recorriendo
los `package.json` desde ahí hacia abajo (hoy son seis: `@gc/brand`, `@gc/db`,
`@gc/despertador`, `@gc/operaciones`, `@gc/shared`, `@gc/strategy`). Antes lo leía de
`transpilePackages` en `next.config.ts`, y eso se podía achicar en silencio:
ese archivo documenta que su lista **no** controla la resolución, así que
quitar una entrada dejaba de auditar un paquete sin cambiar nada real. El
cierre de dependencias no se puede reducir sin cambiar el grafo de verdad.
Recorre `dependencies` y `devDependencies` por igual, porque pnpm materializa
las dos.

**No usa `import()`**: los paquetes del workspace son TypeScript sin compilar,
así que `import()` rechaza para todos con `ERR_UNKNOWN_FILE_EXTENSION` y un
`catch` genérico diría "no resuelve" hasta de los declarados —una comprobación
que no puede fallar. Por lo mismo lleva un **control positivo** desde
`packages/flujos`, donde `@gc/ai` y `@gc/pipeline` sí deben resolver, y una
guarda que falla si el cierre sale vacío. `pnpm --filter @gc/web why @gc/ai`
sirve para ver la cadena, pero no discrimina por sí solo: no recorre las
`devDependencies` de un paquete transitivo, que es justo por donde se coló el
agujero la primera vez.

Corolario: **el sembrador de pruebas de `@gc/operaciones` no arranca el motor.**
`src/pruebas/siembra.ts` inserta las filas de la grilla directamente; que P2
produzca esa forma lo verifica `p2.test.ts`, en `@gc/flujos`.

**Cada ruta de Next necesita su propio `export const dynamic = 'force-dynamic'`.** No se propaga entre árboles de rutas. Sin él la página se prerenderiza y congela sus datos en el build. Verificar en `pnpm --filter @gc/web build` que salga `ƒ` y no `○`.

**`--max-instances 1` en el servicio de Cloud Run del worker no es un ajuste de
rendimiento: es lo que sostiene que la columna de latido no haga falta.**
Decidir si una corrida está abandonada es hoy una aproximación por tiempo
—quince minutos sin señal, en `reanudarCorridaEncolada`— y esa aproximación
solo es segura mientras haya **un** worker: con varias instancias, una
corrida que un worker está ejecutando puede ser reanudada y tomada por otro,
y el modelo se paga dos veces. `--max-instances 1` junto con `--concurrency 1`
en el servicio, y `--max-concurrent-dispatches 1` en la cola de Cloud Tasks,
mantienen el sistema exactamente tan concurrente como cuando el worker era un
proceso local secuencial. **Subir cualquiera de los tres exige construir
antes la columna de arriendo** (`lease_until` en `pipeline_runs`), que sigue
anotada en `pendientes.md`.

## Arquitectura

```
@gc/shared      taxonomía de errores: transitorio | permanente | ambiguo
@gc/db          esquema Drizzle, 12 tablas, 7 migraciones
@gc/ai          única puerta a un modelo: ejecutarTarea, presupuesto, modo seco
@gc/pipeline    motor: reintentos, backoff, idempotencia por paso, reanudación
@gc/brand       perfiles de marca versionados
@gc/strategy    esquemas, validación, derivados, periodos, lectura de estrategia
@gc/flujos      flujos P1 (estrategia) y P2 (grilla): lo único que llama al modelo
@gc/operaciones operaciones que comparten CLI, web y worker
@gc/despertador avisa a Cloud Tasks que hay una corrida encolada, para que
                despierte al worker; en local no hace nada (el worker sondea solo)
apps/cli        comandos de operación
apps/web        Next.js App Router, Server Components, Server Actions, y
                autenticación con Auth.js v5 (Google + lista de correos
                permitidos, sin tabla de sesiones)
apps/worker     servidor HTTP con una sola ruta, `POST /trabajar`, que drena
                la cola de corridas pendientes. Es lo único que llama al
                modelo sin que se lo pidan. En producción (Cloud Run) lo
                despierta Cloud Tasks al encolar y Cloud Scheduler cada cinco
                minutos como red de seguridad; entre llamada y llamada la
                instancia se apaga sola. El sondeo por bucle —cada `SONDEO_MS`
                milisegundos— sobrevive solo en desarrollo local, donde no hay
                ni Cloud Tasks ni Cloud Scheduler
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

Windows. `corepack enable` falla por permisos: pnpm está instalado con `npm install -g pnpm@9`.

**Postgres vive en dos lugares con roles distintos.** En Docker para desarrollo
y pruebas locales — bases `gestor` (con datos de marcha en seco) y
`gestor_test`. En Cloud SQL para producción. **En local no se declara ninguna
variable de Cloud SQL**: sin `CLOUD_SQL_INSTANCIA`, `destinoDeConexion`
(`packages/db/src/destino.ts`) resuelve por `DATABASE_URL` y va a Docker — así
en tu máquina, en el CLI y en el worker de `docker compose`. Vercel y el
worker de Cloud Run sí declaran `CLOUD_SQL_INSTANCIA`, pero no la misma
cantidad de variables acompañantes: Vercel declara **cuatro**
(`CLOUD_SQL_USUARIO`, `CLOUD_SQL_CLAVE`, `CLOUD_SQL_BASE` y
`GOOGLE_CREDENCIALES_JSON`, porque ahí no hay identidad adherida); Cloud Run
declara **tres**, sin el JSON, porque `destinoDeConexion` detecta `K_SERVICE`
—la variable que Cloud Run define en toda revisión— y toma las credenciales
de la cuenta de servicio adherida al proceso en vez de pedir el JSON. Con
cualquiera de las dos, `crearConexion` (`packages/db/src/cliente.ts`) resuelve
contra Cloud SQL en vez de Docker.

**Las pruebas del arnés nunca pasan por `destinoDeConexion`**, así que la
frase anterior no las incluye a propósito — es la sexta corrección a una
afirmación falsa de esta rama. Casi todas reciben la conexión como argumento
(`crearConexionDePrueba`, en `packages/db/src/pruebas/entorno.ts`, lee
`DATABASE_URL_TEST` directamente). La única excepción es
`apps/web/src/acciones.test.ts`, que llama a las Server Actions de verdad y
por eso sí llega a `conexion()` (`apps/web/src/datos.ts`), que sí pasa por
`destinoDeConexion`: por eso ese archivo fija `process.env.DATABASE_URL =
process.env.DATABASE_URL_TEST` antes de importar las acciones. Si
`CLOUD_SQL_INSTANCIA` estuviera presente en el entorno de pruebas, esa
sustitución no bastaría —la instancia gana por precedencia— y esas pruebas
escribirían contra producción. Por eso `vitest.setup.ts` borra las cinco
variables de Cloud SQL del proceso apenas carga el `.env` (las cuatro
acompañantes más `GOOGLE_CREDENCIALES_JSON`, que comparten Cloud SQL y el
despertador porque es la misma cuenta de servicio), y por eso
`docker-compose.yml` fija `CLOUD_SQL_INSTANCIA: ""` en el bloque
`environment:` del worker, junto a `DATABASE_URL`: las dos neutralizan la
misma precedencia deliberada, cada una donde el `.env` la haría ganar.

**`vitest.setup.ts` borra seis variables más, por la misma simetría.** Son las
que configuran `@gc/despertador` (`CLOUD_TASKS_PROYECTO`, `CLOUD_TASKS_REGION`,
`CLOUD_TASKS_COLA`, `WORKER_URL`, `WORKER_CUENTA_DE_SERVICIO` y
`WORKER_TOKEN`): `.env.example` invita a cargarlas para depurar el camino de
la nube, y con las seis presentes cualquier prueba que llame a las Server
Actions que encolan —`encolarGrillaAccion` y sus dos hermanas, que llaman a
`despertarWorker`— crearía una tarea de verdad contra la cola de producción, y
esa tarea despertaría al worker real para que ejecute corridas de la base de
pruebas. Hoy ninguna prueba llega ahí, así que el riesgo es latente; deja de
serlo el día que alguien pruebe esas acciones. `WORKER_TOKEN` va en la lista
aunque sola no configure ningún destino del despertador (`destinoDelDespertador`
la trata aparte porque también es la que exige el worker local para arrancar):
borrarla mantiene el entorno de pruebas parejo con el de un clon nuevo. En
total son once variables borradas, no cinco.

**La app en Vercel llega a Cloud SQL por el conector de Node de Google
(`@google-cloud/cloud-sql-connector`), no por una cadena de conexión.** El
conector autoriza por IAM —la cuenta de servicio necesita el rol Cloud SQL
Client— y por eso la lista de redes autorizadas de la instancia queda
**vacía**. Esa lista vacía es la garantía del diseño, no un detalle de
configuración: significa que la base no está expuesta a internet por IP, y
que no hay ningún firewall que mantener sincronizado con las IPs de Vercel.
En Vercel las credenciales viajan como objeto —`GOOGLE_CREDENCIALES_JSON`, el
JSON de la cuenta de servicio en una variable de entorno— y no por
`GOOGLE_APPLICATION_CREDENTIALS`, que espera una ruta a archivo: en Vercel no
hay archivos que poner. **En Cloud Run no viaja ninguna credencial**: el
worker corre con la cuenta de servicio adherida al propio servicio, y
`GoogleAuth` la resuelve por el servidor de metadatos sin que ningún JSON
cruce la red (ver la regla no negociable de `google-auth-library`, arriba).

**`max: 5` en el pool (`packages/db/src/cliente.ts`) es bajo a propósito.**
Cada invocación de Vercel corre en su propio proceso y abre su propio pool,
así que el límite de conexiones de la instancia se reparte entre todas las
invocaciones que estén vivas a la vez.

**El caché de la conexión en `apps/web/src/datos.ts` no es una optimización:
es lo que hace pagable cada arranque en frío.** Medido en la prueba de humo
contra la instancia real desde Vercel: un proceso nuevo tarda ~1,6 s
(construir el conector, ~800 ms, más la primera consulta, ~760 ms); un
proceso ya tibio, ~123 ms. Perder el caché multiplica por trece el costo de
cada petición, y no es hipotético: de cinco llamadas seguidas en esa prueba,
una cayó en un proceso nuevo.

**Para aplicar migraciones hay dos caminos, y el que está verificado no es el
que parece.**

El **camino corto, y el único que se ha corrido de verdad**: el migrador
*programático* de Drizzle acepta una conexión ya hecha, así que se puede
migrar por `crearConexion()` —el mismo código que usa la app— sin binarios
extra y sin tocar la lista de redes autorizadas. Un script de veinte líneas
que importe `migrate` de `drizzle-orm/node-postgres/migrator` y
`crearConexion` de `@gc/db`, con las cinco variables de Cloud SQL en el
entorno, hace el trabajo. **Así se aplicaron las siete migraciones el
2026-08-05**, y quedó comprobado: 12 tablas, 12 claves foráneas compuestas,
9 restricciones `CHECK` y las tres columnas de autoría. Escribe el mismo
registro que `drizzle-kit` —`drizzle.__drizzle_migrations`— así que los dos
caminos son intercambiables.

Dos cosas que ese camino enseñó y conviene saber antes de repetirlo: hay que
correrlo con `tsx` **desde dentro del workspace** (un script suelto en otra
carpeta no resuelve `drizzle-orm` ni `@gc/db`), y el binario vive en
`apps/worker/node_modules/.bin/tsx`, no en la raíz. Y el **primer intento
falló** con `Connection terminated unexpectedly` justo después de encender la
instancia; el segundo, idéntico, funcionó. Es transitorio y es exactamente la
clase de error que `clasificarError` trata como reintentable: si te pasa,
reintenta antes de diagnosticar nada.

El **camino largo** —el Cloud SQL Auth Proxy— sigue siendo el que hace falta
si necesitas una consola `psql` contra la instancia, o cualquier herramienta
que no sea la app. **No se ha corrido de punta a punta**: el binario, sus
argumentos y los comandos de `gcloud` de abajo salen de la documentación de
Google, no de una prueba propia. Si algo no calza, no es necesariamente un
error tuyo.

**Ese camino largo exige el Cloud SQL Auth Proxy**,
porque `drizzle-kit` corre fuera de la app y no usa el conector de Node —lo
mismo que arma `crearConexion` no está disponible ahí—. El Auth Proxy es un
binario aparte que levanta un escucha en `localhost`, tuneliza hacia la
instancia autenticando por IAM, y deja que cualquier cliente Postgres normal
—incluido `drizzle-kit`— se conecte como si la base estuviera en la máquina.
Es una operación que se hace pocas veces y siempre con prisa, así que:

0. **Enciende la instancia.** Cloud SQL no se despierta sola, y el Auth Proxy
   contra una instancia apagada falla de un modo que no menciona que está
   apagada — lleva a diagnosticar IAM, puertos o red antes de sospechar de
   esto:
   ```
   gcloud sql instances patch gestor-contenido --project gestor-contenido-ctp --activation-policy=ALWAYS
   ```
   Espera a que quede lista antes de seguir (`gcloud sql instances describe
   gestor-contenido --project gestor-contenido-ctp --format="value(state)"`
   tiene que decir `RUNNABLE`).
1. Descarga el binario del Cloud SQL Auth Proxy v2 (`cloud-sql-proxy.exe` en
   Windows) desde la página de releases de `GoogleCloudPlatform/cloud-sql-proxy`
   en GitHub, o desde la documentación de Cloud SQL de Google — **no el binario
   viejo `cloud_sql_proxy`, con guion bajo, que es la v1**.
2. Levántalo apuntando al nombre de conexión de la instancia, en un puerto
   local que no choque con el Postgres de Docker (que ya ocupa 5432):
   ```
   .\cloud-sql-proxy.exe --port 5433 gestor-contenido-ctp:southamerica-east1:gestor-contenido
   ```
   Autentica con tus credenciales de `gcloud` (Application Default
   Credentials) — corre `gcloud auth application-default login` antes si no
   las tienes configuradas, y necesitas el rol `roles/cloudsql.client` sobre
   el proyecto.
3. Queda escuchando en `localhost:5433`, tunelizando hacia la instancia.
4. **Mientras dure la operación**, apunta `DATABASE_URL` (en el `.env` de la
   raíz) a ese puerto: `postgres://gestor:<clave>@localhost:5433/gestor`.
5. Aplica las migraciones con el script real —confirmado en
   `packages/db/package.json`— `pnpm --filter @gc/db migraciones:aplicar`,
   que ejecuta `drizzle-kit migrate`.
6. **Devuelve `DATABASE_URL` a `postgres://postgres:postgres@localhost:5432/gestor`
   al terminar.** Este paso no es adorno: con el Auth Proxy corriendo y
   `DATABASE_URL` sin restaurar, `pnpm --filter @gc/web dev` y el CLI
   trabajarían contra la base de producción sin que nada lo avise — los dos
   resuelven la conexión con `crearConexion()` sin argumentos, que lee
   `DATABASE_URL` del entorno (`destinoDeConexion`, en
   `packages/db/src/destino.ts`). El worker corre el mismo riesgo **solo si lo
   levantas en el host**: dentro de `docker compose` no le pasa nada, porque
   `DATABASE_URL` queda fijada en el bloque `environment:` de
   `docker-compose.yml`, que gana sobre el `env_file:` y apunta siempre al
   Postgres de Docker. `pnpm test` tampoco corre este riesgo: la suite conecta
   por `DATABASE_URL_TEST` (`packages/db/src/pruebas/entorno.ts`), una
   variable distinta, y `apps/web/src/acciones.test.ts` fija `DATABASE_URL` a
   su valor explícitamente antes de que nada la lea. Es el accidente que este
   procedimiento hace fácil, para lo que sí queda expuesto, si se salta este
   paso.
7. **Apaga la instancia cuando termines**, para no dejarla facturando sin que
   nadie la use:
   ```
   gcloud sql instances patch gestor-contenido --project gestor-contenido-ctp --activation-policy=NEVER
   ```

La base de desarrollo tiene la marca `parcelas` con perfil cargado, estrategia `2026-Q3` y la grilla de `2026-09` en borrador. **Si una verificación manual la modifica, restáurala.**

**Hay dos Dockerfiles del worker, con propósitos distintos, y confundirlos
lleva a pensar que un cambio no necesita desplegarse cuando sí.**
`apps/worker/Dockerfile` es la imagen de desarrollo, la que arma
`docker compose`: monta el repositorio como volumen en `/app` y corre con
`tsx` sin compilar nada, así que **en local un cambio en `apps/worker` o en
cualquier paquete solo pide `docker compose restart worker`, no reconstruir la
imagen** — son unos siete segundos hasta que el worker vuelve a escuchar, y
reconstruir (`docker compose build worker`) hace falta solo si cambia ese
`Dockerfile`. `apps/worker/Dockerfile.produccion` es otra cosa: la imagen que
corre en Cloud Run, que copia el workspace completo adentro porque ahí no hay
nada que montar. **Un cambio en `apps/worker` o en cualquier paquete del
workspace sí exige una imagen nueva en producción** — lo que localmente basta
con reiniciar, en la nube exige reconstruir y volver a desplegar. Eso lo hace
CI solo, en cada push verde a `master` (ver la sección de despliegue más
abajo); no hace falta acordarse de hacerlo a mano.

Sus `node_modules` no son los del host: pnpm en Windows deja enlaces con rutas
absolutas y binarios de otra plataforma, así que el contenedor tiene los suyos
en **volúmenes con nombre** —uno por paquete del workspace, más el almacén de
pnpm— y los instala al arrancar. Con nombre y no anónimos a propósito: los
anónimos no se los lleva `docker compose down`, solo `down -v`, que **también
borra `pgdata`** y con él la base de desarrollo que hay que preservar. O sea
que con volúmenes anónimos no existía limpieza segura. Los mantiene completos
`pnpm comprobar:volumenes`, que corre en CI.

Medido el 2026-08-04, con la imagen ya construida: `docker compose up -d`
tarda unos 14 segundos con los volúmenes vacíos —de los cuales 7 son el
`pnpm install`, 230 paquetes descargados— y unos 7 con los volúmenes tibios.
Construir la imagen desde cero suma otros 4. (El comentario de
`docker-compose.yml` decía «unos dos minutos en el primer arranque de un clon
nuevo»; no reproduce, y quedó corregido allá.)

**Una dependencia nueva NO la instala sola `docker compose restart worker`.**
El `command` corre `pnpm install --frozen-lockfile`, que aborta con
`ERR_PNPM_OUTDATED_LOCKFILE` en cuanto el `package.json` y el `pnpm-lock.yaml`
no concuerdan. El orden que funciona es: agregar la dependencia, `pnpm install`
en el host —que actualiza el lockfile—, y recién ahí `docker compose restart
worker`.

El worker de `docker compose` publica su ruta HTTP en el host, para poder
golpearla a mano mientras se desarrolla: `curl -X POST -H "x-token-worker:
local" http://localhost:8090/trabajar`. El puerto es **8090 y no 8080** a
propósito —en la máquina de este proyecto el 8080 del host ya está ocupado de
forma permanente por un contenedor de otro proyecto—, pero adentro del
contenedor sigue siendo 8080, que es lo que Cloud Run espera y el valor por
omisión que lee el worker (`PORT` en `main.ts`); no lo cambies de vuelta. No
hace falta este `curl` para que el worker local funcione: el sondeo
(`SONDEO_MS`, fijado en `2000` por `docker-compose.yml`) lo hace solo.

### Cómo se despliega y se opera el worker en Cloud Run

**El despliegue es automático en cada push verde a `master`**, sin filtro de
rutas: el trabajo `desplegar-worker` de `.github/workflows/ci.yml` corre
después de `test` (con `needs: test`, para no desplegar algo que no pasó las
pruebas), construye la imagen con `apps/worker/Dockerfile.produccion` —no el
`Dockerfile` de al lado, ver arriba— y la empuja con dos etiquetas al
repositorio `southamerica-east1-docker.pkg.dev/gestor-contenido-ctp/gestor`:
el SHA del commit, para poder volver a una revisión concreta, y `latest`. No
hay filtro de rutas a propósito: un cambio en cualquier paquete del workspace
puede afectar al worker, y una lista de rutas mantenida a mano es una forma
conocida de equivocarse en eso.

**El despliegue pasa solo la imagen.** El paso final es
`gcloud run deploy worker --image ...`, sin `--set-env-vars` ni ninguna otra
bandera de configuración: las variables de entorno, los secretos, la cuenta de
servicio y los límites de instancias (`--max-instances 1`, `--concurrency 1`,
ver la regla no negociable) los fijó la creación del servicio, y el workflow
no los toca. Un `--set-env-vars` ahí pisaría, entre otras cosas, el token
compartido y la contraseña de la base.

**El token compartido, `WORKER_TOKEN`, vive en dos lados y tiene que valer lo
mismo en los dos**: el servicio de Cloud Run —que lo exige en la cabecera
`x-token-worker` de `POST /trabajar`— y Vercel —que lo manda al crear la tarea
de Cloud Tasks, desde `@gc/despertador`—. Cambiarlo en un lado sin el otro
deja al despertador creando tareas que el worker rechaza con 401; el síntoma
es silencioso desde la web, porque `despertarWorker` traga sus errores y
confía en que la red de seguridad los cubra, así que el único aviso es que
generar empieza a tardar los cinco minutos del intervalo de Cloud Scheduler
en vez de los segundos de siempre.

Para ver qué revisión está sirviendo:

```
gcloud run services describe worker --region southamerica-east1 --project gestor-contenido-ctp --format="value(spec.template.spec.containers[0].image)"
```

La etiqueta de la imagen debería terminar en el SHA del último commit de
`master`.

Para leer los logs:

```
gcloud run services logs read worker --region southamerica-east1 --project gestor-contenido-ctp --limit 50
```

Los datos concretos de la infraestructura: proyecto `gestor-contenido-ctp`,
región `southamerica-east1`, servicio de Cloud Run `worker`, cola de Cloud
Tasks `generaciones`, trabajo de Cloud Scheduler `despertar-worker` —corre
cada cinco minutos, `*/5 * * * *`, la red de seguridad que toma lo que
`@gc/despertador` no haya podido avisar—, y repositorio de imágenes
`southamerica-east1-docker.pkg.dev/gestor-contenido-ctp/gestor`. Cuánto atiende
un turno del worker lo acotan `LIMITE_POR_PETICION` (diez corridas,
`apps/worker/src/drenar.ts`) y `PRESUPUESTO_MS` (900 s), calculados contra el
`--timeout 1200` del servicio: sin esos dos topes, una cola larga se atendería
entera dentro de una sola petición HTTP y el corte de Cloud Run llegaría a
mitad de una generación.

Tres cosas que se aprendieron operando esto, y que le ahorran tiempo a la
próxima persona:

1. **`gcloud secrets versions add --data-file=-` NO funciona en PowerShell.**
   `Ctrl+D` no cierra la entrada, y el comando sale **sin guardar nada y en
   silencio**. El camino que sirve es un archivo temporal, escrito con
   `[System.IO.File]::WriteAllText` y **no** con `echo`, porque `echo` agrega
   un salto de línea que viajaría dentro de la clave hasta la cabecera de
   autorización.
2. **El frontend de Google devuelve `411 Length Required` a un `POST` sin
   `Content-Length`.** Afecta a un `curl` armado a mano contra el worker;
   Cloud Scheduler sí lo manda bien.
3. **El puerto 8080 del host está ocupado de forma permanente** en la máquina
   de este proyecto por un contenedor de otro proyecto, y por eso
   `docker-compose.yml` publica el worker en **8090** (ver arriba).

**Con la base en Cloud SQL, el costo de tenerla encendida no depende de que
el worker esté escuchando: depende de que la instancia lo esté.** Con Neon,
el plan gratuito suspendía la base sola cuando nadie la consultaba, y era el
sondeo del worker —cada dos segundos— el que la mantenía despierta las 730
horas del mes sin que nadie usara el sistema. Cloud SQL no tiene ese
mecanismo: **no se apaga sola, y una instancia encendida se factura
corriendo, la use alguien o no.** Ese sondeo, además, ya no corre en
producción: el worker vive en Cloud Run, escala a cero entre llamada y
llamada, y `SONDEO_MS` —lo que lo sustituye— **solo se declara en desarrollo
local**, donde no hay ni Cloud Tasks ni Cloud Scheduler que avisen.

Que algo encienda y apague la instancia de Cloud SQL sola, para no pagarla
mientras nadie genera contenido, se evaluó en el mismo bloque 1C-B y se
**descartó**, con motivo escrito en
`docs/superpowers/specs/2026-08-06-worker-en-la-nube-design.md`: una instancia
apagada no solo detiene al worker, **deja la app web muerta** —cada página de
`https://marketing-ai-web.vercel.app` lee la base en cada petición, así que
respondería 500 a todo mientras la instancia esté abajo—, y lo que se ahorra
es menor de lo que parece, porque el disco se factura igual que la instancia
esté prendida o apagada: sobre una `db-f1-micro`, apagarla doce horas al día
ahorra del orden de la mitad de la parte de cómputo, unos pocos dólares al
mes. El sustituto es una **alerta de presupuesto** en Google Cloud: avisa
cuando el gasto se sale de lo esperado —el problema real, una factura que
crece sin que nadie mire— sin apagar nada. Detener la instancia a mano sigue
siendo una opción razonable si nadie va a generar contenido por un buen rato,
pero ya no es trabajo pendiente de este bloque: es una decisión operativa de
cada momento, no algo que 1C-B haya dejado a medio construir.
