# Despliegue y autenticación (1C-A) — Plan de implementación

> **Para trabajadores agénticos:** SUB-SKILL REQUERIDA: usa `superpowers:subagent-driven-development` (recomendado) o `superpowers:executing-plans` para implementar este plan tarea por tarea. Los pasos usan casillas (`- [ ]`) para seguimiento.

**Objetivo:** que la base y la app salgan de la máquina local y que entren personas con cuenta de Google, para revisar y aprobar desde cualquier parte.

**Arquitectura:** la base se muda a Neon y la web a Vercel. Auth.js v5 resuelve el inicio de sesión con Google, con una lista de correos permitidos en una variable de entorno y sin tabla de sesiones. La comprobación de sesión vive **dentro** del ayudante por el que pasan las nueve Server Actions, no encima de las páginas, porque una Server Action es un endpoint HTTP y protegerla desde el componente no la protege.

**Stack:** pnpm workspaces, TypeScript 5 ESM, Vitest 2.1 contra Postgres real, Next.js 15 App Router, Auth.js v5, Drizzle ORM, Neon, Vercel.

**Spec:** [2026-08-04-despliegue-y-autenticacion-design.md](../specs/2026-08-04-despliegue-y-autenticacion-design.md)

## Lo que este plan NO puede hacer solo

Tres cosas exigen las credenciales del dueño del proyecto y **no las puede hacer un agente**:

1. Crear el proyecto en Neon y obtener sus dos cadenas de conexión.
2. Crear la app de OAuth en Google Cloud y obtener su identificador y su secreto.
3. Crear el proyecto en Vercel y cargar sus variables de entorno.

La Task 8 es una lista de comprobación para que las hagas tú, con lo que hay que pedir y dónde pegarlo. **Todo lo demás —código, migración, pruebas— se hace sin tocar ninguna cuenta**, contra Postgres local. Ese es el criterio con el que están repartidas las tareas: las siete primeras terminan con la suite verde en tu máquina, sin haber creado nada afuera.

## Restricciones globales

Copiadas de `CLAUDE.md` y del spec. Aplican a **todas** las tareas.

- **`pnpm test` desde la raíz, NUNCA `pnpm -r test`.** Los once paquetes comparten la base de pruebas y cada prueba la vacía al empezar; en paralelo se pisan.
- **Un solo `.env`, en la raíz.** Las variables de Vercel son otra cosa y viven en otro lado; no se crea un `.env` por paquete.
- **Una migración aplicada es inmutable.** Las seis que existen no se tocan. La nueva va **sin** el envoltorio `DO $$ ... EXCEPTION`.
- **Idioma:** esquema y columnas en inglés `snake_case`. API de dominio, variables, comentarios y **todo texto que ve el usuario**, en español neutro latinoamericano (con "tú", no "vos").
- **Los enumerados se hacen cumplir con `CHECK` en Postgres.**
- **La tenencia se verifica dentro de cada escritura.**
- **La capa web nunca ejecuta trabajo largo ni llama al modelo.** `pnpm comprobar:aislamiento` y `pnpm comprobar:volumenes` corren en CI y deben seguir en verde.
- **Cada ruta de Next necesita su propio `export const dynamic = 'force-dynamic'`.** Verificar en `pnpm --filter @gc/web build` que las rutas del dominio salgan con `ƒ` y no con `○`.
- **Una prueba que no puede fallar es peor que ninguna.** Cada prueba se rompe a propósito y se confirma que se pone roja **antes** de darse por buena. **Restaura cada mutación** y comprueba `git status` al terminar: en la rama anterior una revisión se interrumpió dejando una puesta.
- **Punto de partida:** `master` en `8469df3`, **396 pruebas en once paquetes** (`db` 23, `shared` 34, `ai` 29, `brand` 13, `pipeline` 20, `strategy` 70, `operaciones` 82, `cli` 3, `web` 83, `flujos` 32, `worker` 7).
- **Antes de empezar cualquier tarea:** `docker compose up -d postgres`.
- La base de desarrollo (`gestor`) tiene dos marcas, una estrategia `2026-Q3`, la grilla de `2026-09` en borrador con doce slots y ocho corridas. Las pruebas usan `gestor_test`. Si modificas `gestor`, restáurala.

---

## Estructura de archivos

| Archivo | Responsabilidad |
|---|---|
| `packages/db/src/esquema.ts` | Suma la tabla `users` y las tres columnas de autoría |
| `packages/db/migraciones/0006_*.sql` | La migración, escrita a mano |
| `packages/db/src/cliente.ts` | `crearConexion` acepta la opción del agrupador |
| `packages/db/src/agrupador.ts` (nuevo) | `usaAgrupador(url)`, función pura y probada |
| `apps/web/src/auth.ts` (nuevo) | La configuración de Auth.js: Google, la lista permitida, la sesión |
| `apps/web/src/auth/permitidos.ts` (nuevo) | `correoPermitido(correo, lista)` y `sesionDeDesarrollo(env)`, las dos puras |
| `apps/web/src/app/api/auth/[...nextauth]/route.ts` (nuevo) | El manejador que Auth.js necesita |
| `apps/web/src/app/entrar/page.tsx` (nuevo) | La pantalla de entrada y la de rechazo |
| `apps/web/middleware.ts` (nuevo) | Protege las rutas de páginas |
| `apps/web/src/acciones.ts` | El ayudante `ejecutar` resuelve la sesión y rechaza sin ella |
| `packages/operaciones/src/grilla.ts` | `aprobarGrilla` y `reabrirGrilla` reciben el usuario |
| `packages/brand/src/repositorio.ts` | `guardarPerfil` recibe el usuario |
| `CLAUDE.md` | El costo del worker contra la base remota, y los comandos nuevos |

---

## Task 1: La tabla `users` y las tres columnas de autoría

**Archivos:**
- Modificar: `packages/db/src/esquema.ts`, `packages/db/src/esquema.test.ts`
- Crear: `packages/db/migraciones/0006_usuarios_y_autoria.sql`, entrada en `packages/db/migraciones/meta/_journal.json`

**Interfaces:**
- Consume: nada
- Produce: `esquema.users` con `{ id, email, name, createdAt }`; `contentPlans.approvedBy`, `contentPlans.reopenedBy` y `brandProfiles.createdBy`, los tres `uuid` nulos con FK a `users` y `ON DELETE SET NULL`

- [ ] **Step 1: Registrar el punto de partida**

```bash
docker compose up -d postgres && pnpm test 2>&1 | sed 's/\x1b\[[0-9;]*m//g' | grep -E 'RUN  v|Tests +[0-9]+ (passed|failed)'
```

Esperado: once paquetes, 396 en total. Si no suman 396, **detente y reporta**.

- [ ] **Step 2: Escribir la prueba que falla**

Agrega a `packages/db/src/esquema.test.ts`:

