# Despliegue y autenticación (bloque 1C-A) — Diseño

**Fecha:** 2026-08-04
**Estado:** Aprobado para planificación
**Alcance:** la base sale a Neon, la web sale a Vercel, y entra autenticación con Google para dos o tres personas. Una migración.
**No incluye:** el worker en la nube, la agenda mensual, ni publicar en redes.

---

## 1. Por qué, y por qué solo esto

El sistema funciona y se opera entero desde el navegador, pero ese navegador tiene que estar en la máquina donde corre Postgres. Revisar la grilla del mes exige estar sentado frente al computador de siempre.

Este bloque cierra eso: **la base y la app salen de tu máquina, y entran personas con cuenta.**

Lo que se quiere de verdad son tres cosas, y este bloque es la primera:

| | Qué entrega | Estado |
|---|---|---|
| **A** | Revisas y apruebas desde cualquier parte, con cuentas | Este documento |
| B | Generas sin que tu PC exista | Pendiente |
| C | La grilla del mes se genera sola | Pendiente |

Se separan porque **B tiene decisiones que se toman mucho mejor con A ya andando**. Cuánto tarda de verdad una generación contra una base remota decide si el worker puede ser una función que se despierta o tiene que ser un proceso encendido, y eso no se adivina. Y C no rinde hasta que B sea confiable: una agenda que falla a las tres de la mañana y no avisa es peor que no tener agenda.

---

## 2. Decisiones tomadas

| Decisión | Elección | Razón |
|---|---|---|
| Dónde vive la base | **Neon** | Postgres 16 real, plan gratuito suficiente, y agrupador de conexiones que Vercel necesita por diseño |
| Dónde vive la app | **Vercel** | Es el destino natural de Next.js y ya lo suponía el diseño general. Ver §3 sobre el monorepo |
| Cómo entran las personas | **Google, vía Auth.js** | El sistema no custodia ninguna credencial |
| Quién puede entrar | **Lista de correos en una variable de entorno** | Para tres personas, una pantalla de administración es trabajo sin usuarios |
| Sesión | **Cookie firmada, sin tabla de sesiones** | Menos estado que mantener y menos consultas por petición |
| Autoría | **Aprobar, reabrir y guardar perfil** | Son los actos con consecuencia; el resto se agrega después sin desarmar nada |

---

## 3. La base en Neon

### Por qué Neon y no Cloud SQL

El diseño general decía Cloud SQL, pero se escribió pensando en el sistema completo con publicación, donde ya estarías en Google Cloud por los secretos de Meta y LinkedIn. Hoy no lo estás.

Cloud SQL cuesta unos diez dólares mensuales de piso, está siempre encendido, y para alcanzarlo desde Vercel hay que exponerlo con IP pública y SSL o montar un proxy. Neon es Postgres de verdad —no un derivado con dialecto propio—, tiene plan gratuito, y su agrupador resuelve el problema que Vercel tiene por construcción.

### El problema que Vercel tiene por construcción

Cada invocación de una función serverless es un proceso nuevo que abre su propia conexión. Con suficiente tráfico, Postgres se queda sin cupo.

Hoy `apps/web/src/datos.ts` cachea el pool en `globalThis`, con un comentario que explica que es el modismo estándar para sobrevivir a la reejecución de módulos en desarrollo. Eso sigue siendo cierto en un servidor que vive; en Vercel el proceso no vive, así que la caché no ayuda.

**La solución es la cadena de conexión agrupada de Neon**, que apunta a un PgBouncer en modo transacción.

**Y esto obliga a un cambio concreto en el código:** `packages/db/src/cliente.ts` usa `postgres-js`, que emplea sentencias preparadas por omisión, y PgBouncer en modo transacción no las soporta. `crearConexion` pasa a aceptar `prepare: false` cuando la URL apunta al agrupador. Es una línea, pero sin ella la app falla en producción con un error que no dice nada útil y que en local nunca aparece.

### Vercel y un monorepo de pnpm

No se llevan solos. Vercel supone un proyecto en la raíz del repositorio, y aquí la app vive en `apps/web` y depende de cinco paquetes del workspace que se distribuyen como TypeScript sin compilar.

Hay que configurar tres cosas en el proyecto de Vercel: el directorio raíz apuntando a `apps/web`, el comando de instalación corriendo `pnpm install` desde la raíz del repositorio para que el workspace se resuelva, y que el build no ignore los cambios en `packages/`. La última es la que muerde en silencio: sin ella, tocar `@gc/operaciones` no dispara despliegue y la app queda servida con una versión vieja de un paquete, sin ningún error.

`transpilePackages` de `next.config.ts` ya está resuelto desde el bloque anterior y no cambia.

### Dos bases, no una

`gestor` en local sigue existiendo, y sigue siendo donde se desarrolla y se corren las pruebas. Neon es producción.

Esto no es duplicación: es que `DATABASE_URL` apunta a una u otra según dónde corras. La regla del `.env` único no cambia — Vercel tiene sus propias variables de entorno, que son otra cosa y viven en otro lado.

