# La base en Cloud SQL (1C-A2) — Plan de implementación

> **Para trabajadores agénticos:** SUB-SKILL REQUERIDA: usa `superpowers:subagent-driven-development` (recomendado) o `superpowers:executing-plans` para implementar este plan tarea por tarea. Los pasos usan casillas (`- [ ]`) para seguimiento.

**Objetivo:** que la base viva en Cloud SQL y que la app en Vercel la alcance por el conector de Google, sin abrir la base a internet ni pagar una IP fija.

**Arquitectura:** el driver pasa de `postgres-js` a `node-postgres`, porque el conector de Cloud SQL solo soporta ese. `crearConexion` gana un segundo camino: si hay una instancia de Cloud SQL configurada, conecta por el conector; si no, por URL como siempre. El desarrollo local, el CLI, el worker y las pruebas siguen apuntando a Docker y no tocan el conector nunca.

**Stack:** pnpm workspaces, TypeScript 5 ESM, Vitest 2.1 contra Postgres real, Next.js 15 App Router, Drizzle ORM, node-postgres, Cloud SQL, Vercel.

**Spec:** [2026-08-05-base-en-cloud-sql-design.md](../specs/2026-08-05-base-en-cloud-sql-design.md)

## Cómo está repartido este plan

**Dos tareas son tuyas** —la 1 y la 7— porque exigen tu cuenta de Google y tu proyecto de Vercel. Las otras cinco las hace un agente contra Postgres local, sin crear nada.

La **Task 1 es una prueba de humo que puede invalidar el diseño**, así que va primero de lo tuyo. Pero **no bloquea las tareas 2 y 4**: el cambio de driver sirve igual en los tres desenlaces posibles, porque `node-postgres` conecta por URL tan bien como por el conector. Lo único que la Task 1 gatilla es la **Task 3**.

O sea: puedes correr la Task 1 cuando quieras, en paralelo, mientras el agente avanza con el driver.

## Restricciones globales

Copiadas de `CLAUDE.md` y del spec. Aplican a **todas** las tareas.

- **`pnpm test` desde la raíz, NUNCA `pnpm -r test`.** Los once paquetes comparten la base de pruebas y cada prueba la vacía al empezar; en paralelo se pisan.
- **Un solo `.env`, en la raíz.** Ningún paquete tiene el suyo.
- **Una migración aplicada es inmutable.** Las siete que existen no se tocan. Este bloque no agrega ninguna.
- **La tenencia se verifica dentro de cada escritura:** `WHERE id = ? AND organization_id = ?`, `.returning()`, y `permanente` si no vuelve fila. El cambio de driver no puede debilitarla.
- **`esTransitorio` / `clasificarError` es el único punto donde se decide reintentar**, y clasifica por SQLSTATE leyendo `e.code` del driver. Cambiar de driver toca ese contrato de forma invisible para el typecheck.
- **Idioma:** esquema y columnas en inglés `snake_case`. API de dominio, variables, comentarios y **todo texto que ve el usuario** en español neutro latinoamericano (con "tú", nunca "vos").
- **La capa web nunca ejecuta trabajo largo ni llama al modelo.** `pnpm comprobar:aislamiento` y `pnpm comprobar:volumenes` corren en CI y deben seguir en verde.
- **Cada ruta de Next necesita su propio `export const dynamic = 'force-dynamic'`.** Verificar en el build que las cuatro rutas del dominio salgan con `ƒ` y no con `○`.
- **Una prueba que no puede fallar es peor que ninguna.** Este proyecto ya lleva **seis** casos encontrados. Cada prueba nueva se rompe a propósito y se confirma que se pone roja. **Restaura cada mutación** y comprueba `git status` al terminar.
- **Punto de partida:** rama `feat/despliegue-y-autenticacion` en `8109e83`, **450 pruebas en once paquetes** (`db` 32, `shared` 34, `ai` 29, `brand` 14, `pipeline` 20, `strategy` 70, `operaciones` 83, `web` 126, `flujos` 32, `cli` 3, `worker` 7). Confírmalo antes de empezar; si no suman 450, **detente y reporta**.
- **Antes de empezar cualquier tarea:** `docker compose up -d postgres`.
- La base de desarrollo (`gestor`) tiene `parcelas` con la grilla de `2026-09` en borrador, 12 slots, cero descartados, más `prueba-org`. Las pruebas usan `gestor_test`. **Si modificas `gestor`, restáurala.**

---

## Estructura de archivos

| Archivo | Responsabilidad |
|---|---|
| `packages/db/package.json` | Suma `pg` y `@types/pg`, quita `postgres` |
| `packages/db/src/cliente.ts` | El driver nuevo y los dos caminos de conexión |
| `packages/db/src/destino.ts` (nuevo) | `destinoDeConexion(env)`, función pura y probada |
| `packages/db/src/agrupador.ts` | **Se elimina**, con su prueba |
| `packages/operaciones/src/corridas.ts` | El `db.execute` que consume filas cambia de forma |
| `packages/db/drizzle.config.ts` | Sale `DATABASE_URL_DIRECTA` |
| `.env.example` | Las variables del conector; sale la de Neon |
| `CLAUDE.md` | El despliegue en Cloud SQL, y sale la regla del agrupador |
| `docs/superpowers/specs/pendientes.md` | La deuda que este bloque deja |

---

## Task 1 (TUYA): la prueba de humo del conector

**Esta tarea no la puede hacer un agente**: exige tu cuenta de Google. Y va primero porque **puede invalidar el diseño**.

El spec elige el conector de Node de Cloud SQL porque reemplaza la autorización por firewall con IAM. Su documentación describe el mecanismo —librería pura, sin binario local— pero **no afirma en ninguna parte que funcione dentro de una función serverless de Vercel**. Todo lo demás descansa en eso.

Es desechable: nada de lo que hagas aquí se queda en el repositorio.

- [ ] **Step 1: La instancia**

En `console.cloud.google.com`, crea una instancia de **Cloud SQL para PostgreSQL 16**, la más chica que ofrezca, en la región más cercana a donde despliegues Vercel.

Anota su **nombre de conexión**, que tiene la forma `proyecto:región:instancia`. No es el nombre que le pusiste: aparece en la ficha de la instancia.