```ts
  it('users guarda una persona y el correo es único', async () => {
    await conBaseDeDatosDePrueba(async (db) => {
      const [persona] = await db
        .insert(esquema.users)
        .values({ email: 'lukas@ejemplo.cl', name: 'Lukas' })
        .returning({ id: esquema.users.id })

      expect(persona!.id).toBeTruthy()

      await expect(
        db.insert(esquema.users).values({ email: 'lukas@ejemplo.cl', name: 'Otro' }),
      ).rejects.toThrow()
    })
  })

  it('borrar a una persona conserva lo que aprobó, con el autor en null', async () => {
    await conBaseDeDatosDePrueba(async (db) => {
      const [org] = await db
        .insert(esquema.organizations)
        .values({ name: 'Principal', slug: 'principal' })
        .returning({ id: esquema.organizations.id })
      const [marca] = await db
        .insert(esquema.brands)
        .values({ organizationId: org!.id, slug: 'parcelas', name: 'Parcelas' })
        .returning({ id: esquema.brands.id })
      const [persona] = await db
        .insert(esquema.users)
        .values({ email: 'lukas@ejemplo.cl', name: 'Lukas' })
        .returning({ id: esquema.users.id })

      const [plan] = await db
        .insert(esquema.contentPlans)
        .values({
          organizationId: org!.id,
          brandId: marca!.id,
          month: '2026-09-01',
          approvedBy: persona!.id,
        })
        .returning({ id: esquema.contentPlans.id })

      await db.delete(esquema.users).where(eq(esquema.users.id, persona!.id))

      const [despues] = await db
        .select({ approvedBy: esquema.contentPlans.approvedBy })
        .from(esquema.contentPlans)
        .where(eq(esquema.contentPlans.id, plan!.id))

      // La fila sobrevive: borrar a una persona no debe borrar la historia de
      // lo que aprobó. Si esto fuera CASCADE, el plan desaparecería con ella.
      expect(despues).toBeTruthy()
      expect(despues!.approvedBy).toBeNull()
    })
  })
```

Comprueba que el archivo importe `eq` de `drizzle-orm`; si no, agrégalo.

- [ ] **Step 3: Correr y verificar que falla**

Run: `pnpm --filter @gc/db test esquema`
Esperado: FAIL — `esquema.users` no existe.

- [ ] **Step 4: La tabla en el esquema**

En `packages/db/src/esquema.ts`, después de `organizations` y antes de `brands`:

```ts
/**
 * Las personas que pueden entrar a la web. Se llena sola en el primer inicio
 * de sesión exitoso, con un upsert por correo.
 *
 * No lleva `organization_id` a propósito: hoy hay una sola organización y las
 * tres personas la comparten. Atar usuarios a organizaciones es el diseño que
 * hace falta cuando haya equipos distintos por marca, y eso está explícitamente
 * fuera de alcance.
 *
 * Quién puede entrar NO se decide aquí sino en la lista de correos permitidos
 * de la variable de entorno: esta tabla registra a quien ya entró, no autoriza.
 */
export const users = pgTable('users', {
  id: id(),
  email: text('email').notNull().unique(),
  name: text('name'),
  createdAt: creadoEn(),
})
```

En `contentPlans`, dos columnas nuevas:

```ts
  approvedBy: uuid('approved_by').references(() => users.id, { onDelete: 'set null' }),
  reopenedBy: uuid('reopened_by').references(() => users.id, { onDelete: 'set null' }),
```

En `brandProfiles`, una:

```ts
  createdBy: uuid('created_by').references(() => users.id, { onDelete: 'set null' }),
```

Las tres son nulas: las filas que ya existen no tienen autor, y `null` significa "lo hizo el sistema o alguien antes de que existiera el registro".

- [ ] **Step 5: La migración, escrita a mano**

Crea `packages/db/migraciones/0006_usuarios_y_autoria.sql`:

```sql
CREATE TABLE "users" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"email" text NOT NULL,
	"name" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "users_email_unique" UNIQUE("email")
);
--> statement-breakpoint
ALTER TABLE "content_plans" ADD COLUMN "approved_by" uuid;
--> statement-breakpoint
ALTER TABLE "content_plans" ADD COLUMN "reopened_by" uuid;
--> statement-breakpoint
ALTER TABLE "brand_profiles" ADD COLUMN "created_by" uuid;
--> statement-breakpoint
ALTER TABLE "content_plans" ADD CONSTRAINT "content_plans_approved_by_users_id_fk" FOREIGN KEY ("approved_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "content_plans" ADD CONSTRAINT "content_plans_reopened_by_users_id_fk" FOREIGN KEY ("reopened_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "brand_profiles" ADD CONSTRAINT "brand_profiles_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;
```

**Sin envoltorio `DO $$ ... EXCEPTION`**: una migración que se salta sola es peor que una que falla.

Agrega la entrada al final del arreglo `entries` de `packages/db/migraciones/meta/_journal.json`, copiando la forma de las que ya están, con `"idx": 6` y `"tag": "0006_usuarios_y_autoria"`.

- [ ] **Step 6: Aplicarla a las dos bases**

Averigua el mecanismo mirando `packages/db/package.json` y el código del paquete, en vez de inventar un comando. Aplícala a `gestor` y a `gestor_test`. **Las dos tienen que quedar idénticas**; si diverges, la suite pasa en tu máquina y falla en cualquier otro clon.

Comprueba que quedaron iguales:

```bash
for BASE in gestor gestor_test; do echo "--- $BASE ---"; docker compose exec -T postgres psql -U postgres -d $BASE -c "\d users" | head -6; done
```

- [ ] **Step 7: Correr y verificar que pasa**

Run: `pnpm --filter @gc/db test esquema`
Esperado: PASS.

- [ ] **Step 8: Confirmar que la segunda prueba puede fallar**

Cambia temporalmente en el esquema el `onDelete: 'set null'` de `approvedBy` por `'cascade'`, y **aplica ese cambio también a `gestor_test`** con un `ALTER TABLE` a mano — la restricción vive en la base, no en TypeScript, así que tocar solo el esquema no cambia nada. Es el mismo tropiezo que ya se documentó con los enumerados.

Run: `pnpm --filter @gc/db test esquema`
Esperado: FAIL en "borrar a una persona conserva lo que aprobó".

**Restaura** el esquema y la restricción en la base, y vuelve a correr: PASS.

- [ ] **Step 9: Suite completa y commit**

```bash
pnpm -r typecheck && pnpm test 2>&1 | sed 's/\x1b\[[0-9;]*m//g' | grep -E 'Tests +[0-9]+ (passed|failed)'
```

Esperado: typecheck limpio, 398 pruebas, sin fallos.

```bash
git add -A
git commit -m "feat: tabla users y las tres columnas de autoría

La tabla se llena sola en el primer inicio de sesión y no autoriza a
nadie: quién puede entrar lo decide la lista de correos permitidos. Está
para que las columnas de autoría tengan a qué apuntar con una clave
foránea de verdad, en vez de guardar un correo suelto que un cambio de
dirección deja huérfano.

Las tres columnas van con ON DELETE SET NULL: borrar a una persona no
debe borrar la historia de lo que aprobó.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

## Task 2: La conexión contra el agrupador

Sin esto la app funciona en local y falla en producción con un error que no dice nada útil.

**Archivos:**
- Crear: `packages/db/src/agrupador.ts`, `packages/db/src/agrupador.test.ts`
- Modificar: `packages/db/src/cliente.ts`, `packages/db/src/index.ts`

**Interfaces:**
- Consume: nada de la Task 1
- Produce: `usaAgrupador(url: string): boolean`, exportada desde `@gc/db`. `crearConexion` pasa `prepare: false` cuando esa función dice que sí.

- [ ] **Step 1: Escribir la prueba que falla**

Crea `packages/db/src/agrupador.test.ts`:

```ts
import { describe, expect, it } from 'vitest'
import { usaAgrupador } from './agrupador.js'