### Las migraciones

Se aplican desde tu máquina contra Neon con el mismo mecanismo de hoy, apuntando `DATABASE_URL` a la cadena **directa** (no la agrupada: las migraciones usan sentencias que PgBouncer en modo transacción no maneja bien).

No entra automatización de migraciones en el despliegue. Con una persona aplicándolas a mano y seis migraciones en toda la historia del proyecto, un paso automático en CI es maquinaria para un problema que no existe — y el día que falle a mitad, es peor que hacerlo a mano.

### Lo que NO se lleva

La base de desarrollo tiene la marca `parcelas` con datos de marcha en seco. **Neon nace vacía.** La primera marca de producción se crea desde la web, que es justamente lo que el bloque anterior construyó.

### El costo escondido del worker local

Con la base remota, el worker que sigue corriendo en tu máquina la sondea cada dos segundos.

El plan gratuito de Neon da unas 190 horas de cómputo al mes y suspende la base cuando nadie la consulta. **Un sondeo cada dos segundos la mantiene despierta las 730 horas del mes**, así que el plan gratuito se agota solo, sin que nadie esté usando el sistema.

La salida en este bloque es operativa y hay que escribirla donde se lea: **el worker se levanta cuando vas a generar y se baja cuando terminas.** `docker compose up -d postgres` deja de ser la costumbre y pasa a ser lo correcto; el worker se levanta aparte.

Esto convierte la decisión del bloque B —sondear o que la web lo despierte— en una que tiene precio, no solo elegancia. Queda registrado como el insumo principal de ese bloque.

---

## 4. La autenticación

### Qué se usa

**Auth.js v5** (`next-auth@5`) con el proveedor de Google. La versión importa: v5 es la que está hecha para el App Router y expone `auth()` como función que se llama desde un Server Component o desde una Server Action, que es exactamente lo que este diseño necesita. La v4 tiene otra API y no encaja.

Resuelve las tres cosas que uno hace mal al escribirlas a mano: el intercambio del código de OAuth, el parámetro `state` contra CSRF, y la firma de la sesión.

La sesión va en una **cookie firmada**, sin tabla de sesiones: menos estado y ninguna consulta extra por petición.

### Quién puede entrar

Una variable de entorno con los correos permitidos, separados por coma. El `callback` de inicio de sesión rechaza cualquier otro.

No hay pantalla de administración, ni invitaciones, ni roles. Para tres personas eso sería construir gestión de usuarios sin usuarios que gestionar. Agregar a alguien es editar una variable en Vercel.

**El rechazo tiene que ser explícito y legible**: quien entre con un correo no autorizado ve una pantalla que dice que no está en la lista, no un error genérico ni un bucle de redirección.

### La tabla `users`

Una tabla mínima —`id`, `email`, `name`, `created_at`— que se llena sola en el primer inicio de sesión exitoso, con un `upsert` por correo.

Existe por una razón concreta: las tres columnas de autoría necesitan a qué apuntar con una clave foránea de verdad. Guardar el correo suelto en cada fila deja autoría huérfana en cuanto alguien cambie de dirección, y este proyecto tiene por regla que las relaciones se hacen exigibles desde la base.

**No lleva `organization_id`.** Hoy hay una sola organización y las tres personas la comparten. Atar usuarios a organizaciones es el diseño que hace falta cuando haya equipos distintos por marca, que es explícitamente lo que este bloque descartó.

### La autoría

**Una sola migración** trae la tabla `users` y las tres columnas. Van juntas porque las columnas son claves foráneas a esa tabla: separarlas dejaría una migración intermedia que no aplica sola.

Tres columnas nuevas, todas nulas para las filas que ya existen:

| Tabla | Columna | Qué registra |
|---|---|---|
| `content_plans` | `approved_by` | Quién aprobó la grilla |
| `content_plans` | `reopened_by` | Quién la devolvió a borrador |
| `brand_profiles` | `created_by` | Quién guardó esa versión del perfil |

Las tres son claves foráneas a `users` con `ON DELETE SET NULL`: borrar una persona no debe borrar la historia de lo que aprobó.

`aprobarGrilla`, `reabrirGrilla` y `guardarPerfil` pasan a recibir el usuario. **Va como parámetro explícito, no leído del contexto dentro de la operación**: `@gc/operaciones` no sabe que existe una sesión web, y el CLI y el worker llaman a las mismas funciones sin ninguna. El parámetro es opcional y `null` significa "lo hizo el sistema", que es exactamente lo que pasa cuando el motor persiste.

---

## 5. La parte más fácil de hacer mal

**Proteger las páginas no protege las Server Actions.**

Una Server Action de Next es un endpoint HTTP con un identificador estable. Cualquiera que lo conozca puede llamarlo directamente, sin pasar nunca por la página que lo renderiza. Si la comprobación de sesión vive solo en el componente de servidor, las nueve acciones de esta app quedan abiertas a internet.