Crea dentro una base llamada `gestor` y un usuario con contraseña.

**Deja la lista de redes autorizadas vacía.** Es el punto entero de esta prueba: si el conector funciona, nunca hace falta llenarla.

- [ ] **Step 2: La cuenta de servicio**

Crea una cuenta de servicio con el rol **Cloud SQL Client**. Descarga su clave en JSON.

Ese JSON es la credencial que Vercel va a usar. **No lo pegues en el repositorio ni en un chat**: va como variable de entorno en Vercel y nada más.

- [ ] **Step 3: La prueba local primero**

Antes de desplegar nada, comprueba que el conector alcanza tu instancia desde tu máquina. Es más rápido de diagnosticar y descarta la mitad de las causas posibles.

En una carpeta **fuera** del repositorio:

```bash
mkdir prueba-conector && cd prueba-conector
npm init -y && npm pkg set type=module
npm install @google-cloud/cloud-sql-connector pg
```

Crea `prueba.js`:

```js
import { Connector } from '@google-cloud/cloud-sql-connector'
import pg from 'pg'

const connector = new Connector()
const opciones = await connector.getOptions({
  instanceConnectionName: process.env.CLOUD_SQL_INSTANCIA,
  ipType: 'PUBLIC',
})

const pool = new pg.Pool({
  ...opciones,
  user: process.env.CLOUD_SQL_USUARIO,
  password: process.env.CLOUD_SQL_CLAVE,
  database: process.env.CLOUD_SQL_BASE,
  max: 1,
})

const { rows } = await pool.query('SELECT 1 AS uno, version() AS version')
console.log(rows)
await pool.end()
connector.close()
```

Córrelo con las cuatro variables y con `GOOGLE_APPLICATION_CREDENTIALS` apuntando al JSON de la cuenta de servicio.

Esperado: una fila con `uno: 1` y la versión de Postgres.

**Si falla aquí**, el problema es de permisos o de configuración de la instancia, no de Vercel. El mensaje suele decir cuál.

- [ ] **Step 4: La prueba que de verdad importa, en Vercel**

Lo anterior prueba tu instancia. Esto prueba el supuesto del diseño.

Crea un proyecto nuevo y desechable en Vercel —**no** el del gestor— con una sola ruta de API que devuelva el resultado como JSON. Un `app/api/prueba/route.js` con `export const runtime = 'nodejs'` alcanza.

**No es exactamente lo del Step 3, y la diferencia es el punto.** Allá las credenciales salen de `GOOGLE_APPLICATION_CREDENTIALS`, que espera **la ruta a un archivo**. En Vercel no hay archivos que poner: el JSON de la cuenta de servicio viaja en una variable de entorno y se le entrega al conector como objeto, por su opción `auth`:

```js
import { Connector } from '@google-cloud/cloud-sql-connector'
import { GoogleAuth } from 'google-auth-library'

const conector = new Connector({
  auth: new GoogleAuth({
    credentials: JSON.parse(process.env.GOOGLE_CREDENCIALES_JSON),
    scopes: ['https://www.googleapis.com/auth/sqlservice.admin'],
  }),
})
```

Ese es el camino que va a usar el gestor en producción, así que es el que hay que probar. Un `new Connector()` a secas cae a las credenciales por omisión, que en Vercel no existen.

Carga las cuatro variables más `GOOGLE_CREDENCIALES_JSON` con el contenido del JSON, y despliega.

**Lo que hay que observar, en orden:**

1. Que la ruta responda con la fila, no con un error.
2. Cuánto tarda la **primera** llamada después de un rato sin uso. El conector negocia certificados al arrancar, y si eso agrega varios segundos a cada arranque en frío, es un dato que cambia cómo se siente la app aunque no la rompa.
3. Que la lista de redes autorizadas de tu instancia **siga vacía**.

- [ ] **Step 5: Reportar**

Dime las tres observaciones. Según el resultado:

- **Funciona:** seguimos con la Task 3 tal como está escrita.
- **No funciona:** el diseño cambia y hay que volver al spec. Las alternativas son la IP fija de Vercel (USD 100 al mes, disponible en tu plan Pro) o la lista de redes abierta con SSL. **No sigas a la Task 3**; las tareas 2 y 4 valen igual.

Después **borra el proyecto desechable de Vercel** y la carpeta local.

---

## Task 2: El cambio de driver

Es la tarea más grande y la que más puede romper en silencio. No depende de la Task 1.

**Archivos:**
- Modificar: `packages/db/package.json`, `packages/db/src/cliente.ts`, `packages/operaciones/src/corridas.ts`, y los archivos de prueba que consuman el resultado de `db.execute`
- Test: la suite completa es la prueba de esta tarea

**Interfaces:**
- Consume: nada
- Produce: `BaseDeDatos` pasa a ser `NodePgDatabase<typeof esquema>`; `crearConexion(url)` mantiene su firma exacta

- [ ] **Step 1: Registrar el punto de partida**

```bash
docker compose up -d postgres && pnpm test 2>&1 | sed 's/\x1b\[[0-9;]*m//g' | grep -E 'RUN  v|Tests +[0-9]+ (passed|failed)'
```

Esperado: once paquetes, 450 en total. Si no suman 450, **detente y reporta**.

- [ ] **Step 2: Instalar el driver**

```bash
pnpm --filter @gc/db add pg
pnpm --filter @gc/db add -D @types/pg
```

Todavía **no** quites `postgres`: se quita cuando la suite esté verde, para poder volver atrás de un paso.

- [ ] **Step 3: Cambiar el cliente**

`packages/db/src/cliente.ts` queda así:

```ts
import { drizzle, type NodePgDatabase } from 'drizzle-orm/node-postgres'
import pg from 'pg'
import { esquema } from './esquema.js'

export type BaseDeDatos = NodePgDatabase<typeof esquema>

export function crearConexion(url: string): { db: BaseDeDatos; cerrar: () => Promise<void> } {
  // `pg` es CommonJS: la importación por defecto y después `pg.Pool` es la
  // forma que funciona desde ESM sin depender de la interoperabilidad de
  // nombres, que para este paquete no es estable entre versiones de Node.
  const pool = new pg.Pool({ connectionString: url, max: 5 })
  return { db: drizzle(pool, { schema: esquema }), cerrar: () => pool.end() }
}
```