describe('usaAgrupador', () => {
  it('reconoce el punto de conexión agrupado de Neon', () => {
    expect(
      usaAgrupador('postgres://u:p@ep-cool-name-123456-pooler.us-east-2.aws.neon.tech/gestor'),
    ).toBe(true)
  })

  it('no confunde el punto de conexión directo de Neon', () => {
    expect(
      usaAgrupador('postgres://u:p@ep-cool-name-123456.us-east-2.aws.neon.tech/gestor'),
    ).toBe(false)
  })

  it('el Postgres local no usa agrupador', () => {
    expect(usaAgrupador('postgres://postgres:postgres@localhost:5432/gestor')).toBe(false)
  })

  it('no se deja engañar por un "-pooler" en la base o en la contraseña', () => {
    // El sufijo solo cuenta en el nombre del anfitrión. Buscarlo en la cadena
    // entera daría falsos positivos que apagarían las sentencias preparadas
    // contra un Postgres que sí las soporta, y eso es una pérdida de
    // rendimiento silenciosa.
    expect(usaAgrupador('postgres://u:mi-pooler@localhost:5432/gestor')).toBe(false)
    expect(usaAgrupador('postgres://u:p@localhost:5432/base-pooler')).toBe(false)
  })

  it('una cadena que no es una URL no revienta', () => {
    expect(usaAgrupador('esto no es una url')).toBe(false)
  })
})
```

- [ ] **Step 2: Correr y verificar que falla**

Run: `pnpm --filter @gc/db test agrupador`
Esperado: FAIL con "Failed to resolve import ./agrupador.js".

- [ ] **Step 3: Implementar**

Crea `packages/db/src/agrupador.ts`:

```ts
/**
 * Si la URL apunta al agrupador de conexiones de Neon (PgBouncer en modo
 * transacción) y no al punto de conexión directo.
 *
 * Importa porque **PgBouncer en modo transacción no soporta sentencias
 * preparadas**, que es lo que `postgres-js` usa por omisión. Sin apagarlas, la
 * app funciona en local contra Postgres y falla en producción con un error que
 * no dice nada útil — y que nunca se reproduce en desarrollo.
 *
 * Se detecta por el sufijo `-pooler` en el nombre del anfitrión, que es la
 * convención de Neon. Se mira solo el anfitrión y no la cadena entera: un
 * `-pooler` en la contraseña o en el nombre de la base daría un falso positivo
 * que apaga las sentencias preparadas contra un Postgres que sí las soporta.
 *
 * Una cadena que no parsea devuelve `false`: el error de conexión que viene
 * después es mucho más claro que uno de parseo aquí.
 */
export function usaAgrupador(url: string): boolean {
  try {
    return new URL(url).hostname.includes('-pooler')
  } catch {
    return false
  }
}
```

En `packages/db/src/cliente.ts`:

```ts
import { drizzle, type PostgresJsDatabase } from 'drizzle-orm/postgres-js'
import postgres from 'postgres'
import { usaAgrupador } from './agrupador.js'
import { esquema } from './esquema.js'

export type BaseDeDatos = PostgresJsDatabase<typeof esquema>

export function crearConexion(url: string): { db: BaseDeDatos; cerrar: () => Promise<void> } {
  const sql = postgres(url, {
    max: 5,
    // Ver `usaAgrupador`: contra PgBouncer en modo transacción las sentencias
    // preparadas no funcionan, y el síntoma solo aparece en producción.
    ...(usaAgrupador(url) ? { prepare: false } : {}),
  })
  return { db: drizzle(sql, { schema: esquema }), cerrar: () => sql.end() }
}
```

Agrega a `packages/db/src/index.ts`, en orden:

```ts
export * from './agrupador.js'
```

- [ ] **Step 4: Correr y verificar que pasa**

Run: `pnpm --filter @gc/db test agrupador`
Esperado: PASS, 5 pruebas.

- [ ] **Step 5: Confirmar que la prueba puede fallar**

Cambia temporalmente `new URL(url).hostname.includes('-pooler')` por `url.includes('-pooler')`.

Run: `pnpm --filter @gc/db test agrupador`
Esperado: FAIL en "no se deja engañar".

**Restaura** y vuelve a correr: PASS.

- [ ] **Step 6: Suite completa y commit**

```bash
pnpm -r typecheck && pnpm test 2>&1 | sed 's/\x1b\[[0-9;]*m//g' | grep -E 'Tests +[0-9]+ (passed|failed)'
```

Esperado: typecheck limpio, 403 pruebas.

```bash
git add -A
git commit -m "feat: la conexión apaga las sentencias preparadas contra el agrupador

PgBouncer en modo transacción no las soporta, y postgres-js las usa por
omisión. Sin esto la app funciona contra el Postgres local y falla en
producción con un error que no dice nada útil.

Se detecta por el sufijo del anfitrión y no por la cadena entera: un
\"-pooler\" en la contraseña apagaría las preparadas contra un Postgres
que sí las soporta, que es una pérdida de rendimiento invisible.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

## Task 3: Las dos decisiones puras de la autenticación

Van antes que Auth.js porque son lo único de la autenticación que se puede probar sin levantar un navegador, y porque una de ellas es una puerta trasera que no puede quedar abierta.

**Archivos:**
- Crear: `apps/web/src/auth/permitidos.ts`, `apps/web/src/auth/permitidos.test.ts`

**Interfaces:**
- Consume: nada
- Produce:
  - `correoPermitido(correo: string | null | undefined, lista: string | undefined): boolean`
  - `sesionDeDesarrollo(env: { NODE_ENV?: string; SESION_DE_DESARROLLO?: string }): { email: string; name: string } | null`

- [ ] **Step 1: Escribir las pruebas que fallan**

Crea `apps/web/src/auth/permitidos.test.ts`:

```ts
import { describe, expect, it } from 'vitest'
import { correoPermitido, sesionDeDesarrollo } from './permitidos.js'

const LISTA = 'lukas@ejemplo.cl, ana@ejemplo.cl,BEA@Ejemplo.CL'

describe('correoPermitido', () => {
  it('deja entrar a quien está en la lista', () => {
    expect(correoPermitido('lukas@ejemplo.cl', LISTA)).toBe(true)
    expect(correoPermitido('ana@ejemplo.cl', LISTA)).toBe(true)
  })

  it('no deja entrar a quien no está', () => {
    expect(correoPermitido('otro@ejemplo.cl', LISTA)).toBe(false)
  })

  it('ignora mayúsculas y espacios de la lista y del correo', () => {
    expect(correoPermitido('  BEA@ejemplo.cl ', LISTA)).toBe(true)
  })

  it('sin lista configurada no deja entrar a nadie', () => {
    // Cerrado por omisión: una variable que falta en producción no puede
    // significar "que pase cualquiera".
    expect(correoPermitido('lukas@ejemplo.cl', undefined)).toBe(false)
    expect(correoPermitido('lukas@ejemplo.cl', '')).toBe(false)
    expect(correoPermitido('lukas@ejemplo.cl', '   ,  ')).toBe(false)
  })

  it('sin correo no deja entrar', () => {
    expect(correoPermitido(null, LISTA)).toBe(false)
    expect(correoPermitido(undefined, LISTA)).toBe(false)
    expect(correoPermitido('', LISTA)).toBe(false)
  })
})

describe('sesionDeDesarrollo', () => {
  it('en desarrollo y con la variable encendida devuelve una sesión', () => {
    const s = sesionDeDesarrollo({ NODE_ENV: 'development', SESION_DE_DESARROLLO: 'true' })
    expect(s).not.toBeNull()
    expect(s!.email).toContain('@')
  })

  it('en desarrollo sin la variable no devuelve nada', () => {
    expect(sesionDeDesarrollo({ NODE_ENV: 'development' })).toBeNull()
    expect(sesionDeDesarrollo({ NODE_ENV: 'development', SESION_DE_DESARROLLO: 'false' })).toBeNull()
  })

  it('en producción NO se activa aunque la variable esté encendida', () => {
    // Es la prueba que importa de este archivo. Una puerta trasera que depende
    // de recordar apagarla no es una puerta trasera de desarrollo.
    expect(sesionDeDesarrollo({ NODE_ENV: 'production', SESION_DE_DESARROLLO: 'true' })).toBeNull()
  })

  it('sin NODE_ENV tampoco se activa', () => {
    // Vercel define NODE_ENV, pero si algún día llegara vacío el resultado
    // seguro es no abrir la puerta.
    expect(sesionDeDesarrollo({ SESION_DE_DESARROLLO: 'true' })).toBeNull()
  })
})
```

