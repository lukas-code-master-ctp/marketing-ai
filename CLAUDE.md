# Gestor de contenido multimarca

Sistema que automatiza la creación y publicación de contenido en redes para tres startups, cada una con su propio branding. Orquestado por IA vía OpenRouter.

**Estado: motor completo y app web local.** Genera estrategia trimestral y grilla mensual, y las revisas y apruebas en el navegador. Esta rama agrega lo que hace falta para desplegarla —base en Cloud SQL, autenticación con Google— y deja preparado el terreno para alojarla en Vercel, aunque eso último se configura en su interfaz y no agrega código a la rama. El despliegue en sí todavía no ocurrió: hubo una prueba de humo contra la instancia real que confirmó que el conector funciona desde Vercel, pero el proyecto de esa prueba era desechable y se borró. Publicar en redes es Fase 3 y no existe todavía.

## Documentos que mandan

| Documento | Qué contiene |
|---|---|
| [Diseño general](docs/superpowers/specs/2026-07-31-gestor-contenido-multimarca-design.md) | Arquitectura de las cuatro fases, y la realidad de cada API de red social |
| [pendientes.md](docs/superpowers/specs/pendientes.md) | **Léelo antes de planificar nada.** Deuda registrada, decisiones tomadas, y lo que se descartó a propósito |

Cada bloque de trabajo tiene su spec y su plan en `docs/superpowers/`. Los planes son el registro de por qué el código es como es.

## Comandos

```bash
docker compose up -d postgres # la base. Sin esto fallan seis paquetes
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

El worker construye el cliente del modelo al arrancar, así que no levanta sin
`OPENROUTER_API_KEY` o sin `IA_EN_SECO=true`. Es a propósito: prefiere no
arrancar antes que arrancar sano y marcar fallida toda la cola. **Esto vale
también dentro de `docker compose`**: con el `.env` tal como está hoy —clave
vacía y `IA_EN_SECO=false`— el contenedor `worker` arranca, falla con
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
`crearConexion` (`packages/db/src/cliente.ts`) arma un `GoogleAuth` con las
credenciales de la cuenta de servicio y se lo entrega al `Connector` de
`@google-cloud/cloud-sql-connector` por su opción `auth`. Adentro, el
`sqladmin-fetcher` del conector decide si usa esas credenciales con
`loginAuth instanceof GoogleAuth` — y esa comparación solo da cierto si
`google-auth-library` resuelve, para `@gc/db` y para el conector, al **mismo
archivo**. Si pnpm instala dos copias —porque el rango que declara el
conector deja de coincidir con el que declara `packages/db/package.json`—,
el objeto cae por la rama equivocada y la petición sale **sin
credenciales**: un `401 Login Required` que no menciona versiones ni copias.
Ya mordió una vez, en la prueba de humo contra la instancia real. Ni
`pnpm test` ni `pnpm -r typecheck` ven qué copia resuelve cada paquete, así
que lo vigila `packages/db/src/resolucion-google-auth-library.test.ts`, que
afirma con `require.resolve` en vez de confiar en que los rangos declarados
coincidan. **Si esa prueba se pone roja:** alinea el rango de
`google-auth-library` en `packages/db/package.json` con el que exige
`@google-cloud/cloud-sql-connector` (revisa su `package.json`) y corre
`pnpm install` para que las dos vuelvan a resolver a una sola copia.

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
los `package.json` desde ahí hacia abajo (hoy son cinco: `@gc/brand`, `@gc/db`,
`@gc/operaciones`, `@gc/shared`, `@gc/strategy`). Antes lo leía de
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
apps/cli        comandos de operación
apps/web        Next.js App Router, Server Components, Server Actions, y
                autenticación con Auth.js v5 (Google + lista de correos
                permitidos, sin tabla de sesiones)
apps/worker     toma corridas pendientes y las ejecuta. Lo único que llama al modelo sin que se lo pidan
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
en tu máquina, en el CLI, en el worker y en las pruebas. Vercel sí declara
`CLOUD_SQL_INSTANCIA` y sus cuatro variables acompañantes, y con eso
`crearConexion` (`packages/db/src/cliente.ts`) resuelve contra Cloud SQL en
vez de Docker.

**La app en Vercel llega a Cloud SQL por el conector de Node de Google
(`@google-cloud/cloud-sql-connector`), no por una cadena de conexión.** El
conector autoriza por IAM —la cuenta de servicio necesita el rol Cloud SQL
Client— y por eso la lista de redes autorizadas de la instancia queda
**vacía**. Esa lista vacía es la garantía del diseño, no un detalle de
configuración: significa que la base no está expuesta a internet por IP, y
que no hay ningún firewall que mantener sincronizado con las IPs de Vercel.
Las credenciales viajan como objeto —`GOOGLE_CREDENCIALES_JSON`, el JSON de
la cuenta de servicio en una variable de entorno— y no por
`GOOGLE_APPLICATION_CREDENTIALS`, que espera una ruta a archivo: en Vercel no
hay archivos que poner.

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

**Aplicar una migración contra Cloud SQL exige el Cloud SQL Auth Proxy**,
porque `drizzle-kit` corre fuera de la app y no usa el conector de Node —lo
mismo que arma `crearConexion` no está disponible ahí—. El Auth Proxy es un
binario aparte que levanta un escucha en `localhost`, tuneliza hacia la
instancia autenticando por IAM, y deja que cualquier cliente Postgres normal
—incluido `drizzle-kit`— se conecte como si la base estuviera en la máquina.
Es una operación que se hace pocas veces y siempre con prisa, así que:

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
   `DATABASE_URL` sin restaurar, cualquier comando de desarrollo —`pnpm
   --filter @gc/web dev`, el CLI, el worker, `pnpm test`, porque el `.env` es
   uno solo para todo— trabajaría contra la base de producción sin que nada
   lo avise. Es el accidente que este procedimiento hace fácil si se salta
   este paso.

La base de desarrollo tiene la marca `parcelas` con perfil cargado, estrategia `2026-Q3` y la grilla de `2026-09` en borrador. **Si una verificación manual la modifica, restáurala.**

El worker corre en un contenedor con el repositorio montado en `/app`, y se
ejecuta con `tsx` sin compilar nada: **un cambio en `apps/worker` o en
cualquier paquete solo pide `docker compose restart worker`, no reconstruir la
imagen.** Son unos siete segundos hasta que el worker vuelve a escuchar.
Reconstruir (`docker compose build worker`) hace falta solo si cambia el
`Dockerfile`.

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

**Con la base en Cloud SQL, el costo ya no depende de que el worker esté
encendido: depende de que la instancia lo esté.** Con Neon, el plan gratuito
suspendía la base sola cuando nadie la consultaba, y era el sondeo del worker
—cada dos segundos— el que la mantenía despierta las 730 horas del mes sin
que nadie usara el sistema. Cloud SQL no tiene ese mecanismo: **no se apaga
sola, y una instancia encendida se factura corriendo, la use alguien o no.**
El sondeo del worker ya no mueve esa factura para nada. Lo que sí hay que
hacer es detener la instancia cuando nadie vaya a generar contenido y
encenderla antes de la próxima vez — es exactamente por lo que la instancia
de `gestor-contenido-ctp` está detenida ahora mismo. Que algo la encienda y
apague solo, en vez de hacerlo a mano, sigue siendo trabajo pendiente (ver
`pendientes.md`), del mismo bloque 1C-B que se lleva al worker fuera de una
máquina local.