Desaparece el `import { usaAgrupador }` y la opción `prepare`. Con `node-postgres` las sentencias preparadas funcionan distinto —no se nombran por omisión— así que la opción de `postgres-js` no tiene equivalente ni hace falta. `agrupador.ts` se elimina en la Task 4, no aquí: esta tarea deja de usarlo y nada más.

**`BaseDeDatos` es un alias**, así que los 36 archivos de diez paquetes que lo usan no cambian. Si alguno rompe, es porque dependía de algo específico de `postgres-js` y eso es un hallazgo: dilo en el informe en vez de arreglarlo al paso.

- [ ] **Step 4: Correr el typecheck y leer lo que se rompe**

```bash
pnpm -r typecheck
```

**Esperado: FALLA**, y lo que falle es la información más valiosa de esta tarea. El error que tiene que aparecer es sobre `db.execute()`.

**Con `postgres-js`, `db.execute()` devuelve las filas. Con `node-postgres` devuelve un `QueryResult` con `.rows` adentro.** Son 31 llamadas en el repositorio; la mayoría descarta el resultado y no cambia, pero las que lo consumen sí.

Encuéntralas todas:

```bash
grep -rn 'execute(' --include=*.ts packages apps | grep -v node_modules
```

Y **para cada una decide si consume el resultado o lo descarta**. Las que ya se conocen:

- `packages/operaciones/src/corridas.ts:237` — **producción**, la que toma la corrida pendiente con `FOR UPDATE SKIP LOCKED`. Pasa de `const filas = (await db.execute(sql\`...\`))` a desestructurar `rows`.
- `packages/db/src/pruebas/entorno.test.ts:45` — hace `(await db.execute(RESIDUOS)) as unknown as Conteo[]`.
- `packages/db/src/esquema.test.ts:732` — el catálogo de claves foráneas compuestas.

**Cuidado con las que llevan `as unknown as`.** Ese cast desactiva justo al `tsc` que debería avisarte: la línea sigue compilando y devuelve la forma equivocada. Las tres de arriba y cualquier otra que encuentres con ese patrón hay que mirarlas a mano, no confiar en que el typecheck las señale.

- [ ] **Step 5: Arreglar los consumidores**

En `packages/operaciones/src/corridas.ts`, alrededor de la línea 237:

```ts
  const { rows: filas } = await db.execute(sql`
    UPDATE pipeline_runs SET status = 'en_curso'
    ...
```

El resto del cuerpo no cambia. **No toques la consulta**: el `FOR UPDATE SKIP LOCKED`, la subconsulta correlacionada del slug y la comparación de organización se quedan exactamente como están; el comentario que las explica sigue siendo cierto.

En los archivos de prueba, el patrón es el mismo: desestructura `rows` y aplica el cast sobre eso, no sobre el resultado entero.

- [ ] **Step 6: La suite completa, y leerla con desconfianza**

```bash
pnpm -r typecheck && pnpm test 2>&1 | sed 's/\x1b\[[0-9;]*m//g' | grep -E 'RUN  v|Tests +[0-9]+ (passed|failed)'
```

Esperado: 450, sin fallos.

**Si alguna prueba falla, ese fallo es el producto de esta tarea, no un estorbo.** Dos drivers distintos pueden devolver lo mismo de formas distintas: cómo llega un `jsonb`, si un `numeric` viene como número o como cadena, cómo se materializa un `timestamptz`, cómo se representa un arreglo.

**Ajustar una prueba para que pase es un hallazgo que hay que explicar, no un trámite.** Por cada una que toques, escribe en el informe qué devolvía antes, qué devuelve ahora, y por qué el comportamiento nuevo es correcto y no una regresión disfrazada. Si no puedes explicarlo, **para y reporta**.

- [ ] **Step 7: La comprobación que ninguna prueba existente cubre**

`clasificarError` decide si reintentar leyendo `e.code` del error del driver, y es el **único** punto del sistema donde esa decisión se toma. Si `node-postgres` expone el SQLSTATE de otra forma, la taxonomía entera se rompe **y las pruebas sintéticas siguen verdes**, porque construyen objetos `{ code: '40001' }` a mano en vez de provocar un error real.

Comprueba si ya existe una prueba que provoque un error **real** de la base y lo clasifique. Búscala:

```bash
grep -rn 'esViolacionDeUnica\|clasificarError\|clasificarPostgres' --include=*.test.ts packages apps
```

**Si no existe, escríbela** en `packages/db/src/cliente.test.ts` (créalo si hace falta): provoca una violación de unicidad de verdad —insertar dos veces el mismo correo en `users` sirve— y afirma que `esViolacionDeUnica` del error atrapado devuelve `true`.

Confírmala con mutación: cambiar el código `'23505'` por otro tiene que ponerla roja.

Es la prueba que garantiza que el contrato entre el driver y la taxonomía de errores sobrevivió al cambio.

- [ ] **Step 8: Quitar el driver viejo**

```bash
pnpm --filter @gc/db remove postgres
pnpm -r typecheck && pnpm test 2>&1 | sed 's/\x1b\[[0-9;]*m//g' | grep -E 'Tests +[0-9]+ (passed|failed)'
```

Esperado: 450 o más (451 si escribiste la prueba del Step 7), sin fallos.

Si al quitarlo algo rompe, es que quedó un import de `postgres` en alguna parte. Búscalo con `grep -rn "from 'postgres'" --include=*.ts packages apps`.

- [ ] **Step 9: El build, los guardianes y el uso real**

```bash
pnpm --filter @gc/web build 2>&1 | sed 's/\x1b\[[0-9;]*m//g' | grep -E "^[┌├└].*(ƒ|○)|Middleware"
pnpm comprobar:aislamiento && pnpm comprobar:volumenes
```

Esperado: las cuatro rutas del dominio en `ƒ`, `/entrar` y `/api/auth` en `ƒ`, el middleware presente, los dos guardianes en verde.

Y el uso real, que es lo único que ve lo que ninguna prueba ve. Con `SESION_DE_DESARROLLO=true`, levanta la web, abre `/parcelas/grilla/2026-09`, aprueba la grilla, y comprueba en SQL que quedó registrada:

```bash
docker compose exec -T postgres psql -U postgres -d gestor -c "SELECT cp.status, u.email FROM content_plans cp LEFT JOIN users u ON u.id = cp.approved_by;"
```

**Restaura la base de desarrollo después:**

```bash
docker compose exec -T postgres psql -U postgres -d gestor -c "UPDATE content_plans SET status='borrador', approved_by=NULL, reopened_by=NULL; DELETE FROM users;"
```

- [ ] **Step 10: Commit**

```bash
git add -A
git commit -m "feat: la base habla por node-postgres en vez de postgres-js