- [ ] **Step 2: Correr y verificar que fallan**

Run: `pnpm --filter @gc/web test permitidos`
Esperado: FAIL con "Failed to resolve import ./permitidos.js".

- [ ] **Step 3: Implementar**

Crea `apps/web/src/auth/permitidos.ts`:

```ts
/** El correo de mentira con que se entra en desarrollo. Se inserta en `users`
 *  como cualquier otro, para que el camino de autoría se ejercite en local en
 *  vez de existir solo en producción, que es donde nadie lo prueba. */
const CORREO_DE_DESARROLLO = 'desarrollo@local'

/**
 * Si este correo puede entrar.
 *
 * **Cerrado por omisión**: sin lista configurada no entra nadie. Una variable
 * que falta en producción no puede significar "que pase cualquiera" — ese es
 * exactamente el modo de falla que uno no descubre hasta que ya pasó.
 *
 * Recibe la lista como parámetro en vez de leer el entorno, para que se pueda
 * probar sin ensuciar el proceso de pruebas.
 */
export function correoPermitido(
  correo: string | null | undefined,
  lista: string | undefined,
): boolean {
  if (!correo) return false

  const permitidos = (lista ?? '')
    .split(',')
    .map((c) => c.trim().toLowerCase())
    .filter((c) => c !== '')

  if (permitidos.length === 0) return false

  return permitidos.includes(correo.trim().toLowerCase())
}

/**
 * La sesión de mentira de desarrollo, o `null` si no corresponde.
 *
 * Exige **las dos cosas**: que el entorno sea de desarrollo y que la variable
 * esté encendida. La primera condición es la que hace que esto no sea un
 * agujero: no depende de que alguien se acuerde de apagar la variable antes de
 * desplegar.
 *
 * Recibe el entorno como parámetro y no lee `process.env` por dentro,
 * precisamente para que la prueba de que en producción no se activa sea
 * posible sin manipular el entorno del proceso.
 */
export function sesionDeDesarrollo(env: {
  NODE_ENV?: string | undefined
  SESION_DE_DESARROLLO?: string | undefined
}): { email: string; name: string } | null {
  if (env.NODE_ENV !== 'development') return null
  if (env.SESION_DE_DESARROLLO !== 'true') return null

  return { email: CORREO_DE_DESARROLLO, name: 'Desarrollo' }
}
```

- [ ] **Step 4: Correr y verificar que pasan**

Run: `pnpm --filter @gc/web test permitidos`
Esperado: PASS, 9 pruebas.

- [ ] **Step 5: Confirmar que las dos que importan pueden fallar**

Primera mutación: en `correoPermitido`, cambia `if (permitidos.length === 0) return false` por `if (permitidos.length === 0) return true`.
Esperado: FAIL en "sin lista configurada no deja entrar a nadie".

Segunda mutación, **restaurando la anterior primero**: en `sesionDeDesarrollo`, borra la línea `if (env.NODE_ENV !== 'development') return null`.
Esperado: FAIL en "en producción NO se activa" y en "sin NODE_ENV tampoco".

**Restaura** y vuelve a correr: PASS.

- [ ] **Step 6: Suite completa y commit**

```bash
pnpm -r typecheck && pnpm test 2>&1 | sed 's/\x1b\[[0-9;]*m//g' | grep -E 'Tests +[0-9]+ (passed|failed)'
```

Esperado: typecheck limpio, 412 pruebas.

```bash
git add -A
git commit -m "feat: las dos decisiones puras de la autenticación

Quién puede entrar y si corresponde la sesión de desarrollo. Las dos
reciben sus datos como parámetro en vez de leer el entorno, que es lo
que hace posible probar que en producción la puerta trasera no se abre.

Las dos son cerradas por omisión: sin lista no entra nadie, y sin
entorno de desarrollo no hay sesión de mentira aunque la variable esté
encendida.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

## Task 4: Auth.js con Google

**Archivos:**
- Crear: `apps/web/src/auth.ts`, `apps/web/src/app/api/auth/[...nextauth]/route.ts`, `apps/web/src/app/entrar/page.tsx`
- Modificar: `apps/web/package.json`, `.env.example`

**Interfaces:**
- Consume: `correoPermitido` y `sesionDeDesarrollo` de la Task 3; `esquema.users` de la Task 1
- Produce: `auth()`, `signIn()`, `signOut()` y `handlers` exportados desde `apps/web/src/auth.ts`. `auth()` devuelve una sesión cuyo `user` lleva `{ id, email, name }`, donde `id` es el de la fila de `users`.

- [ ] **Step 1: Instalar**

```bash
pnpm --filter @gc/web add next-auth@beta
```

`next-auth@beta` es la v5. La v4 tiene otra API y no encaja con el App Router.

- [ ] **Step 2: La configuración**

Crea `apps/web/src/auth.ts`:

```ts
import NextAuth from 'next-auth'
import Google from 'next-auth/providers/google'
import { esquema } from '@gc/db'
import { eq } from 'drizzle-orm'
import { conexion } from './datos.js'
import { correoPermitido, sesionDeDesarrollo } from './auth/permitidos.js'

/**
 * Deja registrada a la persona y devuelve el id de su fila.
 *
 * Es un upsert por correo: la tabla `users` no autoriza a nadie —eso lo decide
 * la lista de permitidos— sino que registra a quien ya pasó ese filtro, para
 * que las columnas de autoría tengan a qué apuntar.
 */
async function registrarPersona(email: string, name: string | null): Promise<string> {
  const db = conexion()

  const [fila] = await db
    .insert(esquema.users)
    .values({ email, name })
    .onConflictDoUpdate({
      target: esquema.users.email,
      // El nombre se refresca: si alguien lo cambia en Google, la próxima
      // entrada lo actualiza. El correo es la identidad y no se toca.
      set: { name },
    })
    .returning({ id: esquema.users.id })

  if (fila) return fila.id

  // `onConflictDoUpdate` siempre devuelve fila, así que esto es defensa en
  // profundidad para un camino que no debería existir.
  const [existente] = await db
    .select({ id: esquema.users.id })
    .from(esquema.users)
    .where(eq(esquema.users.email, email))

  if (!existente) throw new Error(`No se pudo registrar a ${email}`)
  return existente.id
}

export const { handlers, auth, signIn, signOut } = NextAuth({
  providers: [Google],
  pages: {
    signIn: '/entrar',
    error: '/entrar',
  },
  callbacks: {
    /**
     * La lista de permitidos es la única autorización del sistema. Devolver
     * `false` manda a la pantalla de entrada con el motivo, en vez de dejar a
     * la persona en un bucle de redirección.
     */
    signIn({ user }) {
      return correoPermitido(user.email, process.env.CORREOS_PERMITIDOS)
    },

    /**
     * El id de la fila de `users` viaja en el token, no se consulta en cada
     * petición: la sesión va en cookie firmada y este callback solo corre al
     * entrar o al refrescar el token.
     */
    async jwt({ token, user }) {
      if (user?.email) {
        token.idDeUsuario = await registrarPersona(user.email, user.name ?? null)
      }
      return token
    },

    session({ session, token }) {
      if (typeof token.idDeUsuario === 'string') {
        session.user.id = token.idDeUsuario
      }
      return session
    },
  },
})