Por eso la comprobación va **dentro de cada acción**, no encima. Y no como una línea que hay que acordarse de escribir: el ayudante `ejecutar` de `apps/web/src/acciones.ts` —por el que ya pasan las nueve— resuelve la sesión y rechaza si no hay. Una acción nueva que use el ayudante queda protegida por construcción; una que no lo use es visible en revisión.

Hay una segunda mitad: el `middleware` de Next protege las rutas de páginas, para que nadie vea datos sin entrar. Las dos capas hacen falta y ninguna reemplaza a la otra.

**Esto necesita una prueba que lo afirme**, y es la prueba más importante del bloque: que una acción llamada sin sesión sea rechazada, medido en que la escritura no ocurrió. Este proyecto ya aprendió que una garantía sin prueba que pueda fallar no es una garantía.

---

## 6. El desarrollo local

Exigir Google para levantar la app en local sería fricción diaria por ninguna seguridad: la base local no tiene nada que proteger.

**En desarrollo hay una sesión de mentira**, activada por una variable de entorno, con un correo fijo que se inserta en `users` como cualquier otro. Así el camino de autoría se ejercita en local en vez de existir solo en producción — que es donde nadie lo prueba hasta que falla.

La condición se escribe de modo que **no pueda quedar encendida en producción**: la variable se ignora si el entorno no es de desarrollo. Una puerta trasera que depende de recordar apagarla no es una puerta trasera de desarrollo, es un agujero.

**Para que eso sea comprobable, la decisión vive en una función pura** que recibe el entorno y devuelve si corresponde la sesión de mentira — no en un `if` que lee `process.env` desde dentro. Un `if` así no se puede probar sin ensuciar el entorno del proceso de pruebas; una función que recibe sus datos sí, y con eso la prueba de que en producción no se activa es de tres líneas.

---

## 7. Los secretos

| Variable | Dónde vive | Para qué |
|---|---|---|
| `DATABASE_URL` | Vercel (agrupada) y tu `.env` (local) | La base |
| `AUTH_SECRET` | Vercel | Firma la cookie de sesión |
| `AUTH_GOOGLE_ID` / `AUTH_GOOGLE_SECRET` | Vercel | La app de OAuth |
| `CORREOS_PERMITIDOS` | Vercel | Quién puede entrar |
| `OPENROUTER_API_KEY` y los modelos | Tu `.env` | Solo el worker los necesita, y el worker sigue local |

**La clave de OpenRouter no va a Vercel.** La web nunca llama al modelo — es la regla estructural del proyecto y hay dos comprobaciones automáticas que la sostienen. Poner la clave donde no se usa es superficie regalada.

---

## 8. Pruebas

Lo que hay que afirmar y hoy nadie afirma:

- **Que una Server Action sin sesión no escriba.** La más importante del bloque. Medida en la base, no en el valor devuelto.
- **Que un correo fuera de la lista no pueda entrar**, y que el rechazo sea el mensaje legible y no un error genérico.
- **Que la sesión de mentira no funcione fuera de desarrollo.**
- **Que la autoría quede registrada**: aprobar con un usuario deja su `id` en la fila, y aprobar sin usuario deja `null` en vez de fallar.
- **Que `users` se llene sola** en el primer inicio de sesión y no se duplique en el segundo.

Y las tres comprobaciones obligatorias de siempre: `pnpm test`, `pnpm -r typecheck`, y `pnpm --filter @gc/web build` verificando que las rutas del dominio sigan saliendo con `ƒ`.

**Cada prueba se rompe a propósito antes de darse por buena.** En la rama anterior aparecieron tres pruebas cuyo nombre prometía una mitad que ninguna aserción respaldaba, y todas estaban verdes.

---

## 9. Riesgos

**La protección de las Server Actions es el riesgo real del bloque.** Es el único defecto posible que expone datos a internet, y es fácil de creer resuelto mirando que la página redirige. La mitigación es que la comprobación viva en el ayudante compartido y que haya una prueba que la afirme sin sesión.

**El agrupador de conexiones falla distinto de como falla en local.** Las sentencias preparadas rompen contra PgBouncer en modo transacción, y el síntoma aparece recién en producción, bajo carga, con un mensaje poco claro. Hay que probar contra Neon antes de dar el bloque por terminado, no solo contra Postgres local.

**El plan gratuito de Neon se agota solo si el worker queda encendido.** Está escrito arriba y va también a `CLAUDE.md`, porque es la clase de cosa que se descubre cuando la base deja de responder.

**Este bloque introduce dependencia de dos servicios externos.** Si Neon o Vercel tienen un mal día, el sistema no está. Es el precio de no tenerlo en tu máquina, y es aceptable para una herramienta de trabajo interna — pero conviene decirlo en vez de descubrirlo.

---

## 10. Siguiente paso

Plan de implementación. Los bloques B (worker en la nube) y C (agenda mensual) conservan su propio ciclo de spec, plan e implementación, y heredan de aquí la base remota y el hallazgo del costo del sondeo.