El conector de Cloud SQL soporta pg y no postgres-js; para drivers no
soportados solo ofrece un proxy local por socket Unix, que no existe
dentro de una función serverless. O sea que el cambio de driver no es
una preferencia, es lo que el conector exige.

La onda expansiva resultó chica porque el paquete ya exportaba el alias
BaseDeDatos: los treinta y seis archivos que lo usan no se enteran.

Lo que sí cambió de forma es db.execute: postgres-js devuelve las filas
y node-postgres un QueryResult con rows adentro. Las llamadas que
descartan el resultado no cambian; las que lo consumen sí, y las que
llevaban un cast 'as unknown as' había que mirarlas a mano porque ese
cast desactiva al typecheck justo donde hacía falta.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

## Task 3: El camino por el conector

**Depende de que la Task 1 haya salido bien.** Si el conector no funciona en Vercel, esta tarea no se hace tal como está escrita: para y reporta.

**Archivos:**
- Crear: `packages/db/src/destino.ts`, `packages/db/src/destino.test.ts`
- Modificar: `packages/db/src/cliente.ts`, `packages/db/src/index.ts`, `packages/db/package.json`, `.env.example`

**Interfaces:**
- Consume: `crearConexion` de la Task 2
- Produce: `destinoDeConexion(env): Destino`, exportada desde `@gc/db`. `crearConexion()` pasa a no recibir argumentos y a resolver el destino del entorno.

- [ ] **Step 1: Escribir las pruebas que fallan**

La decisión de por dónde conectar es una función pura, como `usaAgrupador` y `correoPermitido`: recibe el entorno como parámetro en vez de leer `process.env` por dentro, y por eso se puede probar.

Crea `packages/db/src/destino.test.ts`:

```ts
import { describe, expect, it } from 'vitest'
import { destinoDeConexion } from './destino.js'

const CLOUD = {
  CLOUD_SQL_INSTANCIA: 'mi-proyecto:us-central1:gestor',
  CLOUD_SQL_USUARIO: 'app',
  CLOUD_SQL_CLAVE: 'secreta',
  CLOUD_SQL_BASE: 'gestor',
}

describe('destinoDeConexion', () => {
  it('sin instancia configurada conecta por URL', () => {
    const d = destinoDeConexion({ DATABASE_URL: 'postgres://x@localhost:5432/gestor' })
    expect(d.tipo).toBe('url')
  })

  it('con la instancia y sus datos conecta por el conector', () => {
    const d = destinoDeConexion({ ...CLOUD, DATABASE_URL: 'postgres://x@localhost:5432/gestor' })
    expect(d.tipo).toBe('cloud-sql')
  })

  it('la instancia gana sobre DATABASE_URL cuando están las dos', () => {
    // En Vercel van a convivir: DATABASE_URL puede quedar de un despliegue
    // anterior. Lo que manda es la instancia, y que sea explícito evita el
    // accidente de conectar a la base equivocada sin que nadie lo note.
    const d = destinoDeConexion({ ...CLOUD, DATABASE_URL: 'postgres://x@otra/base' })
    expect(d.tipo).toBe('cloud-sql')
  })

  it('una instancia incompleta falla en vez de caer a la URL', () => {
    // Es el caso peligroso: caer en silencio al camino de URL daría un error
    // sobre `localhost` en producción, que manda a diagnosticar la red
    // equivocada durante horas.
    expect(() => destinoDeConexion({ CLOUD_SQL_INSTANCIA: CLOUD.CLOUD_SQL_INSTANCIA })).toThrow(
      /CLOUD_SQL_USUARIO/,
    )
  })

  it('sin nada configurado dice qué falta', () => {
    expect(() => destinoDeConexion({})).toThrow(/DATABASE_URL/)
  })

  it('el nombre de instancia tiene que tener las tres partes', () => {
    // `proyecto:región:instancia`. Con dos partes el conector falla con un
    // mensaje mucho más oscuro que este.
    expect(() => destinoDeConexion({ ...CLOUD, CLOUD_SQL_INSTANCIA: 'proyecto:instancia' })).toThrow(
      /proyecto:región:instancia/,
    )
  })
})
```

- [ ] **Step 2: Correr y verificar que fallan**

Run: `pnpm --filter @gc/db test destino`
Esperado: FAIL con "Failed to resolve import ./destino.js".

- [ ] **Step 3: Implementar la decisión**

Crea `packages/db/src/destino.ts`:

```ts
/**
 * Por dónde conectarse a Postgres.
 *
 * En Vercel la app llega a Cloud SQL por el conector de Google, que autoriza
 * por IAM y deja la lista de redes de la instancia vacía. En cualquier otro
 * lado —tu máquina, el CLI, el worker, las pruebas— se conecta por URL a
 * Docker, como siempre.
 *
 * Recibe el entorno como parámetro en vez de leer `process.env` por dentro,
 * para que la decisión se pueda probar sin ensuciar el proceso de pruebas.
 */
export type Destino =
  | { tipo: 'url'; url: string }
  | {
      tipo: 'cloud-sql'
      instancia: string
      usuario: string
      clave: string
      base: string
      /** El JSON de la cuenta de servicio, tal cual, sin parsear. */
      credenciales: string
    }

export function destinoDeConexion(env: Record<string, string | undefined>): Destino {
  const instancia = env.CLOUD_SQL_INSTANCIA?.trim()

  if (!instancia) {
    const url = env.DATABASE_URL?.trim()
    if (!url) {
      throw new Error(
        'Falta DATABASE_URL. En local apunta al Postgres de Docker; en Vercel configura CLOUD_SQL_INSTANCIA y sus tres variables.',
      )
    }
    return { tipo: 'url', url }
  }

  // Si la instancia está pero le faltan datos, se falla acá. Caer en silencio
  // al camino de URL daría un error sobre `localhost` en producción, y eso
  // manda a diagnosticar la red equivocada.
  if (instancia.split(':').length !== 3) {
    throw new Error(
      `CLOUD_SQL_INSTANCIA tiene que ser "proyecto:región:instancia", y llegó "${instancia}".`,
    )
  }

  const faltantes = (
    [
      'CLOUD_SQL_USUARIO',
      'CLOUD_SQL_CLAVE',
      'CLOUD_SQL_BASE',
      // El JSON de la cuenta de servicio. Va como variable y no como archivo
      // porque en Vercel no hay dónde poner un archivo, y el conector acepta
      // las credenciales como objeto por su opción `auth`.
      'GOOGLE_CREDENCIALES_JSON',
    ] as const
  ).filter((nombre) => !env[nombre]?.trim())

  if (faltantes.length > 0) {
    throw new Error(
      `CLOUD_SQL_INSTANCIA está configurada, así que también hacen falta: ${faltantes.join(', ')}.`,
    )
  }

  return {
    tipo: 'cloud-sql',
    instancia,
    usuario: env.CLOUD_SQL_USUARIO!.trim(),
    clave: env.CLOUD_SQL_CLAVE!,
    base: env.CLOUD_SQL_BASE!.trim(),
    credenciales: env.GOOGLE_CREDENCIALES_JSON!,
  }
}
```

**Agrega una prueba más a las seis**: que con la instancia y sus datos pero **sin** `GOOGLE_CREDENCIALES_JSON` también falle nombrando la variable. Es el mismo caso peligroso que las otras tres, y sin ella el conector caería a las credenciales por omisión —que en Vercel no existen— y el fallo aparecería recién al desplegar.

Si el JSON viene mal formado, **no lo parsees aquí**: esta función decide el destino, no valida credenciales. Que reviente donde se usa, con el mensaje de `JSON.parse`, es más honesto que un error inventado a medio camino.

La clave **no** lleva `trim()` a propósito: un espacio al final de una contraseña es parte de la contraseña.

- [ ] **Step 4: Correr y verificar que pasan**

Run: `pnpm --filter @gc/db test destino`
Esperado: PASS, 6 pruebas.

- [ ] **Step 5: Confirmar que la que importa puede fallar**

Mutación: en `destinoDeConexion`, cambia el bloque de `faltantes` por nada —que devuelva el destino de Cloud SQL sin comprobar.
Esperado: FAIL en "una instancia incompleta falla en vez de caer a la URL".

**Restaura** y vuelve a correr: PASS.

- [ ] **Step 6: Conectar el conector**

```bash
pnpm --filter @gc/db add @google-cloud/cloud-sql-connector google-auth-library
```

> **La versión de `google-auth-library` no es libre, y equivocarla falla en silencio.**
>
> `sqladmin-fetcher.js` del conector decide así qué hacer con lo que le pasas en `auth`:
>
> ```js
> if (loginAuth instanceof GoogleAuth) { auth = loginAuth }
> else { auth = new GoogleAuth({ authClient: loginAuth, ... }) }
> ```
>
> Es un **`instanceof`**. Si tu `GoogleAuth` sale de una copia distinta de
> `google-auth-library` que la que resolvió el conector, la comprobación falla,
> tu objeto cae por la rama `authClient` —donde no es un `AuthClient` válido— y
> la petición sale **sin credenciales**. El error que llega es un 401 con el
> texto `Login Required`, que no menciona versiones ni copias duplicadas.
>
> Esto se comprobó en la prueba de humo: declarar `^9.15.0` mientras el
> conector exige `^10.6.2` instaló dos copias, y la conexión falló contra una
> instancia que desde la misma máquina funcionaba perfecto.
>
> **Declara el rango que el conector pide** —míralo en su `package.json`, no lo
> supongas— y **comprueba que resuelven a la misma copia** antes de dar la
> tarea por buena:
>
> ```bash
> node -e "console.log(require.resolve('google-auth-library') === require.resolve('google-auth-library',{paths:['./node_modules/@google-cloud/cloud-sql-connector']}))"
> ```
>
> Tiene que imprimir `true`. En pnpm, que aísla dependencias por diseño, esto
> merece una comprobación explícita y no un supuesto.

`packages/db/src/cliente.ts` pasa a resolver el destino:

```ts
import { Connector } from '@google-cloud/cloud-sql-connector'
import { drizzle, type NodePgDatabase } from 'drizzle-orm/node-postgres'
import { GoogleAuth } from 'google-auth-library'
import pg from 'pg'
import { destinoDeConexion } from './destino.js'
import { esquema } from './esquema.js'

export type BaseDeDatos = NodePgDatabase<typeof esquema>

export type Conexion = { db: BaseDeDatos; cerrar: () => Promise<void> }

/**
 * Abre la conexión que corresponda al entorno. Ver `destinoDeConexion`.
 *
 * `max: 5` es bajo a propósito: en Vercel cada invocación corre en su propio
 * proceso y abre su propio pool, así que el límite de conexiones de la
 * instancia se reparte entre todas las que estén vivas a la vez. El modo de
 * falla —agotar las conexiones— no aparece nunca en local.
 */
export async function crearConexion(): Promise<Conexion> {
  const destino = destinoDeConexion(process.env)

  if (destino.tipo === 'url') {
    const pool = new pg.Pool({ connectionString: destino.url, max: 5 })
    return { db: drizzle(pool, { schema: esquema }), cerrar: () => pool.end() }
  }

  // Las credenciales van como objeto y no por `GOOGLE_APPLICATION_CREDENTIALS`,
  // que espera una **ruta a un archivo**: en Vercel no hay archivos que poner.
  // El JSON de la cuenta de servicio viaja en una variable de entorno y se le
  // entrega al conector por su opción `auth`. Un `new Connector()` a secas cae
  // a las credenciales por omisión, que en Vercel no existen — y eso solo se
  // descubre desplegando.
  const conector = new Connector({
    auth: new GoogleAuth({
      credentials: JSON.parse(destino.credenciales),
      scopes: ['https://www.googleapis.com/auth/sqlservice.admin'],
    }),
  })
  const opciones = await conector.getOptions({
    instanceConnectionName: destino.instancia,
    ipType: 'PUBLIC',
  })

  const pool = new pg.Pool({
    ...opciones,
    user: destino.usuario,
    password: destino.clave,
    database: destino.base,
    max: 5,
  })

  return {
    db: drizzle(pool, { schema: esquema }),
    cerrar: async () => {
      await pool.end()
      conector.close()
    },
  }
}
```