/**
 * La sesión efectiva: la real, o la de desarrollo si corresponde.
 *
 * Es el único punto por el que el resto de la app pregunta quién está
 * conectado. Que la puerta trasera viva aquí y no repartida significa que
 * `sesionDeDesarrollo` —que ya está probada— es la que decide, en un solo
 * lugar.
 */
export async function sesionActual(): Promise<{ id: string; email: string } | null> {
  const deDesarrollo = sesionDeDesarrollo(process.env)
  if (deDesarrollo) {
    const id = await registrarPersona(deDesarrollo.email, deDesarrollo.name)
    return { id, email: deDesarrollo.email }
  }

  const sesion = await auth()
  if (!sesion?.user?.id || !sesion.user.email) return null

  return { id: sesion.user.id, email: sesion.user.email }
}
```

Si TypeScript se queja de `session.user.id` o de `token.idDeUsuario`, agrega la declaración de módulo que Auth.js documenta para extender sus tipos, en un archivo `apps/web/src/auth.d.ts`. **Dilo en el informe si te hizo falta.**

- [ ] **Step 3: El manejador de rutas**

Crea `apps/web/src/app/api/auth/[...nextauth]/route.ts`:

```ts
import { handlers } from '../../../../auth.js'

export const { GET, POST } = handlers
```

- [ ] **Step 4: La pantalla de entrada**

Crea `apps/web/src/app/entrar/page.tsx`:

```tsx
import { signIn } from '../../auth.js'

// Esta ruta lee el parámetro de error de la URL, así que no puede
// prerenderizarse: sin esto quedaría congelada en el build sin error.
export const dynamic = 'force-dynamic'

export default async function PaginaDeEntrada({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>
}) {
  const { error } = await searchParams
  // Auth.js manda `AccessDenied` cuando el callback de inicio de sesión
  // devuelve false, que aquí significa exactamente una cosa: el correo no está
  // en la lista.
  const rechazado = error === 'AccessDenied'

  return (
    <div className="flex min-h-screen flex-col items-center justify-center gap-6 p-6">
      <h1 className="text-xl font-semibold text-gray-900">Gestor de contenido</h1>

      {rechazado && (
        <div
          role="alert"
          className="max-w-sm rounded border border-amber-300 bg-amber-50 p-3 text-sm text-amber-900"
        >
          Esa cuenta no está en la lista de personas autorizadas. Si crees que debería estarlo,
          pídele a quien administra el sistema que agregue tu correo.
        </div>
      )}

      <form
        action={async () => {
          'use server'
          await signIn('google', { redirectTo: '/' })
        }}
      >
        <button
          type="submit"
          className="rounded bg-indigo-600 px-4 py-2 text-sm font-medium text-white hover:bg-indigo-700"
        >
          Entrar con Google
        </button>
      </form>
    </div>
  )
}
```

- [ ] **Step 5: Las variables nuevas**

Agrega a `.env.example`:

```
# Autenticación (bloque 1C-A). En local basta SESION_DE_DESARROLLO=true;
# las tres de Auth.js solo hacen falta para probar el inicio de sesión real.
AUTH_SECRET=
AUTH_GOOGLE_ID=
AUTH_GOOGLE_SECRET=
CORREOS_PERMITIDOS=

# Sesión de mentira para desarrollo. Se IGNORA fuera de NODE_ENV=development,
# así que dejarla encendida no abre nada en producción.
SESION_DE_DESARROLLO=true
```

Y ponlas también en tu `.env` local, con `SESION_DE_DESARROLLO=true` y las otras vacías.

- [ ] **Step 6: Comprobar que compila y que la pantalla existe**

```bash
pnpm --filter @gc/web typecheck && pnpm --filter @gc/web build 2>&1 | sed 's/\x1b\[[0-9;]*m//g' | grep -E "^[┌├└].*(ƒ|○)"
```

Esperado: typecheck limpio; en el listado aparece `/entrar`, y las cuatro rutas del dominio siguen con `ƒ`.

- [ ] **Step 7: Suite completa y commit**

```bash
pnpm test 2>&1 | sed 's/\x1b\[[0-9;]*m//g' | grep -E 'Tests +[0-9]+ (passed|failed)' && pnpm comprobar:aislamiento && pnpm comprobar:volumenes
```

Esperado: 412 pruebas (esta tarea no agrega ninguna: lo probable ya se probó en la Task 3), los dos guardianes en verde.

```bash
git add -A
git commit -m "feat: entrar con Google, con lista de correos permitidos

Auth.js v5 con sesión en cookie firmada y sin tabla de sesiones. La
tabla users se llena sola al entrar y no autoriza: quién puede entrar lo
decide la lista de la variable de entorno.

El rechazo manda a una pantalla que dice que la cuenta no está en la
lista, en vez de a un error genérico o a un bucle de redirección.

sesionActual es el único punto por el que el resto de la app pregunta
quién está conectado, y es donde vive la sesión de desarrollo.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

## Task 5: Proteger las nueve Server Actions

**Es la tarea más importante del plan.** Una Server Action de Next es un endpoint HTTP con un identificador estable: cualquiera que lo conozca puede llamarlo sin pasar nunca por la página. Si la comprobación de sesión vive solo en el componente de servidor, las nueve acciones de esta app quedan abiertas a internet.

**Archivos:**
- Modificar: `apps/web/src/acciones.ts`
- Crear: `apps/web/src/acciones.test.ts`

**Interfaces:**
- Consume: `sesionActual()` de la Task 4
- Produce: el ayudante `ejecutar` pasa a resolver la sesión y a rechazar sin ella; su callback recibe un tercer argumento `usuarioId: string`

- [ ] **Step 1: Escribir la prueba que falla**

Es la prueba que sostiene la garantía del bloque, así que mide **la escritura**, no el valor devuelto: una acción que responda `{ ok: false }` pero haya escrito igual sería peor que una que falle.

Crea `apps/web/src/acciones.test.ts`:

```ts
import { esquema } from '@gc/db'
import { conBaseDeDatosDePrueba } from '@gc/db/pruebas'
import { sembrarConGrilla } from '@gc/operaciones/pruebas'
import { eq } from 'drizzle-orm'
import { afterEach, describe, expect, it, vi } from 'vitest'

// La sesión se sustituye porque lo que se prueba es la guarda, no Auth.js.
vi.mock('./auth.js', () => ({ sesionActual: vi.fn() }))
// `revalidatePath` solo existe dentro del ciclo de petición de Next.
vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }))

const { sesionActual } = await import('./auth.js')
const { aprobarGrillaAccion, descartarSlotAccion } = await import('./acciones.js')

afterEach(() => vi.mocked(sesionActual).mockReset())

describe('las Server Actions exigen sesión', () => {
  it('sin sesión, aprobar NO escribe en la base', async () => {
    await conBaseDeDatosDePrueba(async (db) => {
      const ref = await sembrarConGrilla(db)
      const [plan] = await db.select().from(esquema.contentPlans)
      vi.mocked(sesionActual).mockResolvedValue(null)

      const r = await aprobarGrillaAccion('parcelas', '2026-09', plan!.id)

      expect(r.ok).toBe(false)

      // Lo que importa: la fila no cambió. Una acción que responde "no" pero
      // escribe igual es peor que una que falla.
      const [despues] = await db
        .select({ status: esquema.contentPlans.status })
        .from(esquema.contentPlans)
        .where(eq(esquema.contentPlans.id, plan!.id))
      expect(despues!.status).toBe('borrador')
      void ref
    })
  })

  it('sin sesión, descartar un slot NO escribe en la base', async () => {
    await conBaseDeDatosDePrueba(async (db) => {
      await sembrarConGrilla(db)
      const [slot] = await db.select().from(esquema.planSlots)
      vi.mocked(sesionActual).mockResolvedValue(null)

      const r = await descartarSlotAccion('parcelas', '2026-09', slot!.id)

      expect(r.ok).toBe(false)
      const [despues] = await db
        .select({ status: esquema.planSlots.status })
        .from(esquema.planSlots)
        .where(eq(esquema.planSlots.id, slot!.id))
      expect(despues!.status).toBe('planificado')
    })
  })

  it('con sesión, la acción sí escribe', async () => {
    // Sin esta mitad, una guarda que rechazara SIEMPRE también pasaría.
    await conBaseDeDatosDePrueba(async (db) => {
      await sembrarConGrilla(db)
      const [slot] = await db.select().from(esquema.planSlots)
      const [persona] = await db
        .insert(esquema.users)
        .values({ email: 'lukas@ejemplo.cl', name: 'Lukas' })
        .returning({ id: esquema.users.id })
      vi.mocked(sesionActual).mockResolvedValue({ id: persona!.id, email: 'lukas@ejemplo.cl' })

      const r = await descartarSlotAccion('parcelas', '2026-09', slot!.id)

      expect(r.ok).toBe(true)
      const [despues] = await db
        .select({ status: esquema.planSlots.status })
        .from(esquema.planSlots)
        .where(eq(esquema.planSlots.id, slot!.id))
      expect(despues!.status).toBe('descartado')
    })
  })

  it('el mensaje de rechazo le dice a la persona qué hacer', async () => {
    await conBaseDeDatosDePrueba(async (db) => {
      await sembrarConGrilla(db)
      const [slot] = await db.select().from(esquema.planSlots)
      vi.mocked(sesionActual).mockResolvedValue(null)

      const r = await descartarSlotAccion('parcelas', '2026-09', slot!.id)

      expect(r.ok).toBe(false)
      if (r.ok) throw new Error('inalcanzable')
      expect(r.mensaje).toMatch(/sesión/i)
      expect(r.reintentable).toBe(false)
    })
  })
})
```

Este archivo golpea Postgres, así que **no** lleva `// @vitest-environment jsdom`.

- [ ] **Step 2: Correr y verificar que falla**

Run: `pnpm --filter @gc/web test acciones`
Esperado: FAIL — las dos primeras, porque hoy la acción escribe sin sesión.

- [ ] **Step 3: La guarda, en el ayudante compartido**

En `apps/web/src/acciones.ts`, el ayudante pasa a:

```ts
/**
 * Resuelve la sesión, ejecuta la operación de dominio, revalida la ruta y
 * traduce el error.
 *
 * **La comprobación de sesión vive aquí y no en las páginas a propósito.** Una
 * Server Action es un endpoint HTTP con identificador estable: cualquiera que
 * lo conozca puede llamarlo sin pasar nunca por la página que lo renderiza, así
 * que proteger el componente de servidor no protege la acción. Al estar en el
 * ayudante por el que pasan las nueve, una acción nueva queda protegida por
 * construcción — y una que no lo use se ve en la revisión.
 */
async function ejecutar<T = null>(
  ruta: string,
  fn: (
    db: Awaited<ReturnType<typeof conexion>>,
    organizationId: string,
    usuarioId: string,
  ) => Promise<T>,
): Promise<Resultado<T>> {
  const sesion = await sesionActual()
  if (!sesion) {
    return {
      ok: false,
      mensaje: 'Tu sesión no está activa. Vuelve a entrar para seguir.',
      reintentable: false,
    }
  }

  const db = conexion()
  try {
    const datos = await fn(db, await organizacionPorDefecto(db), sesion.id)
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

Agrega el import: `import { sesionActual } from './auth.js'`.

Las nueve acciones no cambian su cuerpo: reciben un tercer argumento que por ahora ignoran. La Task 6 lo usa en tres de ellas.

- [ ] **Step 4: Correr y verificar que pasa**

Run: `pnpm --filter @gc/web test acciones`
Esperado: PASS, 4 pruebas.

- [ ] **Step 5: Confirmar que la prueba puede fallar, en las dos direcciones**

Primera mutación: borra el bloque `if (!sesion) { ... }`.
Esperado: FAIL en las dos pruebas de "sin sesión no escribe".

Segunda mutación, **restaurando la primera**: cambia `if (!sesion)` por `if (true)`.
Esperado: FAIL en "con sesión, la acción sí escribe".

Las dos direcciones importan: la primera atrapa que la guarda no exista, la segunda que exista pero rechace siempre — y una guarda que rechaza todo también deja las dos primeras pruebas en verde.

**Restaura** y vuelve a correr: PASS.

- [ ] **Step 6: Suite completa y commit**

```bash
pnpm -r typecheck && pnpm test 2>&1 | sed 's/\x1b\[[0-9;]*m//g' | grep -E 'Tests +[0-9]+ (passed|failed)'
```

Esperado: typecheck limpio, 416 pruebas.

```bash
git add -A
git commit -m "feat: las nueve Server Actions exigen sesión

Una Server Action es un endpoint HTTP con identificador estable:
cualquiera que lo conozca puede llamarlo sin pasar por la página que lo
renderiza, así que proteger el componente de servidor no la protege.

La comprobación va en el ayudante por el que pasan las nueve, de modo
que una acción nueva queda protegida por construcción. Su prueba mide la
escritura y no el valor devuelto, y va en las dos direcciones: sin
sesión no escribe, y con sesión sí — porque una guarda que rechaza
siempre también dejaría verde la primera mitad.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

## Task 6: El middleware y la autoría

Las dos mitades que faltan: que nadie vea datos sin entrar, y que quede registrado quién decidió qué.

**Archivos:**
- Crear: `apps/web/middleware.ts`
- Modificar: `packages/operaciones/src/grilla.ts`, `packages/operaciones/src/grilla.test.ts`, `packages/brand/src/repositorio.ts`, `packages/brand/src/repositorio.test.ts`, `packages/operaciones/src/perfiles.ts`, `apps/web/src/acciones.ts`

**Interfaces:**
- Consume: la guarda de la Task 5, que ya entrega `usuarioId` al callback
- Produce: `aprobarGrilla(db, organizationId, contentPlanId, usuarioId?)`, `reabrirGrilla(db, organizationId, args, usuarioId?)`, `guardarPerfil(db, ref, crudo, usuarioId?)` y `cargarPerfilDeObjeto(db, organizationId, args, usuarioId?)`

- [ ] **Step 1: El middleware**

Crea `apps/web/middleware.ts`:

```ts
export { auth as middleware } from './src/auth.js'

/**
 * Protege las rutas de páginas para que nadie vea datos sin entrar.
 *
 * **No reemplaza a la guarda de las Server Actions** y viceversa: esto impide
 * ver, aquella impide escribir, y una acción llamada directamente no pasa por
 * aquí. Las dos capas hacen falta.
 *
 * Se excluyen las rutas de Auth.js —que tienen que ser alcanzables sin sesión
 * o no habría forma de entrar—, la pantalla de entrada, y los archivos
 * estáticos.
 */
export const config = {
  matcher: ['/((?!api/auth|entrar|_next/static|_next/image|favicon.ico).*)'],
}
```

- [ ] **Step 2: Comprobar el middleware a mano**

No hay arnés para middleware en este repositorio, así que se comprueba usándolo. Con `SESION_DE_DESARROLLO=true` en tu `.env`:

```bash
pnpm --filter @gc/web dev
```

Abre `http://localhost:3000`: debe cargar, porque la sesión de desarrollo está encendida.

Ahora **pon `SESION_DE_DESARROLLO=false`**, reinicia el servidor, y vuelve a abrir: debe mandarte a `/entrar`. Restaura la variable a `true`.