**`crearConexion` pasa a ser asíncrona y a no recibir argumentos.** Eso toca sus cuatro llamadores:

- `apps/cli/src/main.ts` (línea 68)
- `apps/worker/src/main.ts` (línea 29)
- `packages/db/src/pruebas/entorno.ts` (línea 70)
- `apps/web/src/datos.ts` (línea 21) — **este es el delicado**: hoy cachea la conexión en `globalThis` de forma perezosa y síncrona. Con una conexión asíncrona hay que cachear **la promesa**, no el resultado, o dos peticiones simultáneas abren dos pools. Mira ese archivo antes de tocarlo y dilo en el informe si te obliga a algo que este plan no anticipa.

  **Que ese caché siga funcionando no es un detalle de rendimiento, y hay números.** Medido en la prueba de humo, contra la instancia real desde Vercel:

  | | construir el conector | primera consulta | total |
  |---|---|---|---|
  | Proceso nuevo | ~800 ms | ~760 ms | **~1,6 s** |
  | Proceso ya tibio | 0 ms | ~123 ms | **~123 ms** |

  O sea que perder el caché multiplica por trece el costo de cada petición. Y no es hipotético: en cinco llamadas seguidas, una cayó en un proceso nuevo — con tres personas usando el sistema, los arranques en frío son frecuentes, no raros.

Agrega a `packages/db/src/index.ts`, en orden alfabético:

```ts
export * from './destino.js'
```

- [ ] **Step 7: Las variables nuevas**

Agrega a `.env.example`:

```
# La base en Cloud SQL (bloque 1C-A2). En local NO se declaran: sin
# CLOUD_SQL_INSTANCIA la conexión usa DATABASE_URL y va a Docker, que es lo
# que quieres en tu máquina, en el CLI, en el worker y en las pruebas.
#
# Estas cuatro se cargan solo en Vercel. CLOUD_SQL_INSTANCIA es el nombre de
# conexión de la instancia, con la forma proyecto:región:instancia — no es el
# nombre que le pusiste, sale en la ficha de la instancia.
# CLOUD_SQL_INSTANCIA=
# CLOUD_SQL_USUARIO=
# CLOUD_SQL_CLAVE=
# CLOUD_SQL_BASE=
# GOOGLE_CREDENCIALES_JSON=
```

**Comentadas, no vacías.** Declararlas vacías es lo que rompió el arranque de un clon nuevo en la rama anterior: una variable vacía no es una variable ausente, y `??` no cae al respaldo con cadena vacía.

- [ ] **Step 8: Suite completa y commit**

```bash
pnpm -r typecheck && pnpm test 2>&1 | sed 's/\x1b\[[0-9;]*m//g' | grep -E 'Tests +[0-9]+ (passed|failed)' && pnpm --filter @gc/web build 2>&1 | sed 's/\x1b\[[0-9;]*m//g' | grep -E "^[┌├└].*(ƒ|○)"
```

Esperado: typecheck limpio, **452 pruebas** —445 más las 7 de `destino.test.ts`—, y las cuatro rutas del dominio en `ƒ`.

```bash
git add -A
git commit -m "feat: la conexión resuelve su destino y sabe llegar a Cloud SQL

En Vercel se conecta por el conector de Google, que autoriza por IAM y
deja la lista de redes de la instancia vacía. En cualquier otro lado
—tu máquina, el CLI, el worker, las pruebas— sigue conectando por URL a
Docker, sin tocar el conector nunca.

La decisión es una función pura y probada, y falla ruidosamente si la
instancia está configurada a medias. Caer en silencio al camino de URL
daría un error sobre localhost en producción, que manda a diagnosticar
la red equivocada.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

## Task 4: Eliminar lo que quedó describiendo a Neon

No depende de la Task 1 ni de la 3.

`agrupador.ts` detecta el sufijo `-pooler` en el anfitrión, que es la convención de Neon. Cloud SQL no la tiene, así que la función devolvería `false` siempre. Y desde la Task 2 ya no la llama nadie.

Código que nunca se ejecuta y que además afirma cosas falsas sobre el despliegue es peor que no tenerlo: la próxima persona lo lee y concluye que hay un agrupador en juego.

**Archivos:**
- Eliminar: `packages/db/src/agrupador.ts`, `packages/db/src/agrupador.test.ts`
- Modificar: `packages/db/src/index.ts`, `packages/db/drizzle.config.ts`, `.env.example`

- [ ] **Step 1: Comprobar que de verdad no lo usa nadie**

```bash
grep -rn 'usaAgrupador\|agrupador' --include=*.ts packages apps | grep -v node_modules
```

Esperado: solo los dos archivos que vas a borrar y la línea del barril. **Si aparece otro consumidor, para y reporta**: significa que la Task 2 dejó algo a medias.

- [ ] **Step 2: Eliminar**

Borra los dos archivos y la línea `export * from './agrupador.js'` de `packages/db/src/index.ts`.

- [ ] **Step 3: Sacar `DATABASE_URL_DIRECTA`**

`packages/db/drizzle.config.ts` vuelve a leer `DATABASE_URL` a secas. Esa variable separaba las dos cadenas de Neon —la agrupada y la directa— y Cloud SQL no tiene esa división: las migraciones se aplican por el Auth Proxy, que es la Task 5.

Quita también su bloque de `.env.example`, con el comentario que la explicaba.

- [ ] **Step 4: Suite completa y commit**

```bash
pnpm -r typecheck && pnpm test 2>&1 | sed 's/\x1b\[[0-9;]*m//g' | grep -E 'Tests +[0-9]+ (passed|failed)'
```

Esperado: typecheck limpio, **449 o 450** pruebas — bajan las 7 de `agrupador.test.ts`, según si la Task 2 sumó la del SQLSTATE.

```bash
git add -A
git commit -m "refactor: fuera lo que solo describía a Neon

agrupador.ts detectaba el sufijo -pooler del anfitrión, que es la
convención de Neon; Cloud SQL no la tiene y desde el cambio de driver no
lo llamaba nadie. DATABASE_URL_DIRECTA separaba dos cadenas que Cloud
SQL tampoco tiene.

Código que nunca se ejecuta y que afirma cosas falsas sobre el
despliegue es peor que no tenerlo: quien lo lea concluye que hay un
agrupador en juego.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

## Task 5: Las migraciones por el Auth Proxy

drizzle-kit corre fuera de la app y no usa el conector. El camino es el **Cloud SQL Auth Proxy** local: levanta un escucha en `localhost` que tuneliza hacia la instancia autenticando por IAM, y drizzle-kit se conecta a ese `localhost` con una cadena normal.

Esta tarea es casi toda documentación, pero es la operación que se hace pocas veces y siempre bajo presión, así que tiene que quedar escrita paso a paso.

**Archivos:**
- Modificar: `CLAUDE.md`

- [ ] **Step 1: Comprobar qué hace hoy el comando**

Lee `packages/db/package.json` y confirma el nombre real del script de migraciones y qué ejecuta. **No inventes el comando**: en la rama anterior `.env.example` nombró uno que no existía.

- [ ] **Step 2: Escribirlo en `CLAUDE.md`**

En la sección de Entorno, donde hoy se explica que Postgres vive en dos lugares, agrega el procedimiento. Tiene que decir, en este orden: que se descarga el Auth Proxy, que se levanta apuntando al nombre de conexión de la instancia, que queda escuchando en un puerto local, que `DATABASE_URL` apunta a ese puerto **solo mientras dure la operación**, y que hay que devolverla a `localhost:5432` al terminar.

Ese último punto no es adorno: trabajar en desarrollo contra la base de producción es el accidente que este procedimiento hace fácil.

**Escribe solo lo que puedas comprobar.** El nombre del binario y la forma exacta de sus argumentos búscalos en la documentación de Google, no de memoria. Si algo no lo puedes verificar, dilo en el informe en vez de escribirlo con confianza.

- [ ] **Step 3: Commit**

```bash
git add -A
git commit -m "docs: cómo se aplican las migraciones contra Cloud SQL

drizzle-kit corre fuera de la app y no usa el conector, así que va por el
Auth Proxy local. Queda escrito paso a paso porque es una operación que
se hace pocas veces y siempre con prisa, incluido devolver DATABASE_URL
a localhost al terminar: trabajar contra la base de producción sin
darse cuenta es el accidente que este procedimiento hace fácil.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

## Task 6: La documentación de lo que cambió

**Archivos:**
- Modificar: `CLAUDE.md`, `docs/superpowers/specs/pendientes.md`, `docs/superpowers/plans/2026-08-04-despliegue-y-autenticacion.md`

`CLAUDE.md` es el documento que otro agente lee al empezar y del que se fía **sin verificar**. En la rama anterior afirmó cosas falsas **cuatro veces**, dos de ellas sobre el mismo párrafo y en direcciones opuestas. **Comprueba cada afirmación en el código o en la salida de un comando antes de escribirla.**

- [ ] **Step 1: Lo que hay que quitar o corregir**

Lee `CLAUDE.md` **completo** con esta rama en la mano. Lo que este bloque volvió falso:

- La regla no negociable sobre el agrupador de Neon y las sentencias preparadas. **El archivo ya no existe.**
- Todo lo que hable de Neon como destino de la base: las dos cadenas de conexión, el plan gratuito, las 190 horas, la suspensión por inactividad.
- El párrafo del worker contra Neon. El costo sigue existiendo pero por otro motivo: **Cloud SQL no se apaga sola y se factura las 24 horas**, así que el worker encendido ya no es lo que agota nada — la instancia corre igual. Eso hay que reescribirlo, no borrarlo.
- Cualquier mención al driver: el proyecto ya no usa `postgres-js`.
- Los conteos, si el archivo los tiene.

- [ ] **Step 2: Lo que hay que agregar**

- Que la base de producción es Cloud SQL y la app llega por el conector, con la lista de redes **vacía** — y por qué eso es la garantía, no un detalle.
- Que en local no se declara ninguna variable de Cloud SQL: sin `CLOUD_SQL_INSTANCIA` todo va a Docker por `DATABASE_URL`.
- Que **la instancia se factura corriendo, use alguien el sistema o no**. Es la diferencia de operación más grande respecto de lo que la rama documentaba, y tiene que estar donde alguien la lea.
- Que `max: 5` en el pool es bajo a propósito, porque cada invocación de Vercel abre el suyo.

- [ ] **Step 3: `pendientes.md`**

Agrega, en "Prioridad 2 — deuda real, sin urgencia":

1. **IAM database authentication en vez de contraseña.** El conector soporta las dos; se eligió contraseña porque IAM obliga a que el usuario de la base sea un principal de Google, y eso complica el CLI y el worker corriendo en una máquina local. Endurecimiento posterior, no deuda urgente.
2. **El worker sigue local.** Moverlo a Google es el bloque 1C-B, y ahí la salida es Cloud Scheduler despertando un trabajo en vez del sondeo cada dos segundos.
3. **No hay agrupador de conexiones.** El Managed Connection Pooling de Cloud SQL exige edición Enterprise Plus. Con tres personas no hace falta; el día que haga falta, esa es la palanca.

Y **revisa las entradas que este bloque volvió obsoletas**: las que hablen de Neon, del agrupador o de las dos cadenas de conexión ya no aplican.

- [ ] **Step 4: La Task 8 del plan anterior**

`docs/superpowers/plans/2026-08-04-despliegue-y-autenticacion.md` tiene una Task 8 que es una lista para el dueño, escrita para Neon. **Está obsoleta y hay que decirlo en el propio archivo**, apuntando a este plan — no la borres: es el registro de por qué las cosas son como son, y borrarlo pierde el motivo del cambio.

- [ ] **Step 5: Commit**

```bash
git add -A
git commit -m "docs: la base es Cloud SQL, no Neon