Pega las dos observaciones en el informe. Si el middleware no redirige, el `matcher` está mal y hay que arreglarlo antes de seguir.

- [ ] **Step 3: Escribir las pruebas de autoría que fallan**

Agrega a `packages/operaciones/src/grilla.test.ts`:

```ts
  it('aprobar registra quién lo hizo, y sin usuario deja null', async () => {
    await conBaseDeDatosDePrueba(async (db) => {
      const ref = await sembrarConGrilla(db)
      const [plan] = await db.select().from(esquema.contentPlans)
      const [persona] = await db
        .insert(esquema.users)
        .values({ email: 'lukas@ejemplo.cl', name: 'Lukas' })
        .returning({ id: esquema.users.id })

      await aprobarGrilla(db, ref.organizationId, plan!.id, persona!.id)

      const [conAutor] = await db
        .select({ approvedBy: esquema.contentPlans.approvedBy })
        .from(esquema.contentPlans)
        .where(eq(esquema.contentPlans.id, plan!.id))
      expect(conAutor!.approvedBy).toBe(persona!.id)

      await reabrirGrilla(db, ref.organizationId, { slug: 'parcelas', mes: '2026-09' })

      const [sinAutor] = await db
        .select({ reopenedBy: esquema.contentPlans.reopenedBy })
        .from(esquema.contentPlans)
        .where(eq(esquema.contentPlans.id, plan!.id))
      // Sin usuario no falla: `null` significa "lo hizo el sistema", que es lo
      // que pasa cuando reabre el CLI.
      expect(sinAutor!.reopenedBy).toBeNull()
    })
  })
```

Y a `packages/brand/src/repositorio.test.ts`:

```ts
  it('guardar el perfil registra quién lo hizo', async () => {
    await conBaseDeDatosDePrueba(async (db) => {
      const ref = await sembrarMarca(db)
      const [persona] = await db
        .insert(esquema.users)
        .values({ email: 'lukas@ejemplo.cl', name: 'Lukas' })
        .returning({ id: esquema.users.id })

      const version = await guardarPerfil(db, ref, PERFIL_VALIDO, persona!.id)

      const [fila] = await db
        .select({ createdBy: esquema.brandProfiles.createdBy })
        .from(esquema.brandProfiles)
        .where(eq(esquema.brandProfiles.version, version))

      expect(fila!.createdBy).toBe(persona!.id)
    })
  })
```

Usa el ayudante de siembra que ese archivo ya tenga; si se llama distinto de `sembrarMarca`, usa el nombre real.

- [ ] **Step 4: Correr y verificar que fallan**

```bash
pnpm --filter @gc/operaciones test grilla && pnpm --filter @gc/brand test repositorio
```

Esperado: FAIL — las funciones no aceptan ese parámetro.

- [ ] **Step 5: Implementar**

En `packages/operaciones/src/grilla.ts`, `aprobarGrilla` gana un cuarto parámetro y lo escribe:

```ts
export async function aprobarGrilla(
  db: BaseDeDatos,
  organizationId: string,
  contentPlanId: string,
  /**
   * Quién aprobó. Opcional y `null` por omisión: el CLI aprueba sin sesión, y
   * ahí `null` significa "lo hizo el sistema". Va como parámetro explícito y no
   * leído de un contexto porque `@gc/operaciones` no sabe que existe una sesión
   * web — el CLI y el worker llaman a esta misma función.
   */
  usuarioId?: string,
): Promise<void> {
  const [fila] = await db
    .update(esquema.contentPlans)
    .set({ status: 'aprobada', approvedBy: usuarioId ?? null })
    // ... el resto del `where` y el manejo de error no cambian
```

`reabrirGrilla` igual, escribiendo `reopenedBy`.

En `packages/brand/src/repositorio.ts`, `guardarPerfil` gana un cuarto parámetro `usuarioId?: string` y lo pasa como `createdBy: usuarioId ?? null` en el insert de la versión nueva.

En `packages/operaciones/src/perfiles.ts`, `cargarPerfilDeObjeto` gana un cuarto parámetro y se lo pasa a `guardarPerfil`.

Y en `apps/web/src/acciones.ts`, las tres acciones correspondientes pasan el `usuarioId` que el ayudante ya les entrega:

```ts
export async function aprobarGrillaAccion(
  marca: string,
  mes: string,
  contentPlanId: string,
): Promise<Resultado> {
  return ejecutar(`/${marca}/grilla/${mes}`, async (db, organizationId, usuarioId) => {
    await aprobarGrilla(db, organizationId, contentPlanId, usuarioId)
    return null
  })
}
```

Lo mismo en `reabrirGrillaAccion` y en `guardarPerfilAction`.

- [ ] **Step 6: Correr y confirmar que pueden fallar**

```bash
pnpm --filter @gc/operaciones test grilla && pnpm --filter @gc/brand test repositorio
```
Esperado: PASS.

Mutación: en `aprobarGrilla`, cambia `approvedBy: usuarioId ?? null` por `approvedBy: null`.
Esperado: FAIL en "aprobar registra quién lo hizo".

**Restaura** y vuelve a correr: PASS.

- [ ] **Step 7: Suite completa, build y commit**

```bash
pnpm -r typecheck && pnpm test 2>&1 | sed 's/\x1b\[[0-9;]*m//g' | grep -E 'Tests +[0-9]+ (passed|failed)' && pnpm --filter @gc/web build 2>&1 | sed 's/\x1b\[[0-9;]*m//g' | grep -E "^[┌├└].*(ƒ|○)"
```

Esperado: typecheck limpio, 418 pruebas, build con las rutas del dominio en `ƒ`.

```bash
git add -A
git commit -m "feat: middleware de páginas y autoría de las tres decisiones

El middleware impide ver sin entrar; la guarda de las acciones impide
escribir. Son dos capas y ninguna reemplaza a la otra: una acción
llamada directamente no pasa por el middleware.

Quién aprobó, quién reabrió y quién guardó cada versión del perfil. El
usuario va como parámetro explícito y opcional: @gc/operaciones no sabe
que existe una sesión web, y el CLI llama a las mismas funciones sin
ninguna — ahí null significa que lo hizo el sistema.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

## Task 7: La documentación de lo que cambia al operar

**Archivos:**
- Modificar: `CLAUDE.md`, `docs/superpowers/specs/pendientes.md`

**Interfaces:**
- Consume: todo lo anterior
- Produce: nada de código

- [ ] **Step 1: `CLAUDE.md`**

En Comandos, agrega la sesión de desarrollo:

```
La app exige sesión. En local basta `SESION_DE_DESARROLLO=true` en el `.env`,
que entra como `desarrollo@local` sin pasar por Google. Esa variable **se
ignora fuera de `NODE_ENV=development`**, así que dejarla encendida no abre
nada en producción.
```

En Entorno, agrega el costo del worker contra la base remota:

```
**Con la base en Neon, el worker no puede quedar encendido.** El plan gratuito
da unas 190 horas de cómputo al mes y suspende la base cuando nadie la
consulta; un sondeo cada dos segundos la mantiene despierta las 730 horas del
mes y se lo come solo, sin que nadie esté usando el sistema. Levanta el worker
cuando vayas a generar y bájalo al terminar. Resolverlo de verdad es del
bloque 1C-B: que la web lo despierte en vez de que él pregunte.
```

Y en las reglas no negociables, después de la de la capa web:

```
**Proteger las páginas no protege las Server Actions.** Son endpoints HTTP con
identificador estable: cualquiera que lo conozca puede llamarlos sin pasar por
la página. La comprobación de sesión vive en el ayudante `ejecutar` de
`apps/web/src/acciones.ts`, por el que pasan las nueve acciones, no en los
componentes de servidor. Una acción que no use ese ayudante nace desprotegida.
```

- [ ] **Step 2: `pendientes.md`**

En "Prioridad 2 — deuda real, sin urgencia":

1. **La lista de correos permitidos exige redespliegue.** Agregar a alguien es editar una variable en Vercel y esperar el build. Para tres personas está bien; si rota más, la salida es una tabla de invitaciones, que es el diseño que este bloque descartó a propósito.
2. **Una Server Action nueva que no use el ayudante `ejecutar` nace desprotegida**, y solo lo atrapa la revisión. La comprobación automática sería un guardián como los de aislamiento y volúmenes, que verifique que toda función exportada de `acciones.ts` pase por él.
3. **El costo del sondeo contra la base remota** es el insumo principal del bloque 1C-B, con la decisión concreta: que la web despierte al worker en vez de que él pregunte cada dos segundos.

- [ ] **Step 3: Commit**

```bash
git add -A
git commit -m "docs: lo que cambia al operar con la base y la app afuera