Sale la regla del agrupador —el archivo ya no existe— y sale todo lo que
describía el plan gratuito de Neon. Entra lo que de verdad cambia al
operar: que la app llega por el conector con la lista de redes vacía,
que en local no se declara ninguna variable de Cloud SQL, y que la
instancia se factura corriendo aunque nadie use el sistema.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

## Task 7 (TUYA): crear todo y desplegar

**Esta tarea no la puede hacer un agente.** La Task 1 ya te dejó la instancia y la cuenta de servicio; esto es lo que falta.

- [ ] **Step 1: Aplicar las migraciones**

Con el Auth Proxy levantado según el procedimiento que la Task 5 dejó en `CLAUDE.md`, aplica las siete migraciones.

Comprueba que quedaron:

```bash
psql "postgres://usuario:clave@localhost:PUERTO/gestor" -c "SELECT count(*) FROM __drizzle_migrations;"
```

Esperado: 7.

**Devuelve tu `.env` local a `localhost:5432`** cuando termines.

- [ ] **Step 2: La app de OAuth en Google**

Si ya la creaste para el bloque anterior, sirve igual. Si no: una credencial de OAuth de tipo aplicación web, con **dos** URIs de redirección —`http://localhost:3000/api/auth/callback/google` y `https://<tu-dominio>/api/auth/callback/google`—, no una reemplazando a la otra.

- [ ] **Step 3: Vercel**

Importa el repositorio con `apps/web` como Root Directory, `cd ../.. && pnpm install` como Install Command, y "Include files outside root" activado.

Variables de entorno:

| Variable | Valor |
|---|---|
| `CLOUD_SQL_INSTANCIA` | El nombre de conexión, `proyecto:región:instancia` |
| `CLOUD_SQL_USUARIO` / `CLOUD_SQL_CLAVE` / `CLOUD_SQL_BASE` | Los de la instancia |
| `GOOGLE_CREDENCIALES_JSON` | El contenido del JSON de la cuenta de servicio, en **una sola línea**. `vercel env add` lee una línea de la entrada estándar, así que un JSON con saltos se trunca en silencio |
| `AUTH_SECRET` | Genérala con `openssl rand -base64 32` |
| `AUTH_GOOGLE_ID` / `AUTH_GOOGLE_SECRET` | Los del Step 2 |
| `CORREOS_PERMITIDOS` | Los dos o tres correos, separados por coma |

**`DATABASE_URL` no va**, y `OPENROUTER_API_KEY` tampoco: la web nunca llama al modelo.

- [ ] **Step 4: Comprobar que funciona de verdad**

1. Entrar con tu cuenta → debe dejarte pasar.
2. Entrar con una cuenta **fuera de la lista** → la pantalla que dice que no está autorizada, no un error genérico.
3. Sin sesión, en una ventana privada → debe mandarte a `/entrar`, y esa pantalla **no debe mostrar ningún nombre de marca**.
4. Aprobar una grilla y comprobar el autor:

```bash
psql "postgres://usuario:clave@localhost:PUERTO/gestor" -c "SELECT cp.month, u.email FROM content_plans cp JOIN users u ON u.id = cp.approved_by;"
```

5. Confirmar que la **lista de redes autorizadas de la instancia sigue vacía**. Es la garantía del diseño; si algo la llenó, hay que entender qué.

---

## Verificación final de la rama

- [ ] **Las pruebas de dominio**

```bash
pnpm test 2>&1 | sed 's/\x1b\[[0-9;]*m//g' | grep -E 'RUN  v|Tests +[0-9]+ (passed|failed)'
```

Esperado: once paquetes, **449 o 450** pruebas, cero fallos. El número exacto depende de si la Task 2 necesitó la prueba del SQLSTATE; lo que no puede pasar es que baje de ahí.

- [ ] **El bundle y los guardianes**

```bash
pnpm -r typecheck && pnpm --filter @gc/web build && pnpm comprobar:aislamiento && pnpm comprobar:volumenes
```

- [ ] **Que no quede rastro del driver ni del proveedor viejos**

```bash
grep -rn "postgres-js\|from 'postgres'\|neon\|Neon\|-pooler" --include=*.ts --include=*.json --include=*.md . | grep -v node_modules | grep -v docs/superpowers
```

Esperado: nada fuera de `docs/superpowers/`, que es el registro histórico y **se conserva**.

- [ ] **El uso real, en local**

Con `SESION_DE_DESARROLLO=true` y la base de Docker: que la app cargue, que aprobar una grilla registre a `desarrollo@local`, y que con la variable en `false` mande a `/entrar`. **Restaura la base de desarrollo.**

- [ ] **Cerrar la rama**

Usa la skill `superpowers:finishing-a-development-branch`.

---

## Notas para quien ejecute

**El orden y las dependencias.** La Task 3 necesita que la Task 1 haya salido bien y que la Task 2 esté hecha. La Task 4 necesita la Task 2. Las tareas 2 y 4 no dependen de la Task 1 en absoluto: el cambio de driver sirve igual en los tres desenlaces posibles de la prueba de humo.

**Los conteos son acumulativos y orientativos:** 450 → 450 o 451 (T2, según si hacía falta la prueba del SQLSTATE) → 456 o 457 (T3, suma las 6 de `destino.test.ts`) → 449 o 450 (T4, bajan las **7** de `agrupador.test.ts` — contadas, no estimadas). **Si necesitas una prueba más para que algo afirme de verdad lo que su nombre promete, escríbela** y dilo en el informe.

**La Task 2 es la que hay que revisar con más desconfianza**, y no por el typecheck. Los tipos los cubre el compilador; lo que no cubre es que dos drivers devuelvan lo mismo de formas distintas. Los tres puntos donde eso muerde son `db.execute()` —que cambia de forma—, los casts `as unknown as` que desactivan al compilador justo ahí, y `clasificarError`, que lee `e.code` del driver y es el único punto del sistema donde se decide reintentar.

**Una prueba ajustada para que pase es un hallazgo, no un trámite.** Si en la Task 2 hay que tocar una prueba, el informe tiene que decir qué devolvía antes, qué devuelve ahora, y por qué lo nuevo es correcto.