El worker no puede quedar encendido contra Neon: el plan gratuito se
agota solo aunque nadie use el sistema. Y la regla nueva que este bloque
introduce, que es la que más fácil se cree resuelta mirando que la
página redirige: proteger las páginas no protege las Server Actions.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

## Task 8: Desplegar — la parte que te toca a ti

**Esta tarea NO la puede hacer un agente**: exige crear cuentas con tus credenciales. Es una lista de comprobación, en orden, con lo que hay que pedir y dónde pegarlo.

- [ ] **Step 1: Neon**

Crea una cuenta en `neon.tech` y un proyecto con **Postgres 16**, en la región más cercana a donde vayas a desplegar Vercel.

Del panel copia **dos** cadenas de conexión, que son distintas:
- La **agrupada** (su anfitrión lleva `-pooler`): es la que va a Vercel.
- La **directa** (sin `-pooler`): es la que usarás para aplicar migraciones.

- [ ] **Step 2: Aplicar las migraciones a Neon**

Con `DATABASE_URL` apuntando temporalmente a la cadena **directa**, aplica las siete migraciones con el mismo mecanismo que usaste en la Task 1.

Comprueba que quedaron:

```bash
psql "<cadena directa>" -c "SELECT count(*) FROM __drizzle_migrations;"
```

Esperado: 7.

**Devuelve tu `.env` local a apuntar a `localhost`** cuando termines. Trabajar en desarrollo contra la base de producción es el accidente que este paso hace fácil.

- [ ] **Step 3: Google**

En `console.cloud.google.com`, crea un proyecto y dentro una **credencial de OAuth de tipo aplicación web**.

En "URIs de redirección autorizados" pon, por ahora, `http://localhost:3000/api/auth/callback/google`. Cuando Vercel te dé la dirección definitiva, vuelves y agregas `https://<tu-dominio>/api/auth/callback/google` — **son dos entradas, no se reemplaza una por otra**, para que puedas probar el inicio de sesión real en local.

Copia el identificador y el secreto.

- [ ] **Step 4: Vercel**

Crea el proyecto importando el repositorio, y configúralo así:

| Ajuste | Valor | Por qué |
|---|---|---|
| Root Directory | `apps/web` | La app no está en la raíz |
| Install Command | `cd ../.. && pnpm install` | El workspace se resuelve desde la raíz |
| Include files outside root | activado | Sin esto no llegan los paquetes de `packages/` |

Y las variables de entorno:

| Variable | Valor |
|---|---|
| `DATABASE_URL` | La cadena **agrupada** de Neon |
| `AUTH_SECRET` | Genérala con `openssl rand -base64 32` |
| `AUTH_GOOGLE_ID` / `AUTH_GOOGLE_SECRET` | Los del Step 3 |
| `CORREOS_PERMITIDOS` | Los dos o tres correos, separados por coma |

**`OPENROUTER_API_KEY` no va.** La web nunca llama al modelo, y ponerla donde no se usa es superficie regalada.

- [ ] **Step 5: Comprobar que funciona de verdad**

En la dirección que te dio Vercel:

1. Entrar con tu cuenta de Google → debe dejarte pasar.
2. Entrar con una cuenta **que no esté en la lista** → debe mostrar la pantalla que dice que no está autorizada, no un error genérico.
3. Crear una marca, cargarle el perfil, y comprobar que la pantalla del perfil funciona.
4. Aprobar una grilla y comprobar en la base que `approved_by` quedó con tu id:

```bash
psql "<cadena directa>" -c "SELECT cp.month, u.email FROM content_plans cp JOIN users u ON u.id = cp.approved_by;"
```

5. **La comprobación que no se puede saltar:** abre la app en una ventana privada, sin sesión, y confirma que te manda a `/entrar` en vez de mostrarte datos.

- [ ] **Step 6: Generar contra la base de producción**

Con el worker **local**, apuntando `DATABASE_URL` a la cadena directa de Neon y con tu clave de OpenRouter cargada, levanta el worker y encola una generación desde la web desplegada.

Esto comprueba de una sola vez las dos cosas que ninguna prueba puede: que el agrupador no rompió nada, y que el ciclo completo funciona con las piezas separadas.

**Baja el worker al terminar.** Es la costumbre nueva y es la que protege el plan gratuito.

---

## Verificación final de la rama

- [ ] **Las pruebas de dominio**

```bash
pnpm test 2>&1 | sed 's/\x1b\[[0-9;]*m//g' | grep -E 'RUN  v|Tests +[0-9]+ (passed|failed)'
```

Esperado: once paquetes, 418 pruebas, cero fallos.

- [ ] **El bundle y los guardianes**

```bash
pnpm -r typecheck && pnpm --filter @gc/web build && pnpm comprobar:aislamiento && pnpm comprobar:volumenes
```

Esperado: typecheck limpio; build con las rutas del dominio en `ƒ`; los dos guardianes en verde.

- [ ] **El uso real, en local**

Con `SESION_DE_DESARROLLO=true`, `pnpm --filter @gc/web dev` y la base local: que la app cargue, que aprobar una grilla registre a `desarrollo@local` en `approved_by`, y que poner la variable en `false` mande a `/entrar`. **Restaura la base de desarrollo si la modificas.**

- [ ] **Cerrar la rama**

Usa la skill `superpowers:finishing-a-development-branch`.

---

## Notas para quien ejecute

**El orden importa.** La Task 4 necesita la tabla de la Task 1 y las funciones puras de la Task 3. La Task 5 necesita `sesionActual` de la Task 4. La Task 6 necesita el `usuarioId` que la Task 5 agrega al ayudante. Las tareas 2 y 7 son independientes.

**Los conteos son acumulativos y orientativos:** 396 → 398 (T1) → 403 (T2) → 412 (T3) → 416 (T5) → 418 (T6). Las tareas 4, 7 y 8 no agregan pruebas. **Si necesitas una prueba más para que algo afirme de verdad lo que su nombre promete, escríbela** y dilo en el informe: el conteo sirve para detectar pasos saltados, no para mandar sobre la cobertura.

**La Task 5 es la que hay que revisar con más desconfianza.** Es el único defecto posible de este bloque que expone datos a internet, y es fácil de creer resuelto mirando que la página redirige. Su prueba mide la escritura y va en las dos direcciones por eso.

**Este plan tiene menos código exacto que los anteriores en la Task 4**, porque la configuración de Auth.js depende de la versión que instales y su API de v5 todavía se mueve. El código que está es el que quiero; si la biblioteca exige otra forma, seguir su documentación es lo correcto — pero **dilo en el informe** en vez de improvisar en silencio.
