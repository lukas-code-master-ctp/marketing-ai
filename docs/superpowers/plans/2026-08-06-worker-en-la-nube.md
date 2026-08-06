# El worker fuera de la máquina local — plan de implementación (bloque 1C-B)

> **Para quien ejecute esto:** SUB-SKILL OBLIGATORIA: usa `superpowers:subagent-driven-development` (recomendada) o `superpowers:executing-plans` para implementar tarea por tarea. Los pasos usan casillas (`- [ ]`) para llevar la cuenta.

**Objetivo:** que el worker corra en Cloud Run, despertado por Cloud Tasks desde la web, para que generar contenido deje de depender de que una máquina local esté encendida.

**Arquitectura:** el worker deja de ser un bucle de sondeo y pasa a ser un servidor HTTP con una ruta, `POST /trabajar`, que drena la cola de `pipeline_runs` y responde. La web crea una tarea de Cloud Tasks al encolar; Cloud Tasks llama a Cloud Run con un token OIDC y espera los minutos que dure la generación. Cloud Scheduler llama a la misma ruta cada cinco minutos como red de seguridad. `tomarYEjecutarUna` —donde vive todo lo probado del worker— no se toca.

**Tecnologías:** Node 22, TypeScript ESM, `node:http`, Vitest 2.1 contra Postgres real, Cloud Run, Cloud Tasks, Cloud Scheduler, Artifact Registry, Secret Manager, federación de identidad de carga de trabajo (WIF), GitHub Actions.

**Spec:** [2026-08-06-worker-en-la-nube-design.md](../specs/2026-08-06-worker-en-la-nube-design.md)

---

## Tres correcciones al spec, encontradas al escribir este plan

Van arriba porque cambian requisitos, no detalles.

**1. Son seis variables nuevas, no cinco.** El §«Autorización» del spec exige un token compartido en una cabecera, y quien crea la tarea tiene que mandarlo. La sexta es `WORKER_TOKEN`. (`GOOGLE_CREDENCIALES_JSON` no se suma: se reutiliza la que ya existe.)

**2. `GOOGLE_CREDENCIALES_JSON` no puede volverse opcional a secas.** El spec dice «si falta, toma las del entorno». Hacerlo así pierde una garantía que hoy existe y está probada: en Vercel **no hay** identidad de Google adherida, así que olvidar esa variable pasaría de un error legible —«hacen falta: GOOGLE_CREDENCIALES_JSON»— a un fallo oscuro de credenciales por omisión, recién al desplegar. La versión correcta es **opcional solo donde hay identidad adherida**, y eso se detecta con `K_SERVICE`, que Cloud Run define en toda revisión y nadie más define. Así Cloud Run funciona sin la clave y Vercel conserva su error bueno.

**3. `drenarCola` necesita un límite por petición.** Sin él, cien corridas encoladas se atienden en una sola petición y revientan el tiempo de espera de Cloud Run a mitad de una generación, dejándola `en_curso` para siempre — el mismo modo de falla que el §«Los dos límites de tiempo» viene a evitar. Con límite, el turno corta limpio y la red de seguridad se lleva el resto cinco minutos después. El límite **se registra en el log** cuando se alcanza: un recorte silencioso se lee como «no había más trabajo».

---

## Restricciones globales

Cada una ya es regla del proyecto (`CLAUDE.md`) y aplica a **todas** las tareas:

- **`pnpm test` en la raíz, NUNCA `pnpm -r test`.** Los paquetes comparten la base de pruebas y cada prueba la vacía al empezar.
- **Un solo `.env`, en la raíz.** Ningún paquete tiene el suyo.
- **Idioma:** esquema y columnas en inglés `snake_case`; API de dominio, variables, comentarios y todo texto que ve el usuario, en español.
- **La capa web nunca ejecuta trabajo largo ni llama al modelo.** Crear una tarea de Cloud Tasks no es trabajo largo; drenar la cola sí, y por eso no vive ahí.
- **`@gc/ai` es inalcanzable desde `apps/web`.** `@gc/despertador` entra al cierre de dependencias de la web, así que **no puede** declarar `@gc/ai`, `@gc/pipeline` ni `@gc/flujos`. Lo vigila `pnpm comprobar:aislamiento`.
- **Cada paquete nuevo del workspace necesita su volumen en `docker-compose.yml`.** Lo vigila `pnpm comprobar:volumenes`.
- **Una prueba que no puede fallar es peor que ninguna.** Al escribir una prueba de regresión, rompe el código a propósito y confirma que se pone roja.
- **Ninguna salida del modelo se parsea con expresiones regulares.** No aplica a este bloque, pero sigue vigente.
- **Node 22+, TypeScript ESM.** Los imports relativos llevan extensión `.js`.

**Comandos de verificación** (los tres, siempre, antes de commitear):

```bash
pnpm test
```

```bash
pnpm -r typecheck
```

```bash
pnpm comprobar:aislamiento && pnpm comprobar:volumenes
```

---

## Estructura de archivos

**Crear:**

| Archivo | Responsabilidad |
|---|---|
| `apps/worker/src/drenar.ts` | `drenarCola`: llama a `tomarYEjecutarUna` hasta vaciar, con límite y recuento |
| `apps/worker/src/drenar.test.ts` | pruebas de lo anterior, contra Postgres real |
| `apps/worker/src/servidor.ts` | el servidor HTTP: ruta única, token compartido, traducción a códigos |
| `apps/worker/src/servidor.test.ts` | pruebas del servidor sobre un puerto efímero |
| `apps/worker/Dockerfile.produccion` | la imagen que va a Cloud Run: copia el código, no lo monta |
| `packages/despertador/package.json` | manifiesto de `@gc/despertador` |
| `packages/despertador/tsconfig.json` | idem |
| `packages/despertador/vitest.config.ts` | idem |
| `packages/despertador/src/index.ts` | barril del paquete |
| `packages/despertador/src/destino.ts` | función pura: el entorno decide si hay a quién despertar |
| `packages/despertador/src/destino.test.ts` | pruebas de la función pura |
| `packages/despertador/src/despertar.ts` | la llamada a Cloud Tasks, de mejor esfuerzo |
| `packages/despertador/src/despertar.test.ts` | que sin configuración no hace nada ni construye cliente |

**Modificar:**

| Archivo | Cambio |
|---|---|
| `packages/db/src/destino.ts` | `GOOGLE_CREDENCIALES_JSON` opcional **solo** con `K_SERVICE` presente |
| `packages/db/src/destino.test.ts` | reemplazar la prueba que exigía la variable siempre |
| `packages/db/src/cliente.ts` | `GoogleAuth` sin `credentials` cuando el destino trae `null` |
| `apps/worker/src/main.ts` | de bucle a servidor; el sondeo queda tras `SONDEO_MS` |
| `apps/web/src/acciones.ts` | despertar tras las tres acciones que encolan |
| `apps/web/package.json` | agregar `@gc/despertador` |
| `apps/cli/src/main.ts` | despertar tras `corrida:reanudar` |
| `apps/cli/package.json` | agregar `@gc/despertador` |
| `docker-compose.yml` | volumen `nm-despertador`, `SONDEO_MS`, puerto del worker |
| `.dockerignore` | que la imagen de producción no copie `node_modules` ni `.git` |
| `.github/workflows/ci.yml` | trabajo de despliegue con `needs: test` |
| `.env.example` | las seis variables nuevas |
| `CLAUDE.md` | arquitectura, comandos y operación del worker en la nube |
| `docs/superpowers/specs/pendientes.md` | cerrar los puntos 2 y 4 de 1C-A2; descartar el apagado automático |

---

## Task 1: `GOOGLE_CREDENCIALES_JSON` deja de ser obligatoria donde hay identidad adherida

**Archivos:**
- Modificar: `packages/db/src/destino.ts`
- Modificar: `packages/db/src/cliente.ts:73-84`
- Prueba: `packages/db/src/destino.test.ts`

**Interfaces:**
- Consume: nada de otras tareas.
- Produce: `Destino` con `credenciales: string | null` en la variante `cloud-sql`. `null` significa «usa las credenciales del entorno». Lo consumen `crearConexion` y nadie más.

**Por qué esta tarea va primera:** sin ella, desplegar en Cloud Run exigiría copiar la clave de la cuenta de servicio a una variable de entorno más — justo la clave que `pendientes.md` ya registra como no rotada tras haber estado en un proyecto desechable.

- [ ] **Paso 1: escribir las pruebas que fallan**

En `packages/db/src/destino.test.ts`, **reemplaza** la prueba `'con la instancia y sus datos pero sin GOOGLE_CREDENCIALES_JSON también falla nombrando la variable'` por estas tres. No la borres sin más: la primera de las tres conserva su garantía.

```ts
  it('sin GOOGLE_CREDENCIALES_JSON y sin identidad adherida sigue fallando nombrando la variable', () => {
    // La garantía original, intacta para Vercel: allá NO hay cuenta de
    // servicio adherida al entorno, así que caer a las credenciales por
    // omisión daría un fallo oscuro recién al desplegar. Este error se lee.
    const { GOOGLE_CREDENCIALES_JSON: _omitida, ...sinCredenciales } = CLOUD
    expect(() => destinoDeConexion(sinCredenciales)).toThrow(/GOOGLE_CREDENCIALES_JSON/)
  })

  it('sin GOOGLE_CREDENCIALES_JSON pero dentro de Cloud Run usa las credenciales del entorno', () => {
    // `K_SERVICE` la define Cloud Run en toda revisión y no la define nadie
    // más. Ahí sí hay una cuenta de servicio adherida al servicio, así que
    // exigir el JSON obligaría a copiar la clave a una variable más.
    const { GOOGLE_CREDENCIALES_JSON: _omitida, ...sinCredenciales } = CLOUD
    const d = destinoDeConexion({ ...sinCredenciales, K_SERVICE: 'worker' })
    expect(d).toMatchObject({ tipo: 'cloud-sql', credenciales: null })
  })

  it('con GOOGLE_CREDENCIALES_JSON manda el JSON aunque esté en Cloud Run', () => {
    // La variable explícita gana: si alguien la carga a propósito, es porque
    // quiere esa identidad y no la del servicio.
    const d = destinoDeConexion({ ...CLOUD, K_SERVICE: 'worker' })
    expect(d).toMatchObject({ credenciales: '{"type":"service_account"}' })
  })
```

- [ ] **Paso 2: correr y ver que fallan**

```bash
pnpm --filter @gc/db test -- destino
```

Esperado, y conviene leerlo con cuidado porque las tres se comportan distinto:

- `'sin GOOGLE_CREDENCIALES_JSON y sin identidad adherida…'` — **PASA ya**. Es la garantía actual, reescrita con otro nombre; queda para que el cambio no se la lleve por delante.
- `'sin GOOGLE_CREDENCIALES_JSON pero dentro de Cloud Run…'` — **FALLA** con `CLOUD_SQL_INSTANCIA está configurada, así que también hacen falta: GOOGLE_CREDENCIALES_JSON.` Es la única que exige código nuevo.
- `'con GOOGLE_CREDENCIALES_JSON manda el JSON aunque esté en Cloud Run'` — **PASA ya**, porque hoy `K_SERVICE` no se mira. Queda como guarda de que el cambio no invierte la precedencia.

Una sola prueba roja de tres es lo correcto aquí: dos de ellas fijan comportamiento que ya existe y que este cambio **no debe** alterar.

- [ ] **Paso 3: cambiar el tipo y la función**

En `packages/db/src/destino.ts`, cambia la variante `cloud-sql` del tipo:

```ts
  | {
      tipo: 'cloud-sql'
      instancia: string
      usuario: string
      clave: string
      base: string
      /**
       * El JSON de la cuenta de servicio, tal cual, sin parsear — o `null`
       * para que el conector tome las credenciales del entorno.
       *
       * `null` solo ocurre dentro de Cloud Run, que adhiere una cuenta de
       * servicio al servicio y la expone por su servidor de metadatos. En
       * Vercel no existe esa identidad, y por eso allá la variable sigue
       * siendo obligatoria: ver la comprobación de `K_SERVICE` más abajo.
       */
      credenciales: string | null
    }
```

Reemplaza el bloque `faltantes` (líneas 51-67) por:

```ts
  // `K_SERVICE` la define Cloud Run en toda revisión, y no la define ningún
  // otro entorno de los que este repositorio usa. Es la señal de que hay una
  // cuenta de servicio adherida al proceso, y por lo tanto de que el JSON
  // sobra. Donde no está —Vercel, tu máquina— el JSON sigue siendo la única
  // forma de autenticar, así que su ausencia se reporta como error legible en
  // vez de dejar que el conector caiga a unas credenciales por omisión que no
  // existen: ese fallo aparecería recién al desplegar y no menciona variables.
  const dentroDeCloudRun = Boolean(env.K_SERVICE?.trim())
  const credenciales = env.GOOGLE_CREDENCIALES_JSON?.trim() ? env.GOOGLE_CREDENCIALES_JSON! : null

  const requeridas = ['CLOUD_SQL_USUARIO', 'CLOUD_SQL_CLAVE', 'CLOUD_SQL_BASE']
  if (!dentroDeCloudRun) requeridas.push('GOOGLE_CREDENCIALES_JSON')

  const faltantes = requeridas.filter((nombre) => !env[nombre]?.trim())

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
    credenciales,
  }
}
```

- [ ] **Paso 4: que `crearConexion` sepa qué hacer con `null`**

En `packages/db/src/cliente.ts`, reemplaza el bloque del conector (líneas 73-84) por:

```ts
  // Las credenciales van como objeto y no por `GOOGLE_APPLICATION_CREDENTIALS`,
  // que espera una **ruta a un archivo**: en Vercel no hay archivos que poner.
  // El JSON de la cuenta de servicio viaja en una variable de entorno y se le
  // entrega al conector por su opción `auth`.
  //
  // Con `credenciales === null` —o sea, dentro de Cloud Run— se construye el
  // `GoogleAuth` **sin** `credentials`, y la librería resuelve por el servidor
  // de metadatos la cuenta adherida al servicio. Lo que NO se puede hacer es
  // saltarse el `GoogleAuth` y pasar `new Connector()` a secas: el conector
  // decide si usa lo que le dan con `loginAuth instanceof GoogleAuth`, así que
  // sin ese objeto la petición sale sin credenciales y responde
  // `401 Login Required` sin mencionar nada de esto. Ver la regla no
  // negociable de `CLAUDE.md` sobre la copia única de `google-auth-library`.
  const conector = new Connector({
    auth: new GoogleAuth({
      ...(destino.credenciales !== null
        ? { credentials: JSON.parse(destino.credenciales) }
        : {}),
      scopes: ['https://www.googleapis.com/auth/sqlservice.admin'],
    }),
  })
```

- [ ] **Paso 5: correr las pruebas y ver que pasan**

```bash
pnpm test
```

Esperado: todo verde, incluida `packages/db/src/resolucion-google-auth-library.test.ts`, que no cambia.

- [ ] **Paso 6: mutar el código y confirmar que la prueba se pone roja**

Cambia a mano `const dentroDeCloudRun = Boolean(env.K_SERVICE?.trim())` por `= true` y corre `pnpm --filter @gc/db test -- destino`. **Tiene que fallar** la prueba `'sin GOOGLE_CREDENCIALES_JSON y sin identidad adherida sigue fallando nombrando la variable'`. Si pasa, la prueba no cubre nada y hay que arreglarla antes de seguir. Deshaz la mutación.

- [ ] **Paso 7: `pnpm -r typecheck`**

```bash
pnpm -r typecheck
```

- [ ] **Paso 8: commit**

```bash
git add packages/db/src/destino.ts packages/db/src/cliente.ts packages/db/src/destino.test.ts && git commit -m "feat(db): dentro de Cloud Run el conector usa la identidad adherida"
```

---

## Task 2: `drenarCola`

**Archivos:**
- Crear: `apps/worker/src/drenar.ts`
- Crear: `apps/worker/src/drenar.test.ts`

**Interfaces:**
- Consume: `tomarYEjecutarUna(db, deps): Promise<'nada'|'completada'|'fallida'>` y `DependenciasDelWorker` de `./tomar.js`, ambos ya existentes y sin cambios.
- Produce:
  - `LIMITE_POR_PETICION: number` (valor `10`)
  - `interface RecuentoDelDrenado { completadas: number; fallidas: number; quedaTrabajo: boolean }`
  - `drenarCola(db: BaseDeDatos, deps: DependenciasDelWorker, limite?: number): Promise<RecuentoDelDrenado>`

  Lo consumen `servidor.ts` (Task 3) y `main.ts` (Task 4).

- [ ] **Paso 1: escribir las pruebas que fallan**

Crea `apps/worker/src/drenar.test.ts`:

```ts
import { ClienteFalso } from '@gc/ai'
import { esquema } from '@gc/db'
import { conBaseDeDatosDePrueba } from '@gc/db/pruebas'
import { encolarGrilla } from '@gc/operaciones'
import { sembrarConEstrategia } from '@gc/operaciones/pruebas'
import { eq } from 'drizzle-orm'
import { describe, expect, it } from 'vitest'
import { drenarCola } from './drenar.js'

const ENV = { MODELO_RAZONAMIENTO: 'proveedor/fuerte' }

/** Mismo mes de 2026-Q3 que usa `tomar.test.ts`: la siembra trae esa estrategia. */
const MES = '2026-09'

const GRILLA = JSON.stringify({
  slots: [
    {
      fecha: '2026-09-02', hora: '13:00', canal: 'blog', formato: 'articulo',
      pilar: 'educacion', angulo: 'guía práctica',
      brief: 'Explicar paso a paso cómo verificar la factibilidad antes de comprar.',
    },
  ],
})

describe('drenarCola', () => {
  it('con la cola vacía devuelve cero y no dice que quede trabajo', async () => {
    await conBaseDeDatosDePrueba(async (db) => {
      const r = await drenarCola(db, { cliente: new ClienteFalso([]), env: ENV })
      expect(r).toEqual({ completadas: 0, fallidas: 0, quedaTrabajo: false })
    })
  })

  it('atiende todas las corridas pendientes en un solo turno', async () => {
    await conBaseDeDatosDePrueba(async (db) => {
      const ref = await sembrarConEstrategia(db)
      // Tres marcas distintas: `encolar` rechaza una segunda corrida viva para
      // la misma marca y mes, así que encolar tres veces sobre `parcelas` no
      // daría tres corridas y esta prueba mediría otra cosa.
      await db.insert(esquema.brands).values([
        { organizationId: ref.organizationId, slug: 'dos', name: 'Dos' },
        { organizationId: ref.organizationId, slug: 'tres', name: 'Tres' },
      ])
      await encolarGrilla(db, ref.organizationId, { slug: 'parcelas', mes: MES })
      await encolarGrilla(db, ref.organizationId, { slug: 'dos', mes: MES })
      await encolarGrilla(db, ref.organizationId, { slug: 'tres', mes: MES })

      // Solo `parcelas` tiene estrategia sembrada, así que las otras dos
      // fallan en el primer paso sin llamar al modelo. Lo que esta prueba
      // afirma es que el drenado no se detiene: las tres se atienden.
      const r = await drenarCola(db, { cliente: new ClienteFalso([GRILLA]), env: ENV })

      expect(r.completadas + r.fallidas).toBe(3)
      expect(r.quedaTrabajo).toBe(false)
      const pendientes = await db
        .select()
        .from(esquema.pipelineRuns)
        .where(eq(esquema.pipelineRuns.status, 'pendiente'))
      expect(pendientes).toHaveLength(0)
    })
  })

  it('una corrida que falla no detiene a las siguientes', async () => {
    await conBaseDeDatosDePrueba(async (db) => {
      const ref = await sembrarConEstrategia(db)
      // Una sola marca alcanza: la guarda contra el doble encolado es por
      // marca **y mes**, así que dos meses distintos dan dos corridas vivas.
      // La primera en entrar es la que falla: sin estrategia para 2026-Q4.
      await encolarGrilla(db, ref.organizationId, { slug: 'parcelas', mes: '2026-10' })
      await encolarGrilla(db, ref.organizationId, { slug: 'parcelas', mes: MES })

      const r = await drenarCola(db, { cliente: new ClienteFalso([GRILLA]), env: ENV })

      expect(r).toMatchObject({ completadas: 1, fallidas: 1, quedaTrabajo: false })
    })
  })

  it('al alcanzar el límite corta el turno y avisa que queda trabajo', async () => {
    await conBaseDeDatosDePrueba(async (db) => {
      const ref = await sembrarConEstrategia(db)
      await db.insert(esquema.brands).values({
        organizationId: ref.organizationId, slug: 'dos', name: 'Dos',
      })
      await encolarGrilla(db, ref.organizationId, { slug: 'parcelas', mes: '2026-10' })
      await encolarGrilla(db, ref.organizationId, { slug: 'dos', mes: '2026-10' })

      const r = await drenarCola(db, { cliente: new ClienteFalso([]), env: ENV }, 1)

      // Sin el límite, este turno se llevaría las dos. Con él se lleva una y
      // deja constancia de que hay más, que es lo que permite a quien llame
      // volver a pedir en vez de creer que la cola quedó vacía.
      expect(r).toMatchObject({ fallidas: 1, quedaTrabajo: true })
      const pendientes = await db
        .select()
        .from(esquema.pipelineRuns)
        .where(eq(esquema.pipelineRuns.status, 'pendiente'))
      expect(pendientes).toHaveLength(1)
    })
  })
})
```

- [ ] **Paso 2: correr y ver que fallan**

```bash
pnpm --filter @gc/worker test -- drenar
```

Esperado: FALLAN las cuatro con `Failed to resolve import "./drenar.js"`.

- [ ] **Paso 3: escribir `drenarCola`**

Crea `apps/worker/src/drenar.ts`:

```ts
import type { BaseDeDatos } from '@gc/db'
import { tomarYEjecutarUna, type DependenciasDelWorker } from './tomar.js'

/**
 * Cuántas corridas atiende un turno como mucho.
 *
 * El límite existe por el tiempo de espera de Cloud Run, no por rendimiento.
 * Sin él, una cola larga se atiende entera dentro de una sola petición HTTP y
 * el corte llega a mitad de una generación: esa corrida queda `en_curso` para
 * siempre, que es el modo de falla que nada en este repositorio recupera solo.
 * Con límite, el turno corta entre una corrida y la siguiente —el único punto
 * donde cortar es inofensivo— y el resto lo levanta la red de seguridad de
 * Cloud Scheduler unos minutos después.
 *
 * Diez es holgado: el sistema hace del orden de diez generaciones al mes.
 */
export const LIMITE_POR_PETICION = 10

export interface RecuentoDelDrenado {
  completadas: number
  fallidas: number
  /** Cierto solo si el turno cortó por el límite, no por quedarse sin trabajo. */
  quedaTrabajo: boolean
}

/**
 * Atiende corridas pendientes hasta que no quede ninguna, o hasta el límite.
 *
 * Es todo lo que el servidor HTTP hace, y vive aparte de él para que se pueda
 * probar contra Postgres de verdad sin levantar un puerto. `tomarYEjecutarUna`
 * no lanza por una corrida fallida —solo por un fallo de infraestructura—, así
 * que este bucle no necesita `try`: una corrida rota se cuenta y se sigue, y
 * una base caída sube hasta quien llame, que es quien sabe qué código HTTP
 * corresponde.
 */
export async function drenarCola(
  db: BaseDeDatos,
  deps: DependenciasDelWorker,
  limite: number = LIMITE_POR_PETICION,
): Promise<RecuentoDelDrenado> {
  let completadas = 0
  let fallidas = 0

  while (completadas + fallidas < limite) {
    const resultado = await tomarYEjecutarUna(db, deps)
    if (resultado === 'nada') return { completadas, fallidas, quedaTrabajo: false }
    if (resultado === 'completada') completadas += 1
    else fallidas += 1
  }

  // Que el recorte quede en el log no es adorno: un turno que corta por el
  // límite se ve, desde afuera, exactamente igual que uno que vació la cola.
  console.log(
    `[worker] turno cortado por el límite de ${limite} corridas; queda trabajo para el siguiente`,
  )
  return { completadas, fallidas, quedaTrabajo: true }
}
```

- [ ] **Paso 4: correr y ver que pasan**

```bash
pnpm --filter @gc/worker test -- drenar
```

Esperado: PASAN las cuatro.

- [ ] **Paso 5: mutar y confirmar que la prueba del límite se pone roja**

Cambia `while (completadas + fallidas < limite)` por `while (true)` y corre de nuevo. **Tiene que fallar** `'al alcanzar el límite corta el turno y avisa que queda trabajo'` con `quedaTrabajo: false`. Deshaz la mutación.

- [ ] **Paso 6: la suite entera y el typecheck**

```bash
pnpm test && pnpm -r typecheck
```

- [ ] **Paso 7: commit**

```bash
git add apps/worker/src/drenar.ts apps/worker/src/drenar.test.ts && git commit -m "feat(worker): drenarCola atiende la cola con un límite por turno"
```

---

## Task 3: el servidor HTTP del worker

**Archivos:**
- Crear: `apps/worker/src/servidor.ts`
- Crear: `apps/worker/src/servidor.test.ts`

**Interfaces:**
- Consume: `drenarCola(db, deps, limite?)` y `RecuentoDelDrenado` de `./drenar.js` (Task 2).
- Produce:
  - `interface OpcionesDelServidor { db: BaseDeDatos; deps: DependenciasDelWorker; token: string }`
  - `crearServidor(opciones: OpcionesDelServidor): import('node:http').Server`

  Lo consume `main.ts` (Task 4).

- [ ] **Paso 1: escribir las pruebas que fallan**

Crea `apps/worker/src/servidor.test.ts`:

```ts
import { ClienteFalso } from '@gc/ai'
import { conBaseDeDatosDePrueba } from '@gc/db/pruebas'
import type { AddressInfo } from 'node:net'
import type { Server } from 'node:http'
import { describe, expect, it } from 'vitest'
import { crearServidor } from './servidor.js'

const TOKEN = 'token-de-prueba'
const ENV = { MODELO_RAZONAMIENTO: 'proveedor/fuerte' }

/** Levanta el servidor en un puerto efímero y lo cierra pase lo que pase. */
async function conServidor(
  db: Parameters<typeof crearServidor>[0]['db'],
  fn: (base: string) => Promise<void>,
): Promise<void> {
  const servidor: Server = crearServidor({
    db,
    deps: { cliente: new ClienteFalso([]), env: ENV },
    token: TOKEN,
  })
  await new Promise<void>((listo) => servidor.listen(0, '127.0.0.1', listo))
  const { port } = servidor.address() as AddressInfo
  try {
    await fn(`http://127.0.0.1:${port}`)
  } finally {
    await new Promise<void>((listo, falla) =>
      servidor.close((e) => (e ? falla(e) : listo())),
    )
  }
}

describe('el servidor del worker', () => {
  it('con el token correcto drena la cola y responde el recuento', async () => {
    await conBaseDeDatosDePrueba(async (db) => {
      await conServidor(db, async (base) => {
        const r = await fetch(`${base}/trabajar`, {
          method: 'POST',
          headers: { 'x-token-worker': TOKEN },
        })
        expect(r.status).toBe(200)
        expect(await r.json()).toEqual({ completadas: 0, fallidas: 0, quedaTrabajo: false })
      })
    })
  })

  it('sin el token responde 401 y no drena nada', async () => {
    await conBaseDeDatosDePrueba(async (db) => {
      await conServidor(db, async (base) => {
        const r = await fetch(`${base}/trabajar`, { method: 'POST' })
        expect(r.status).toBe(401)
      })
    })
  })

  it('con el token equivocado responde 401', async () => {
    await conBaseDeDatosDePrueba(async (db) => {
      await conServidor(db, async (base) => {
        const r = await fetch(`${base}/trabajar`, {
          method: 'POST',
          headers: { 'x-token-worker': 'otra-cosa' },
        })
        expect(r.status).toBe(401)
      })
    })
  })

  it('un token de largo distinto también responde 401', async () => {
    // La comparación de tiempo constante exige largos iguales antes de
    // comparar; sin esa guarda `timingSafeEqual` lanza y el servidor
    // respondería 500 en vez de 401, que es un oráculo distinto.
    await conBaseDeDatosDePrueba(async (db) => {
      await conServidor(db, async (base) => {
        const r = await fetch(`${base}/trabajar`, {
          method: 'POST',
          headers: { 'x-token-worker': 'x' },
        })
        expect(r.status).toBe(401)
      })
    })
  })

  it('otra ruta responde 404, y solo después de comprobar el token', async () => {
    await conBaseDeDatosDePrueba(async (db) => {
      await conServidor(db, async (base) => {
        const sinToken = await fetch(`${base}/otra-cosa`, { method: 'POST' })
        expect(sinToken.status).toBe(401)

        const conToken = await fetch(`${base}/otra-cosa`, {
          method: 'POST',
          headers: { 'x-token-worker': TOKEN },
        })
        expect(conToken.status).toBe(404)
      })
    })
  })

  it('GET sobre la ruta correcta responde 404', async () => {
    await conBaseDeDatosDePrueba(async (db) => {
      await conServidor(db, async (base) => {
        const r = await fetch(`${base}/trabajar`, {
          method: 'GET',
          headers: { 'x-token-worker': TOKEN },
        })
        expect(r.status).toBe(404)
      })
    })
  })
})
```

- [ ] **Paso 2: correr y ver que fallan**

```bash
pnpm --filter @gc/worker test -- servidor
```

Esperado: FALLAN las seis con `Failed to resolve import "./servidor.js"`.

- [ ] **Paso 3: escribir el servidor**

Crea `apps/worker/src/servidor.ts`:

```ts
import type { BaseDeDatos } from '@gc/db'
import { timingSafeEqual } from 'node:crypto'
import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http'
import { drenarCola } from './drenar.js'
import type { DependenciasDelWorker } from './tomar.js'

export interface OpcionesDelServidor {
  db: BaseDeDatos
  deps: DependenciasDelWorker
  token: string
}

const CABECERA_DEL_TOKEN = 'x-token-worker'
const RUTA = '/trabajar'

/**
 * Compara sin filtrar el largo del token por el tiempo de respuesta.
 *
 * `timingSafeEqual` **lanza** si los búferes miden distinto, así que el largo
 * se compara antes. Eso filtra el largo, que no es secreto: lo que protege es
 * el contenido.
 */
function tokenValido(recibido: string | undefined, esperado: string): boolean {
  if (recibido === undefined) return false
  const a = Buffer.from(recibido, 'utf8')
  const b = Buffer.from(esperado, 'utf8')
  if (a.length !== b.length) return false
  return timingSafeEqual(a, b)
}

function responder(res: ServerResponse, codigo: number, cuerpo: unknown): void {
  const texto = JSON.stringify(cuerpo)
  res.writeHead(codigo, { 'content-type': 'application/json; charset=utf-8' })
  res.end(texto)
}

/**
 * El servidor del worker: una ruta, `POST /trabajar`, que drena la cola.
 *
 * **La autorización real la pone Cloud Run**, que se despliega
 * `--no-allow-unauthenticated` y rechaza toda petición sin token IAM antes de
 * que llegue a este proceso. El token compartido de aquí es un cerrojo más,
 * para que un `--allow-unauthenticated` puesto por error —o heredado de una
 * prueba— no deje esta ruta abierta a internet.
 *
 * El token se comprueba **antes** de mirar ruta y método a propósito: así un
 * llamador sin token recibe 401 para todo y no aprende qué rutas existen.
 *
 * Un turno con corridas fallidas responde **200**, no 500: la petición se
 * atendió bien y las corridas ya quedaron marcadas con su error. Devolver 500
 * haría que Cloud Tasks reintentara generaciones que ya fallaron por su
 * cuenta, y cada reintento vuelve a pagar el modelo. El 500 queda para lo que
 * sí conviene reintentar: que `drenarCola` lance, o sea un fallo de
 * infraestructura como la base caída.
 */
export function crearServidor({ db, deps, token }: OpcionesDelServidor): Server {
  return createServer((req: IncomingMessage, res: ServerResponse) => {
    void (async () => {
      const recibido = req.headers[CABECERA_DEL_TOKEN]
      if (!tokenValido(typeof recibido === 'string' ? recibido : undefined, token)) {
        responder(res, 401, { error: 'No autorizado.' })
        return
      }

      const ruta = (req.url ?? '').split('?')[0]
      if (req.method !== 'POST' || ruta !== RUTA) {
        responder(res, 404, { error: `Solo existe POST ${RUTA}.` })
        return
      }

      try {
        responder(res, 200, await drenarCola(db, deps))
      } catch (error) {
        const texto = error instanceof Error ? error.message : String(error)
        console.error('[worker] fallo de infraestructura al drenar:', texto)
        responder(res, 500, { error: texto })
      }
    })()
  })
}
```

- [ ] **Paso 4: correr y ver que pasan**

```bash
pnpm --filter @gc/worker test -- servidor
```

Esperado: PASAN las seis.

- [ ] **Paso 5: mutar y confirmar que las pruebas del token se ponen rojas**

Reemplaza el cuerpo de `tokenValido` por `return true` y corre de nuevo. **Tienen que fallar** las cuatro pruebas de 401. Deshaz la mutación.

Después reemplaza el `if (a.length !== b.length) return false` por nada y corre otra vez: **tiene que fallar** `'un token de largo distinto también responde 401'` con un 500 en vez de un 401 (`timingSafeEqual` lanza). Deshaz.

- [ ] **Paso 6: la suite entera y el typecheck**

```bash
pnpm test && pnpm -r typecheck
```

- [ ] **Paso 7: commit**

```bash
git add apps/worker/src/servidor.ts apps/worker/src/servidor.test.ts && git commit -m "feat(worker): servidor HTTP con una ruta y token compartido"
```

---

## Task 4: `main.ts` pasa a servidor, con el sondeo solo en local

**Archivos:**
- Modificar: `apps/worker/src/main.ts` (reemplazo completo)
- Modificar: `docker-compose.yml`

**Interfaces:**
- Consume: `crearServidor(opciones)` de `./servidor.js` (Task 3), `drenarCola(db, deps)` de `./drenar.js` (Task 2).
- Produce: nada que otra tarea importe. Es el punto de entrada.

**Variables de entorno que este archivo pasa a leer:**
- `PORT` — la fija Cloud Run; en local vale `8080` por omisión.
- `WORKER_TOKEN` — **obligatoria**; sin ella el proceso no arranca.
- `SONDEO_MS` — opcional. Presente y mayor que cero, además del servidor corre el bucle de sondeo. Es el sustituto local de Cloud Scheduler, y en Cloud Run **no se declara**.

- [ ] **Paso 1: reemplazar `apps/worker/src/main.ts` por completo**

```ts
import { crearCliente } from '@gc/ai'
import { crearConexion } from '@gc/db'
import { config } from 'dotenv'
import { resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { drenarCola } from './drenar.js'
import { crearServidor } from './servidor.js'

// Un solo `.env`, en la raíz. Se resuelve desde la ubicación de este archivo y
// no desde el cwd, igual que hacen el CLI y `next.config.ts`: pnpm ejecuta el
// worker con cwd en `apps/worker`.
//
// En Cloud Run ese archivo no existe y `dotenv` no se queja: las variables
// llegan del entorno del servicio. `pendientes.md` registraba esta línea como
// una desviación del diseño pensando en el despliegue; queda comprobado que
// es inofensiva, y por eso se conserva en vez de complicarla con una rama.
const RAIZ = fileURLToPath(new URL('../../../', import.meta.url))
config({ path: resolve(RAIZ, '.env') })

const PUERTO = Number(process.env.PORT ?? 8080)

/**
 * El worker ya no es un bucle: es un servidor con una ruta que drena la cola.
 * Lo despierta Cloud Tasks cuando la web encola, y Cloud Scheduler cada pocos
 * minutos como red de seguridad. Entre llamada y llamada la instancia de Cloud
 * Run se apaga sola, que es lo que hace que esto no cueste nada.
 *
 * El sondeo sobrevive **solo para desarrollo local**, donde no hay ni Cloud
 * Tasks ni Cloud Scheduler: lo enciende `SONDEO_MS`, que en Cloud Run no se
 * declara. Es el mismo trato que `destinoDeConexion` le da a Cloud SQL —el
 * camino de la nube no se toca nunca en local— y tiene el mismo precio, que
 * conviene decir en voz alta: **el despertar por Cloud Tasks solo se ejercita
 * desplegado**.
 */
async function principal(): Promise<void> {
  // Sin token no se arranca. Misma política que con `OPENROUTER_API_KEY`:
  // prefiere no levantar antes que levantar sin la comprobación puesta, que
  // dejaría la ruta abierta si además alguien despliega el servicio como
  // público.
  const token = process.env.WORKER_TOKEN?.trim()
  if (!token) {
    throw new Error(
      'Falta WORKER_TOKEN. Es el token compartido que el worker exige en la cabecera ' +
        '`x-token-worker`, y tiene que valer lo mismo aquí que en quien crea las tareas.',
    )
  }

  const { db, cerrar } = await crearConexion()

  // Misma construcción que el CLI, con una diferencia: `CARPETA_DE_MUESTRAS`
  // se resuelve contra la raíz del repositorio y no contra donde se escribió
  // el comando. El CLI lo hace contra `INIT_CWD` porque es una herramienta que
  // alguien invoca parado en algún lado; el worker es un proceso que se
  // levanta y se queda, y su cwd no significa nada.
  const cliente = crearCliente({
    env: process.env,
    ...(process.env.CARPETA_DE_MUESTRAS !== undefined
      ? { carpetaDeMuestras: resolve(RAIZ, process.env.CARPETA_DE_MUESTRAS) }
      : {}),
  })

  const deps = { cliente }
  const servidor = crearServidor({ db, deps, token })

  let terminando = false

  // El sondeo local. Se lanza sin esperarlo: convive con el servidor en el
  // mismo proceso y las dos vías llaman a `drenarCola`, que es segura de
  // ejecutar en paralelo porque `tomarCorridaPendiente` toma con
  // `FOR UPDATE SKIP LOCKED` — dos drenados nunca se llevan la misma corrida.
  const sondeoMs = Number(process.env.SONDEO_MS ?? 0)
  if (sondeoMs > 0) {
    console.log(`[worker] sondeo local cada ${sondeoMs} ms (sustituto de Cloud Scheduler)`)
    void (async () => {
      while (!terminando) {
        try {
          await drenarCola(db, deps)
        } catch (error) {
          // La base caída, típicamente. Se registra y se sigue: un worker que
          // muere por esto deja de atender cuando la base vuelva.
          console.error('[worker] fallo inesperado en el sondeo:', error)
        }
        if (terminando) break
        await new Promise((r) => setTimeout(r, sondeoMs))
      }
    })()
  }

  // Sin esto, `docker compose stop` mata el proceso a mitad de corrida y la
  // fila queda `en_curso` con `error` nulo para siempre, indistinguible de una
  // que sigue ejecutándose: nada en el repositorio recupera corridas colgadas.
  // En Cloud Run el papel es el mismo, con la diferencia de que allá la señal
  // solo llega a una instancia ociosa.
  const detener = () => {
    terminando = true
    console.log('[worker] señal recibida, se deja de aceptar peticiones')
    servidor.close(async () => {
      await cerrar()
      console.log('[worker] cerrado')
    })
  }
  process.on('SIGTERM', detener)
  process.on('SIGINT', detener)

  servidor.listen(PUERTO, () => {
    console.log(`[worker] escuchando en el puerto ${PUERTO}`)
  })
}

principal().catch((error) => {
  console.error('[worker] no pudo arrancar:', error)
  process.exit(1)
})
```

- [ ] **Paso 2: `docker-compose.yml` — puerto, token y sondeo**

En el bloque `environment:` del servicio `worker` (línea 58-60), reemplaza por:

```yaml
    environment:
      DATABASE_URL: postgres://postgres:postgres@postgres:5432/gestor
      CLOUD_SQL_INSTANCIA: ""
      # En local no hay Cloud Tasks ni Cloud Scheduler, así que el worker se
      # despierta solo. Este es el sustituto de la red de seguridad de la nube,
      # y por eso en Cloud Run la variable NO se declara.
      SONDEO_MS: "2000"
      # El token compartido. En local vale cualquier cosa: aquí nadie llama al
      # worker por HTTP. Se fija igual porque sin él el proceso no arranca, y
      # dejarlo al `.env` haría fallar un clon nuevo por una razón que no tiene
      # nada que ver con lo que esa persona vino a hacer.
      WORKER_TOKEN: "local"
    # Publicado para poder golpear la ruta a mano desde el host mientras se
    # desarrolla (`curl -X POST -H "x-token-worker: local"
    # http://localhost:8080/trabajar`). No hace falta para que el sondeo
    # funcione.
    ports: ["8080:8080"]
```

- [ ] **Paso 3: levantar el worker y comprobar que atiende por las dos vías**

```bash
docker compose up -d postgres && docker compose up -d worker && docker compose logs worker --tail 20
```

Esperado en el log: `[worker] sondeo local cada 2000 ms (sustituto de Cloud Scheduler)` y `[worker] escuchando en el puerto 8080`.

Ahora la ruta, a mano:

```bash
curl -s -X POST -H "x-token-worker: local" http://localhost:8080/trabajar
```

Esperado: `{"completadas":0,"fallidas":0,"quedaTrabajo":false}`.

Y que el token importa:

```bash
curl -s -o /dev/null -w "%{http_code}\n" -X POST http://localhost:8080/trabajar
```

Esperado: `401`.

- [ ] **Paso 4: comprobar el apagado ordenado**

```bash
docker compose stop worker && docker compose logs worker --tail 5
```

Esperado: aparece `[worker] señal recibida, se deja de aceptar peticiones` y después `[worker] cerrado`, y el comando tarda segundos, no los 180 del margen.

- [ ] **Paso 5: la suite, el typecheck y los dos guardianes**

```bash
pnpm test && pnpm -r typecheck && pnpm comprobar:aislamiento && pnpm comprobar:volumenes
```

- [ ] **Paso 6: commit**

```bash
git add apps/worker/src/main.ts docker-compose.yml && git commit -m "feat(worker): el punto de entrada levanta el servidor; el sondeo queda solo en local"
```

---

## Task 5: el paquete `@gc/despertador`

**Archivos:**
- Crear: `packages/despertador/package.json`
- Crear: `packages/despertador/tsconfig.json`
- Crear: `packages/despertador/vitest.config.ts`
- Crear: `packages/despertador/src/index.ts`
- Crear: `packages/despertador/src/destino.ts`
- Crear: `packages/despertador/src/destino.test.ts`
- Crear: `packages/despertador/src/despertar.ts`
- Crear: `packages/despertador/src/despertar.test.ts`
- Modificar: `docker-compose.yml` (volumen `nm-despertador`)
- Modificar: `.env.example`

**Interfaces:**
- Consume: nada del workspace. **No puede declarar `@gc/ai`, `@gc/pipeline` ni `@gc/flujos`**: entra al cierre de dependencias de `apps/web` y `pnpm comprobar:aislamiento` lo va a auditar.
- Produce, exportado desde `packages/despertador/src/index.ts`:
  - `type DestinoDelDespertador = { tipo: 'ninguno' } | { tipo: 'cloud-tasks'; proyecto: string; region: string; cola: string; urlDelWorker: string; cuentaDeServicio: string; token: string; credenciales: string | null }`
  - `destinoDelDespertador(env: Record<string, string | undefined>): DestinoDelDespertador`
  - `despertarWorker(env?: Record<string, string | undefined>): Promise<void>`

  Los consumen `apps/web/src/acciones.ts` y `apps/cli/src/main.ts` (Task 6).

- [ ] **Paso 1: crear el andamiaje del paquete**

`packages/despertador/package.json`:

```json
{
  "name": "@gc/despertador",
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
    "@google-cloud/tasks": "^5.5.0"
  }
}
```

`packages/despertador/tsconfig.json`:

```json
{
  "extends": "../../tsconfig.base.json",
  "include": ["src"]
}
```

`packages/despertador/vitest.config.ts`:

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

`packages/despertador/src/index.ts`:

```ts
export { destinoDelDespertador, type DestinoDelDespertador } from './destino.js'
export { despertarWorker } from './despertar.js'
```

Después:

```bash
pnpm install
```

- [ ] **Paso 2: escribir las pruebas de la función pura**

Crea `packages/despertador/src/destino.test.ts`:

```ts
import { describe, expect, it } from 'vitest'
import { destinoDelDespertador } from './destino.js'

const COMPLETO = {
  CLOUD_TASKS_PROYECTO: 'gestor-contenido-ctp',
  CLOUD_TASKS_REGION: 'southamerica-east1',
  CLOUD_TASKS_COLA: 'generaciones',
  WORKER_URL: 'https://worker-abc.run.app',
  WORKER_CUENTA_DE_SERVICIO: 'invocador@gestor-contenido-ctp.iam.gserviceaccount.com',
  WORKER_TOKEN: 'un-token',
}

describe('destinoDelDespertador', () => {
  it('sin ninguna variable no hay a quién despertar', () => {
    // Es el caso local: el worker de Docker sondea solo, así que no hay nada
    // que avisar. Tiene que ser silencioso, no un error.
    expect(destinoDelDespertador({})).toEqual({ tipo: 'ninguno' })
  })

  it('con las seis variables resuelve por Cloud Tasks', () => {
    expect(destinoDelDespertador(COMPLETO)).toEqual({
      tipo: 'cloud-tasks',
      proyecto: 'gestor-contenido-ctp',
      region: 'southamerica-east1',
      cola: 'generaciones',
      urlDelWorker: 'https://worker-abc.run.app',
      cuentaDeServicio: 'invocador@gestor-contenido-ctp.iam.gserviceaccount.com',
      token: 'un-token',
      credenciales: null,
    })
  })

  it('una configuración a medias falla nombrando lo que falta', () => {
    // El caso peligroso, y la razón de que esto sea una función y no tres
    // `if`: quedarse callado ante una configuración incompleta deja la web
    // encolando sin despertar a nadie, y eso solo se nota como «tarda cinco
    // minutos» —el intervalo de la red de seguridad— sin ningún error.
    const { WORKER_TOKEN: _sinToken, ...aMedias } = COMPLETO
    expect(() => destinoDelDespertador(aMedias)).toThrow(/WORKER_TOKEN/)
  })

  it('una variable en blanco cuenta como ausente, no como valor', () => {
    expect(() => destinoDelDespertador({ ...COMPLETO, CLOUD_TASKS_COLA: '   ' })).toThrow(
      /CLOUD_TASKS_COLA/,
    )
  })

  it('lleva las credenciales cuando están, para Vercel', () => {
    // En Vercel no hay identidad de Google adherida, así que la misma variable
    // que usa la conexión a la base sirve para firmar contra Cloud Tasks.
    const d = destinoDelDespertador({
      ...COMPLETO,
      GOOGLE_CREDENCIALES_JSON: '{"type":"service_account"}',
    })
    expect(d).toMatchObject({ credenciales: '{"type":"service_account"}' })
  })

  it('quita la barra final de la URL del worker', () => {
    // La URL se concatena con `/trabajar`. Con la barra quedaría `//trabajar`,
    // que el servidor responde con 404 — y el síntoma sería «Cloud Tasks
    // reintenta para siempre», lejos de la causa.
    const d = destinoDelDespertador({ ...COMPLETO, WORKER_URL: 'https://worker-abc.run.app/' })
    expect(d).toMatchObject({ urlDelWorker: 'https://worker-abc.run.app' })
  })
})
```

- [ ] **Paso 3: correr y ver que fallan**

```bash
pnpm --filter @gc/despertador test
```

Esperado: FALLAN las seis con `Failed to resolve import "./destino.js"`.

- [ ] **Paso 4: escribir la función pura**

Crea `packages/despertador/src/destino.ts`:

```ts
/**
 * A quién avisar cuando se encola una corrida.
 *
 * En la nube la web crea una tarea de Cloud Tasks y esa tarea llama al worker
 * en Cloud Run. En local no hay a quién avisar: el worker de Docker sondea
 * solo, así que el destino es `ninguno` y despertar no hace nada.
 *
 * Recibe el entorno como parámetro en vez de leer `process.env` por dentro,
 * para que la decisión se pueda probar sin ensuciar el proceso de pruebas —
 * la misma forma que `destinoDeConexion` en `@gc/db`.
 */
export type DestinoDelDespertador =
  | { tipo: 'ninguno' }
  | {
      tipo: 'cloud-tasks'
      proyecto: string
      region: string
      cola: string
      /** Sin barra final: se le concatena la ruta del worker. */
      urlDelWorker: string
      /** La cuenta con la que Cloud Tasks firma el token OIDC. */
      cuentaDeServicio: string
      /** El token compartido que el worker exige en `x-token-worker`. */
      token: string
      /** El JSON de la cuenta de servicio, o `null` para usar las del entorno. */
      credenciales: string | null
    }

const REQUERIDAS = [
  'CLOUD_TASKS_PROYECTO',
  'CLOUD_TASKS_REGION',
  'CLOUD_TASKS_COLA',
  'WORKER_URL',
  'WORKER_CUENTA_DE_SERVICIO',
  'WORKER_TOKEN',
] as const

export function destinoDelDespertador(
  env: Record<string, string | undefined>,
): DestinoDelDespertador {
  const presentes = REQUERIDAS.filter((nombre) => Boolean(env[nombre]?.trim()))

  // Ninguna: es el entorno local, y no hay nada que avisar.
  if (presentes.length === 0) return { tipo: 'ninguno' }

  // Algunas sí y otras no: se falla. Quedarse callado dejaría a la web
  // encolando sin despertar a nadie, y el único síntoma sería que generar
  // «tarda cinco minutos» —el intervalo de la red de seguridad— sin ningún
  // error que apunte a la configuración.
  const faltantes = REQUERIDAS.filter((nombre) => !env[nombre]?.trim())
  if (faltantes.length > 0) {
    throw new Error(
      `El despertador está configurado a medias: faltan ${faltantes.join(', ')}. ` +
        'O están las seis, o ninguna (que es el caso local, donde el worker sondea solo).',
    )
  }

  return {
    tipo: 'cloud-tasks',
    proyecto: env.CLOUD_TASKS_PROYECTO!.trim(),
    region: env.CLOUD_TASKS_REGION!.trim(),
    cola: env.CLOUD_TASKS_COLA!.trim(),
    urlDelWorker: env.WORKER_URL!.trim().replace(/\/+$/, ''),
    cuentaDeServicio: env.WORKER_CUENTA_DE_SERVICIO!.trim(),
    token: env.WORKER_TOKEN!.trim(),
    credenciales: env.GOOGLE_CREDENCIALES_JSON?.trim() ? env.GOOGLE_CREDENCIALES_JSON! : null,
  }
}
```

- [ ] **Paso 5: correr y ver que pasan**

```bash
pnpm --filter @gc/despertador test
```

Esperado: PASAN las seis.

- [ ] **Paso 6: escribir la prueba de `despertarWorker` sin configuración**

Crea `packages/despertador/src/despertar.test.ts`:

```ts
import { describe, expect, it, vi } from 'vitest'
import { despertarWorker } from './despertar.js'

describe('despertarWorker', () => {
  it('sin configuración no hace nada y no falla', async () => {
    // El camino local. Si esto lanzara, cada encolado desde la máquina de
    // desarrollo devolvería un error al usuario por algo que no está roto.
    await expect(despertarWorker({})).resolves.toBeUndefined()
  })

  it('una configuración a medias se registra pero no rompe el encolado', async () => {
    // La corrida ya está escrita en la base cuando esto corre, y la red de
    // seguridad la va a levantar igual. Fallar acá convertiría un problema de
    // configuración en un error visible sobre una operación que sí funcionó.
    const espia = vi.spyOn(console, 'error').mockImplementation(() => {})
    try {
      await expect(despertarWorker({ WORKER_URL: 'https://x.run.app' })).resolves.toBeUndefined()
      expect(espia).toHaveBeenCalledWith(
        expect.stringContaining('[despertador]'),
        expect.stringContaining('CLOUD_TASKS_PROYECTO'),
      )
    } finally {
      espia.mockRestore()
    }
  })
})
```

- [ ] **Paso 7: correr y ver que fallan**

```bash
pnpm --filter @gc/despertador test -- despertar
```

Esperado: FALLAN las dos con `Failed to resolve import "./despertar.js"`.

- [ ] **Paso 8: escribir `despertarWorker`**

Crea `packages/despertador/src/despertar.ts`:

```ts
import { CloudTasksClient } from '@google-cloud/tasks'
import { destinoDelDespertador } from './destino.js'

/** Segundos que Cloud Tasks espera a que el worker termine antes de dar la tarea por fallida. */
const PLAZO_DE_DESPACHO_SEG = 1800

/**
 * Avisa al worker que hay trabajo, creando una tarea de Cloud Tasks.
 *
 * **Se llama después de encolar, nunca dentro.** Cuando esto corre, la corrida
 * ya está escrita en `pipeline_runs` y la red de seguridad de Cloud Scheduler
 * la va a levantar de todos modos unos minutos después. Por eso todo error se
 * registra y se traga: convertir un problema de configuración de Google en un
 * error visible sobre una escritura que sí funcionó sería peor que tardar.
 *
 * Cloud Tasks es lo que resuelve un nudo que ninguna de las dos plataformas
 * deshace sola: una Server Action de Vercel no puede avisar y seguir —si no
 * espera la respuesta, la función termina y la petición se corta—, y Cloud
 * Run le quita CPU a la instancia en cuanto responde, así que el worker
 * tampoco puede contestar «recibido» y trabajar después. Cloud Tasks espera
 * los minutos por los dos.
 */
export async function despertarWorker(
  env: Record<string, string | undefined> = process.env,
): Promise<void> {
  try {
    const destino = destinoDelDespertador(env)
    if (destino.tipo === 'ninguno') return

    const cliente = new CloudTasksClient(
      destino.credenciales !== null ? { credentials: JSON.parse(destino.credenciales) } : {},
    )

    await cliente.createTask({
      parent: cliente.queuePath(destino.proyecto, destino.region, destino.cola),
      task: {
        httpRequest: {
          httpMethod: 'POST',
          url: `${destino.urlDelWorker}/trabajar`,
          headers: { 'x-token-worker': destino.token },
          // El token OIDC es lo que satisface el `--no-allow-unauthenticated`
          // del servicio. La audiencia es la URL base y no la ruta: Cloud Run
          // la valida contra la URL del servicio.
          oidcToken: {
            serviceAccountEmail: destino.cuentaDeServicio,
            audience: destino.urlDelWorker,
          },
        },
        dispatchDeadline: { seconds: PLAZO_DE_DESPACHO_SEG },
      },
    })
  } catch (error) {
    console.error(
      '[despertador] no se pudo avisar al worker; la corrida quedó encolada y la red de ' +
        'seguridad la va a tomar igual, con unos minutos de retraso.',
      error instanceof Error ? error.message : String(error),
    )
  }
}
```

- [ ] **Paso 9: correr y ver que pasan**

```bash
pnpm --filter @gc/despertador test
```

Esperado: PASAN las ocho del paquete.

- [ ] **Paso 10: el volumen en `docker-compose.yml`**

Agrega en los `volumes:` del servicio `worker`, en orden alfabético entre `nm-db` y `nm-flujos`:

```yaml
      - nm-despertador:/app/packages/despertador/node_modules
```

Y en el bloque `volumes:` de primer nivel, entre `nm-db` y `nm-flujos`:

```yaml
  nm-despertador:
```

- [ ] **Paso 11: las variables en `.env.example`**

Agrega al final:

```
# Despertar al worker (bloque 1C-B). En local NO se declaran: el worker de
# Docker sondea solo, así que no hay a quién avisar. Se cargan solo en Vercel,
# y van las seis o ninguna: una configuración a medias falla con un mensaje que
# nombra lo que falta, en vez de dejar la web encolando sin despertar a nadie.
#
# WORKER_URL es la URL del servicio de Cloud Run, sin ruta ni barra final.
# WORKER_TOKEN tiene que valer lo mismo aquí que en el servicio de Cloud Run:
# es el token compartido que el worker exige en la cabecera `x-token-worker`.
# CLOUD_TASKS_PROYECTO=
# CLOUD_TASKS_REGION=
# CLOUD_TASKS_COLA=
# WORKER_URL=
# WORKER_CUENTA_DE_SERVICIO=
# WORKER_TOKEN=
```

- [ ] **Paso 12: los dos guardianes, la suite y el typecheck**

```bash
pnpm comprobar:volumenes && pnpm comprobar:aislamiento && pnpm test && pnpm -r typecheck
```

Esperado: `comprobar:volumenes` reporta **13 paquetes** del workspace más la raíz. Si dice 12, falta el volumen del paso 10.

- [ ] **Paso 13: confirmar que el guardián de volúmenes habría atrapado el olvido**

Quita la línea `- nm-despertador:/app/packages/despertador/node_modules` y corre `pnpm comprobar:volumenes`. **Tiene que fallar** nombrando `@gc/despertador`. Vuelve a ponerla.

- [ ] **Paso 14: commit**

```bash
git add packages/despertador docker-compose.yml .env.example pnpm-lock.yaml && git commit -m "feat(despertador): paquete que avisa al worker por Cloud Tasks"
```

---

## Task 6: la web y el CLI despiertan al worker

**Archivos:**
- Modificar: `apps/web/src/acciones.ts`
- Modificar: `apps/web/package.json`
- Modificar: `apps/cli/src/main.ts:127-132`
- Modificar: `apps/cli/package.json`

**Interfaces:**
- Consume: `despertarWorker(env?)` de `@gc/despertador` (Task 5).
- Produce: nada nuevo. Las firmas de las Server Actions no cambian.

- [ ] **Paso 1: declarar la dependencia en los dos manifiestos**

En `apps/web/package.json` y en `apps/cli/package.json`, agrega a `dependencies`, en orden alfabético:

```json
    "@gc/despertador": "workspace:*",
```

Después:

```bash
pnpm install
```

- [ ] **Paso 2: la web**

En `apps/web/src/acciones.ts`, agrega el import junto a los demás de workspace:

```ts
import { despertarWorker } from '@gc/despertador'
```

Reemplaza las tres acciones que encolan (líneas 152-187) por:

```ts
/**
 * Encola y devuelve. **No ejecuta**: el worker toma la corrida y la corre. Es
 * lo que permite que esta acción responda al instante sin romper la regla de
 * que la web no hace trabajo largo ni llama al modelo.
 *
 * `despertarWorker` va **después** de `encolar` y nunca dentro: cuando corre,
 * la corrida ya está a salvo en la base. Si crear la tarea falla, la función
 * lo registra y no lanza, y la red de seguridad de Cloud Scheduler levanta la
 * corrida unos minutos después. En local no hace nada: no hay Cloud Tasks, y
 * el worker de Docker sondea solo.
 */
export async function encolarGrillaAccion(marca: string, mes: string): Promise<Resultado> {
  return ejecutar(`/${marca}/grilla/${mes}`, async (db, organizationId) => {
    await encolarGrilla(db, organizationId, { slug: marca, mes })
    await despertarWorker()
    return null
  })
}

/** La gemela de la anterior para P1. Encola, despierta y devuelve, por lo mismo. */
export async function encolarEstrategiaAccion(
  marca: string,
  periodo: string,
): Promise<Resultado> {
  return ejecutar(`/${marca}/estrategia`, async (db, organizationId) => {
    await encolarEstrategia(db, organizationId, { slug: marca, periodo })
    await despertarWorker()
    return null
  })
}

/**
 * Devuelve una corrida fallida (o colgada) a la cola.
 *
 * Recibe la ruta a revalidar y no la marca, porque el componente que la llama
 * sirve a las dos pantallas y la ruta ya lleva la marca dentro. Componer
 * `/${marca}/...` aquí obligaría a pasar además de qué pantalla se trata.
 *
 * Despierta igual que las dos de arriba: reanudar deja la fila en `pendiente`,
 * o sea exactamente el mismo estado que encolar, y sin el aviso el botón
 * «Reintentar» tardaría los minutos de la red de seguridad en hacer algo
 * visible.
 */
export async function reanudarCorridaAccion(ruta: string, runId: string): Promise<Resultado> {
  return ejecutar(ruta, async (db, organizationId) => {
    await reanudarCorridaEncolada(db, organizationId, runId)
    await despertarWorker()
    return null
  })
}
```

- [ ] **Paso 3: el CLI**

En `apps/cli/src/main.ts`, agrega `despertarWorker` a los imports:

```ts
import { despertarWorker } from '@gc/despertador'
```

Y reemplaza el caso `corrida:reanudar` (líneas 127-132) por:

```ts
      case 'corrida:reanudar': {
        const id = exigir(values.id, '--id')
        await reanudarCorridaEncolada(db, organizationId, id)
        // Igual que en la web: la fila queda en `pendiente` y quien la ejecuta
        // es el worker. Contra la base remota esto le avisa; contra Docker no
        // hace nada porque el worker de allá sondea solo.
        await despertarWorker()
        console.log(`Corrida ${id} devuelta a pendiente`)
        break
      }
```

- [ ] **Paso 4: la suite, el typecheck y los guardianes**

```bash
pnpm test && pnpm -r typecheck && pnpm comprobar:aislamiento
```

`comprobar:aislamiento` importa especialmente aquí: `@gc/despertador` acaba de entrar al cierre de dependencias de `apps/web`, así que ahora se audita. Esperado: reporta **seis** paquetes en el cierre (antes cinco) y ninguno resuelve `@gc/ai`, `@gc/pipeline` ni `@gc/flujos`.

- [ ] **Paso 5: que el build de la web siga en pie**

```bash
pnpm --filter @gc/web build
```

Esperado: compila, y las rutas dinámicas siguen saliendo con `ƒ` y no con `○`.

- [ ] **Paso 6: comprobar a mano que encolar desde la web sigue funcionando en local**

Con `docker compose up -d` corriendo y el worker levantado:

```bash
pnpm --filter @gc/web dev
```

Abre `http://localhost:3000`, entra a la grilla de `parcelas` para `2026-09` y aprieta regenerar. Esperado: la corrida se encola, el worker la toma por el sondeo en un par de segundos, y **no aparece ningún error del despertador** en la consola del servidor de Next — porque en local `destinoDelDespertador` devuelve `ninguno`.

**Si la verificación modifica la base de desarrollo, restáurala** (`CLAUDE.md`: la marca `parcelas` con estrategia `2026-Q3` y la grilla de `2026-09` en borrador).

- [ ] **Paso 7: commit**

```bash
git add apps/web/src/acciones.ts apps/web/package.json apps/cli/src/main.ts apps/cli/package.json pnpm-lock.yaml && git commit -m "feat(web,cli): avisar al worker al encolar y al reanudar"
```

---

## Task 7: la imagen de producción

**Archivos:**
- Crear: `apps/worker/Dockerfile.produccion`
- Modificar: `.dockerignore`

**Interfaces:**
- Consume: el worker completo de las Tasks 2-4.
- Produce: una imagen que arranca con `pnpm --filter @gc/worker start` y escucha en `$PORT`. La consumen las Tasks 8 y 9.

- [ ] **Paso 1: actualizar `.dockerignore`**

El archivo **ya cubre lo que importa** —`node_modules`, `.git`, `.next`, `.env`, `.env.local` y `perfiles/`— y su comentario dice explícitamente que esas últimas líneas están puestas «el día que alguien agregue un `COPY . .` para armar una imagen de producción». Ese día es hoy, así que el comentario deja de ser cierto y hay que corregirlo, no borrarlo: describe por qué esas líneas existen, y ese porqué sigue vigente.

Reemplaza el comentario por:

```
# Ya no es inerte: `apps/worker/Dockerfile.produccion` hace `COPY . .`, así que
# esta lista es lo único que impide que entren a la imagen las credenciales
# (`.env`, con la clave de OpenRouter) y los datos reales de operación
# (`perfiles/`). Los dos están ignorados por git justamente por eso; que se
# cuelen por Docker sería el mismo escape por otra puerta. En Cloud Run las
# variables vienen del servicio y los secretos de Secret Manager.
```

Y agrega estas tres líneas, que antes daban igual y ahora pesan en cada build:

```
**/.next
docs
.pnpm-store
```

- [ ] **Paso 1b: comprobar que el `.env` no entra a la imagen**

Después de construir (Paso 3), esto no es opcional:

```bash
docker run --rm --entrypoint sh gestor-worker:local -c "ls -la /app/.env 2>&1; ls /app/perfiles 2>&1"
```

Esperado: `No such file or directory` en los dos. Si alguno aparece, la imagen lleva secretos adentro y no se puede empujar a ningún lado.

- [ ] **Paso 2: escribir el Dockerfile de producción**

Crea `apps/worker/Dockerfile.produccion`:

```dockerfile
# La imagen que va a Cloud Run. **No es la de desarrollo** (`Dockerfile`, al
# lado): aquella monta el repositorio como volumen para que un cambio no
# obligue a reconstruir, y esta lo copia adentro porque en Cloud Run no hay
# nada que montar.
#
# Se copia el workspace completo y se instala con `--frozen-lockfile` sin
# filtrar. Instalar solo `@gc/worker...` sería más chico, pero exige que todos
# los `package.json` de los importadores del lockfile estén presentes, y esa
# lista cambia cada vez que se agrega un paquete: una imagen que falla al
# construir por eso es una trampa que se arma sola. `.dockerignore` ya deja
# fuera lo que pesa (node_modules, .git, .next, docs).
FROM node:22-alpine

# `corepack enable` falla por permisos en algunas máquinas, así que el `||`
# deja la salida por npm — igual que en la imagen de desarrollo.
RUN corepack enable pnpm || npm install -g pnpm@9

WORKDIR /app
COPY . .
RUN pnpm install --frozen-lockfile

ENV NODE_ENV=production

# Cloud Run inyecta `PORT` y el worker lo lee; 8080 es el valor por omisión de
# los dos, y queda declarado para que la imagen se pueda correr a mano igual.
ENV PORT=8080
EXPOSE 8080

# Se corre con `tsx`, sin compilar, igual que en desarrollo: el workspace es
# TypeScript sin build y agregar uno solo para esta imagen sería una segunda
# forma de ejecutar el mismo código, con sus propias diferencias.
CMD ["pnpm", "--filter", "@gc/worker", "start"]
```

- [ ] **Paso 3: construir la imagen en local**

```bash
docker build -f apps/worker/Dockerfile.produccion -t gestor-worker:local .
```

Esperado: termina sin error. Si falla en `pnpm install --frozen-lockfile`, es que el lockfile y algún `package.json` no concuerdan: corre `pnpm install` en el host primero.

- [ ] **Paso 4: correr la imagen contra el Postgres de Docker y comprobar que atiende**

```bash
docker run --rm -d --name gestor-worker-prueba --network gestor-de-contenido_default -p 8081:8080 -e DATABASE_URL=postgres://postgres:postgres@postgres:5432/gestor -e WORKER_TOKEN=local -e IA_EN_SECO=true gestor-worker:local
```

(Si la red no se llama así, sácala de `docker network ls`.)

```bash
curl -s -X POST -H "x-token-worker: local" http://localhost:8081/trabajar
```

Esperado: `{"completadas":0,"fallidas":0,"quedaTrabajo":false}`. **Este paso es el que importa de esta tarea**: prueba que el código copiado —y no montado— arranca de verdad, que es el riesgo que el spec nombra primero.

Comprueba también que **no** sondea, porque `SONDEO_MS` no está:

```bash
docker logs gestor-worker-prueba
```

Esperado: aparece `[worker] escuchando en el puerto 8080` y **no** aparece `sondeo local`.

Limpia:

```bash
docker rm -f gestor-worker-prueba
```

- [ ] **Paso 5: commit**

```bash
git add apps/worker/Dockerfile.produccion .dockerignore && git commit -m "feat(worker): imagen de producción, con el código copiado en vez de montado"
```

---

## Task 8: la infraestructura en Google

**Esta tarea no escribe código.** La conduce Claude en la terminal y el dueño ingresa lo que sea credencial. Va antes del despliegue automático porque ese workflow no se puede verificar contra una infraestructura que no existe.

**Los comandos de abajo salen de la documentación de Google, no de una corrida propia de este proyecto.** Si alguno no calza, no es necesariamente un error de quien ejecuta. Verificar contra `gcloud <grupo> --help` antes de dar por malo un nombre de bandera.

**Datos fijos del proyecto:** proyecto `gestor-contenido-ctp`, región `southamerica-east1`, instancia `gestor-contenido`.

- [ ] **Paso 1: encender la instancia de Cloud SQL**

El worker no puede conectarse a una instancia apagada, y el fallo no menciona que lo esté.

```bash
gcloud sql instances patch gestor-contenido --project gestor-contenido-ctp --activation-policy=ALWAYS
```

Esperar a `RUNNABLE`:

```bash
gcloud sql instances describe gestor-contenido --project gestor-contenido-ctp --format="value(state)"
```

- [ ] **Paso 2: habilitar las APIs**

```bash
gcloud services enable run.googleapis.com cloudtasks.googleapis.com cloudscheduler.googleapis.com artifactregistry.googleapis.com secretmanager.googleapis.com iamcredentials.googleapis.com sts.googleapis.com --project gestor-contenido-ctp
```

- [ ] **Paso 3: el repositorio de imágenes**

```bash
gcloud artifacts repositories create gestor --repository-format=docker --location=southamerica-east1 --project gestor-contenido-ctp --description="Imágenes del gestor de contenido"
```

- [ ] **Paso 4: las dos cuentas de servicio**

Son dos y hacen cosas distintas: una **es** el worker (y por eso necesita llegar a la base y al secreto), la otra **llama** al worker (y por eso solo necesita invocarlo).

```bash
gcloud iam service-accounts create worker-gestor --display-name="Worker del gestor de contenido" --project gestor-contenido-ctp
```

```bash
gcloud iam service-accounts create invocador-worker --display-name="Quien llama al worker (Cloud Tasks y Scheduler)" --project gestor-contenido-ctp
```

Permisos del worker sobre la base:

```bash
gcloud projects add-iam-policy-binding gestor-contenido-ctp --member="serviceAccount:worker-gestor@gestor-contenido-ctp.iam.gserviceaccount.com" --role="roles/cloudsql.client"
```

- [ ] **Paso 5: el secreto de OpenRouter**

**El dueño ingresa la clave.** Crear el secreto vacío y que él cargue la versión:

```bash
gcloud secrets create openrouter-api-key --replication-policy=automatic --project gestor-contenido-ctp
```

El dueño ejecuta, pegando su clave cuando lo pida:

```bash
gcloud secrets versions add openrouter-api-key --data-file=- --project gestor-contenido-ctp
```

Y el acceso del worker:

```bash
gcloud secrets add-iam-policy-binding openrouter-api-key --member="serviceAccount:worker-gestor@gestor-contenido-ctp.iam.gserviceaccount.com" --role="roles/secretmanager.secretAccessor" --project gestor-contenido-ctp
```

- [ ] **Paso 6: generar el token compartido y guardarlo**

Un valor aleatorio largo. **El dueño lo guarda**, porque va en dos lados: en el servicio de Cloud Run y en Vercel.

```bash
node -e "console.log(require('node:crypto').randomBytes(32).toString('base64url'))"
```

- [ ] **Paso 7: construir y empujar la imagen a mano, y desplegar la primera revisión**

```bash
gcloud auth configure-docker southamerica-east1-docker.pkg.dev
```

```bash
docker build -f apps/worker/Dockerfile.produccion -t southamerica-east1-docker.pkg.dev/gestor-contenido-ctp/gestor/worker:inicial . && docker push southamerica-east1-docker.pkg.dev/gestor-contenido-ctp/gestor/worker:inicial
```

El despliegue. **`CLOUD_SQL_CLAVE` y `WORKER_TOKEN` los ingresa el dueño**; el resto va tal cual. Notar que `GOOGLE_CREDENCIALES_JSON` **no se declara**: es justo lo que la Task 1 hace posible.

```bash
gcloud run deploy worker --image southamerica-east1-docker.pkg.dev/gestor-contenido-ctp/gestor/worker:inicial --region southamerica-east1 --project gestor-contenido-ctp --service-account worker-gestor@gestor-contenido-ctp.iam.gserviceaccount.com --no-allow-unauthenticated --max-instances 1 --concurrency 1 --timeout 1200 --memory 1Gi --set-secrets OPENROUTER_API_KEY=openrouter-api-key:latest --set-env-vars CLOUD_SQL_INSTANCIA=gestor-contenido-ctp:southamerica-east1:gestor-contenido,CLOUD_SQL_USUARIO=gestor,CLOUD_SQL_BASE=gestor,IA_EN_SECO=false
```

Las dos que faltan, con el dueño escribiendo los valores:

```bash
gcloud run services update worker --region southamerica-east1 --project gestor-contenido-ctp --update-env-vars CLOUD_SQL_CLAVE=<la clave de la base>,WORKER_TOKEN=<el token del paso 6>
```

Guardar la URL que devuelve:

```bash
gcloud run services describe worker --region southamerica-east1 --project gestor-contenido-ctp --format="value(status.url)"
```

**`--max-instances 1` y `--concurrency 1` no son ajustes de rendimiento:** son lo que mantiene el sistema tan concurrente como cuando el worker era un proceso local secuencial, y por eso la columna de latido sigue fuera de alcance. Cambiarlos exige construirla primero.

**`--timeout 1200`** son los 20 minutos del spec, y tiene que quedar por debajo del plazo de despacho de Cloud Tasks (1800 s, fijado en `despertar.ts`).

- [ ] **Paso 8: comprobar que el servicio arriba y autenticado responde**

```bash
curl -s -X POST -H "Authorization: Bearer $(gcloud auth print-identity-token)" -H "x-token-worker: <el token>" $(gcloud run services describe worker --region southamerica-east1 --project gestor-contenido-ctp --format="value(status.url)")/trabajar
```

Esperado: `{"completadas":0,"fallidas":0,"quedaTrabajo":false}`. **Esto ya prueba lo más incierto del bloque**: que el conector alcanza Cloud SQL desde Cloud Run usando la identidad adherida, sin ninguna clave en variables.

Y sin token de Google:

```bash
curl -s -o /dev/null -w "%{http_code}\n" -X POST <la URL>/trabajar
```

Esperado: `403` — Cloud Run rechaza antes de llegar al proceso.

- [ ] **Paso 9: permitir que el invocador invoque**

```bash
gcloud run services add-iam-policy-binding worker --region southamerica-east1 --project gestor-contenido-ctp --member="serviceAccount:invocador-worker@gestor-contenido-ctp.iam.gserviceaccount.com" --role="roles/run.invoker"
```

- [ ] **Paso 10: la cola de Cloud Tasks**

```bash
gcloud tasks queues create generaciones --location southamerica-east1 --project gestor-contenido-ctp
```

Con `--max-concurrent-dispatches 1` la cola no manda dos tareas a la vez, que casa con `--concurrency 1` del servicio:

```bash
gcloud tasks queues update generaciones --location southamerica-east1 --project gestor-contenido-ctp --max-concurrent-dispatches 1
```

- [ ] **Paso 11: la red de seguridad de Cloud Scheduler**

```bash
gcloud scheduler jobs create http despertar-worker --location southamerica-east1 --project gestor-contenido-ctp --schedule "*/5 * * * *" --uri "<la URL del worker>/trabajar" --http-method POST --headers "x-token-worker=<el token>" --oidc-service-account-email invocador-worker@gestor-contenido-ctp.iam.gserviceaccount.com --oidc-token-audience "<la URL del worker>"
```

Dispararlo a mano para comprobarlo:

```bash
gcloud scheduler jobs run despertar-worker --location southamerica-east1 --project gestor-contenido-ctp
```

Y ver en el log de Cloud Run que llegó:

```bash
gcloud run services logs read worker --region southamerica-east1 --project gestor-contenido-ctp --limit 20
```

- [ ] **Paso 12: que la cuenta de Vercel pueda crear tareas**

La cuenta que ya existe desde 1C-A2 es `gestor-contenido@gestor-contenido-ctp.iam.gserviceaccount.com`.

```bash
gcloud projects add-iam-policy-binding gestor-contenido-ctp --member="serviceAccount:gestor-contenido@gestor-contenido-ctp.iam.gserviceaccount.com" --role="roles/cloudtasks.enqueuer"
```

Y —esto es lo que se olvida— permiso para **actuar como** el invocador, que es lo que la tarea pide al llevar un `oidcToken` firmado por esa cuenta:

```bash
gcloud iam service-accounts add-iam-policy-binding invocador-worker@gestor-contenido-ctp.iam.gserviceaccount.com --member="serviceAccount:gestor-contenido@gestor-contenido-ctp.iam.gserviceaccount.com" --role="roles/iam.serviceAccountUser" --project gestor-contenido-ctp
```

- [ ] **Paso 13: las seis variables en Vercel, ámbito Production**

**Solo Production**, igual que las nueve de 1C-A. Ojo con la lección de aquel bloque: `vercel env rm <nombre> preview` **borró la variable entera**, no solo ese ámbito.

```bash
vercel env add CLOUD_TASKS_PROYECTO production
```

Valor: `gestor-contenido-ctp`. Repetir para `CLOUD_TASKS_REGION` (`southamerica-east1`), `CLOUD_TASKS_COLA` (`generaciones`), `WORKER_URL` (la URL del servicio, **sin barra final**), `WORKER_CUENTA_DE_SERVICIO` (`invocador-worker@gestor-contenido-ctp.iam.gserviceaccount.com`) y `WORKER_TOKEN` (el del paso 6, que el dueño ingresa).

Comprobar que quedaron las quince en total y solo en Production:

```bash
vercel env ls
```

- [ ] **Paso 14: la federación de identidad para GitHub**

```bash
gcloud iam workload-identity-pools create github --location=global --display-name="GitHub Actions" --project gestor-contenido-ctp
```

```bash
gcloud iam workload-identity-pools providers create-oidc github-actions --location=global --workload-identity-pool=github --issuer-uri="https://token.actions.githubusercontent.com" --attribute-mapping="google.subject=assertion.sub,attribute.repository=assertion.repository" --attribute-condition="assertion.repository=='lukas-code-master-ctp/marketing-ai'" --project gestor-contenido-ctp
```

La condición del repositorio **no es opcional**: sin ella, cualquier repositorio de GitHub podría pedir credenciales de este proyecto.

Una cuenta para el despliegue, con los dos permisos que necesita:

```bash
gcloud iam service-accounts create desplegador-worker --display-name="Despliegue del worker desde GitHub Actions" --project gestor-contenido-ctp
```

```bash
gcloud projects add-iam-policy-binding gestor-contenido-ctp --member="serviceAccount:desplegador-worker@gestor-contenido-ctp.iam.gserviceaccount.com" --role="roles/run.admin"
```

```bash
gcloud projects add-iam-policy-binding gestor-contenido-ctp --member="serviceAccount:desplegador-worker@gestor-contenido-ctp.iam.gserviceaccount.com" --role="roles/artifactregistry.writer"
```

Desplegar una revisión que corre **como** `worker-gestor` exige poder actuar como esa cuenta:

```bash
gcloud iam service-accounts add-iam-policy-binding worker-gestor@gestor-contenido-ctp.iam.gserviceaccount.com --member="serviceAccount:desplegador-worker@gestor-contenido-ctp.iam.gserviceaccount.com" --role="roles/iam.serviceAccountUser" --project gestor-contenido-ctp
```

Y el vínculo entre el repositorio y esa cuenta. Hace falta el número del proyecto:

```bash
gcloud projects describe gestor-contenido-ctp --format="value(projectNumber)"
```

```bash
gcloud iam service-accounts add-iam-policy-binding desplegador-worker@gestor-contenido-ctp.iam.gserviceaccount.com --role="roles/iam.workloadIdentityUser" --member="principalSet://iam.googleapis.com/projects/<NÚMERO>/locations/global/workloadIdentityPools/github/attribute.repository/lukas-code-master-ctp/marketing-ai" --project gestor-contenido-ctp
```

Guardar el nombre completo del proveedor, que hace falta en la Task 9:

```
projects/<NÚMERO>/locations/global/workloadIdentityPools/github/providers/github-actions
```

- [ ] **Paso 15: la alerta de presupuesto**

Sustituye al apagado automático que el spec descarta. Se configura en la consola —Facturación → Presupuestos y alertas— porque `gcloud billing budgets` exige el id de la cuenta de facturación y permisos que conviene que el dueño maneje en su interfaz. Un presupuesto mensual sobre el proyecto `gestor-contenido-ctp`, con avisos al 50 %, 90 % y 100 %.

**El monto lo decide el dueño** mirando lo que la instancia lleva facturado en Facturación → Informes, que a esta altura ya tiene días de historia real.

- [ ] **Paso 16: dejar registro**

No hay commit en esta tarea. Anotar en el mensaje de la siguiente: URL del servicio, nombre completo del proveedor de WIF, y confirmación de que el paso 8 devolvió el JSON esperado.

---

## Task 9: el despliegue automático en CI

**Archivos:**
- Modificar: `.github/workflows/ci.yml`

**Interfaces:**
- Consume: `apps/worker/Dockerfile.produccion` (Task 7) y toda la infraestructura de la Task 8.
- Produce: una revisión nueva de Cloud Run en cada push a `master` que pase las pruebas.

- [ ] **Paso 1: agregar el trabajo de despliegue**

Al final de `.github/workflows/ci.yml`, después del trabajo `test`, agrega:

```yaml

  # El despliegue va como trabajo de este mismo workflow y no como uno aparte
  # encadenado por `workflow_run`: con `needs: test` la dependencia queda
  # escrita donde se lee, y desplegar una imagen que no pasó las pruebas sería
  # peor que no desplegar.
  #
  # Sin filtro de rutas a propósito. Un cambio en `packages/shared` sí afecta
  # al worker, y una lista de rutas mantenida a mano es una forma conocida de
  # equivocarse en eso. Un despliegue redundante cuesta un par de minutos.
  desplegar-worker:
    needs: test
    if: github.ref == 'refs/heads/master' && github.event_name == 'push'
    runs-on: ubuntu-latest
    # Sin esto, la federación de identidad no funciona: `id-token: write` es lo
    # que permite a Actions pedir su token OIDC, que es lo que Google canjea
    # por credenciales efímeras. Es lo que evita guardar una clave de cuenta de
    # servicio en los secretos del repositorio.
    permissions:
      contents: read
      id-token: write
    steps:
      - uses: actions/checkout@v7
      - uses: google-github-actions/auth@v2
        with:
          workload_identity_provider: ${{ secrets.GCP_WIF_PROVEEDOR }}
          service_account: desplegador-worker@gestor-contenido-ctp.iam.gserviceaccount.com
      - uses: google-github-actions/setup-gcloud@v2
      - name: Autorizar docker contra Artifact Registry
        run: gcloud auth configure-docker southamerica-east1-docker.pkg.dev --quiet
      # La imagen se construye acá y no en Cloud Build: el repositorio es
      # público, así que estos minutos son gratis, y evita depender de un
      # servicio más.
      #
      # Dos etiquetas: el SHA para poder volver a una revisión concreta, y
      # `latest` para que quien mire el repositorio de imágenes sepa cuál es la
      # última sin cruzar con el historial de git.
      - name: Construir y empujar la imagen
        run: |
          IMAGEN=southamerica-east1-docker.pkg.dev/gestor-contenido-ctp/gestor/worker
          docker build -f apps/worker/Dockerfile.produccion -t "$IMAGEN:${{ github.sha }}" -t "$IMAGEN:latest" .
          docker push "$IMAGEN:${{ github.sha }}"
          docker push "$IMAGEN:latest"
      # Solo la imagen. Las variables, los secretos, la cuenta de servicio y
      # los límites de instancias los fijó la Task 8 y siguen puestos: un
      # `--set-env-vars` acá los pisaría, y con ellos el token compartido y la
      # clave de la base.
      - name: Desplegar la revisión
        run: |
          gcloud run deploy worker \
            --image southamerica-east1-docker.pkg.dev/gestor-contenido-ctp/gestor/worker:${{ github.sha }} \
            --region southamerica-east1 \
            --project gestor-contenido-ctp
```

- [ ] **Paso 2: cargar el secreto del repositorio**

**Lo hace el dueño**, con el nombre completo del proveedor que quedó del paso 14 de la Task 8:

```bash
gh secret set GCP_WIF_PROVEEDOR --repo lukas-code-master-ctp/marketing-ai
```

- [ ] **Paso 3: commitear y empujar**

```bash
git add .github/workflows/ci.yml && git commit -m "ci: desplegar el worker a Cloud Run en cada push verde a master"
```

- [ ] **Paso 4: ver el despliegue llegar de verdad**

Empujar la rama y fusionarla es de la fase de cierre; para verificar el workflow antes, ejecutar la rama contra `master` no sirve porque el `if` la excluye. La comprobación se hace **después de fusionar**, y consiste en dos cosas, no una:

```bash
gh run watch --repo lukas-code-master-ctp/marketing-ai
```

Esperado: los dos trabajos en verde.

Y —esto es lo que de verdad importa, porque un workflow verde no prueba que Cloud Run recibió nada— que la revisión activa sea la del commit:

```bash
gcloud run services describe worker --region southamerica-east1 --project gestor-contenido-ctp --format="value(spec.template.spec.containers[0].image)"
```

Esperado: la etiqueta termina en el SHA del último commit de `master`.

---

## Task 10: la verificación de punta a punta

**No escribe código.** Es la única prueba que ejercita Cloud Tasks, el token OIDC, el conector desde Cloud Run y el drenado, todos juntos. Ninguna de las pruebas automáticas la reemplaza.

- [ ] **Paso 1: apagar el worker local**

```bash
docker compose stop worker
```

Que quede claro que lo que responda no es la máquina del dueño.

- [ ] **Paso 2: generar desde la app desplegada**

Entrar a `https://marketing-ai-web.vercel.app`, ir a la grilla de `parcelas` para un mes en borrador, y apretar generar.

- [ ] **Paso 3: medir cuánto tarda en pasar a `en_curso`**

Mirar la pantalla: la corrida tiene que pasar de «encolada» a en curso. **Anotar los segundos.** El spec estima que queda bajo los treinta del aviso de `EstadoDeCorrida`; si los pasa, el hallazgo es que ese umbral hay que subirlo, y va a `pendientes.md`.

- [ ] **Paso 4: comprobar que la grilla aparece**

Esperar a que termine y que los slots se vean en la pantalla.

- [ ] **Paso 5: ver la traza del lado de Google**

```bash
gcloud run services logs read worker --region southamerica-east1 --project gestor-contenido-ctp --limit 50
```

Esperado: la llamada de Cloud Tasks, `[worker] escuchando en el puerto 8080` de un arranque en frío, y el drenado.

```bash
gcloud tasks queues describe generaciones --location southamerica-east1 --project gestor-contenido-ctp
```

Esperado: la cola sin tareas pendientes ni reintentos acumulados.

- [ ] **Paso 6: la red de seguridad, por la vía del CLI**

Con las variables de Cloud SQL en el entorno pero **sin** las seis del despertador, encolar desde el CLI contra la base remota. Sin aviso, la corrida solo puede ser tomada por Cloud Scheduler. Esperar y comprobar que se ejecuta sola en menos de cinco minutos.

- [ ] **Paso 7: comprobar que una cuenta no autorizada sigue rechazada**

La única garantía de 1C-A que quedó sin verificar. Entrar con una cuenta de Google que no esté en `CORREOS_PERMITIDOS`: tiene que salir la pantalla que dice que no está autorizada, no un error genérico.

- [ ] **Paso 8: restaurar la base de desarrollo si hizo falta**

`CLAUDE.md`: la marca `parcelas` con perfil cargado, estrategia `2026-Q3` y la grilla de `2026-09` en borrador.

- [ ] **Paso 9: volver a levantar el worker local**

```bash
docker compose up -d worker
```

---

## Task 11: documentación

**Archivos:**
- Modificar: `CLAUDE.md`
- Modificar: `docs/superpowers/specs/pendientes.md`

Va última a propósito: documenta lo que la Task 10 midió, no lo que este plan estimó.

- [ ] **Paso 1: `CLAUDE.md` — el estado del proyecto**

En el párrafo de estado, decir que el worker corre en Cloud Run y que generar contenido ya no depende de ninguna máquina local.

- [ ] **Paso 2: `CLAUDE.md` — la arquitectura**

Cambiar la línea de `apps/worker` en el bloque de arquitectura:

```
apps/worker    servidor HTTP con una ruta, POST /trabajar: drena la cola de
               corridas pendientes. En Cloud Run escalando a cero, despertado
               por Cloud Tasks; en local sondea solo, por SONDEO_MS
```

Y agregar `@gc/despertador` al listado de paquetes:

```
@gc/despertador avisa al worker que hay trabajo, por Cloud Tasks. Silencioso en local
```

- [ ] **Paso 3: `CLAUDE.md` — una regla no negociable nueva**

```markdown
**`max-instances=1` en Cloud Run no es un ajuste de rendimiento: es lo que
sostiene que la columna de latido no haga falta.** Decidir si una corrida está
abandonada es hoy una aproximación por tiempo —quince minutos sin señal— y esa
aproximación solo es segura mientras haya **un** worker: con varias instancias,
una corrida que un worker está ejecutando puede ser reanudada y tomada por
otro, y el modelo se paga dos veces. `--max-instances 1` junto con
`--concurrency 1` en el servicio, y `--max-concurrent-dispatches 1` en la cola,
mantienen el sistema exactamente tan concurrente como cuando el worker era un
proceso local secuencial. **Subir cualquiera de los tres exige construir antes
la columna de arriendo** (`lease_until` en `pipeline_runs`), que sigue anotada
en `pendientes.md`.
```

- [ ] **Paso 4: `CLAUDE.md` — cómo se despliega y cómo se opera**

Una sección con: que el despliegue es automático en cada push verde a `master`; cómo ver la revisión activa; cómo leer los logs; que las variables y secretos del servicio los fijó la creación y el workflow **no** los toca; y que el token compartido vive en dos lados —el servicio de Cloud Run y Vercel— y tiene que valer lo mismo en los dos.

- [ ] **Paso 5: `CLAUDE.md` — corregir lo que dejó de ser cierto**

Buscar y arreglar toda frase que diga que el worker sondea cada dos segundos o que corre siempre local. Al menos el comentario del bloque de comandos y la sección de Entorno.

- [ ] **Paso 6: `pendientes.md`**

- Cerrar el punto **2** de «deuda que deja el bloque 1C-A2» (el worker sigue local).
- Cerrar el punto **4** con la decisión de descartarlo y su motivo: apagar la instancia deja la app web muerta y ahorra pocos dólares; lo sustituye la alerta de presupuesto.
- Cerrar la entrada de que el worker resuelve el `.env` por `import.meta.url`, con lo comprobado: en la imagen de producción el archivo no existe, `dotenv` no se queja, y las variables vienen del servicio.
- Actualizar las dos entradas del latido y del falso positivo del panel: siguen abiertas, y ahora dependen explícitamente de `max-instances=1`.
- Anotar lo que la Task 10 haya medido y no cuadre con lo estimado — sobre todo el tiempo hasta `en_curso` contra el umbral de treinta segundos.

- [ ] **Paso 7: la suite completa, por última vez**

```bash
pnpm test && pnpm -r typecheck && pnpm comprobar:aislamiento && pnpm comprobar:volumenes && pnpm --filter @gc/web build
```

- [ ] **Paso 8: commit**

```bash
git add CLAUDE.md docs/superpowers/specs/pendientes.md && git commit -m "docs: el worker vive en Cloud Run, y max-instances=1 es lo que sostiene el diseño"
```

---

## Autorrevisión de este plan

**Cobertura del spec, sección por sección:**

| Sección del spec | Tarea |
|---|---|
| Descarte del apagado automático + alerta de presupuesto | Task 8 paso 15, Task 11 paso 6 |
| El worker de bucle a servidor | Tasks 2, 3, 4 |
| Autorización: IAM más token compartido | Task 3, Task 8 pasos 7-8 |
| El sondeo solo en local | Task 4 |
| `@gc/despertador`, función pura y mejor esfuerzo | Task 5 |
| Se llama después de `encolar` | Task 6 |
| Credenciales: un secreto menos | Task 1, Task 8 paso 7 |
| `OPENROUTER_API_KEY` en Secret Manager | Task 8 paso 5 |
| `max-instances=1` | Task 8 paso 7, Task 11 paso 3 |
| Despliegue por Actions con WIF | Tasks 7, 8 paso 14, 9 |
| Dockerfile de producción aparte | Task 7 |
| Los dos límites de tiempo | Task 5 (1800 s) y Task 8 paso 7 (1200 s) |
| Manejo de errores: 200 con fallidas, 500 con infraestructura | Task 3 |
| Verificación en la máquina | Tasks 1-7 |
| Verificación con credenciales | Task 10 |

Sin huecos.

**Consistencia de nombres y tipos**, comprobada de punta a punta: `drenarCola(db, deps, limite?)` → `RecuentoDelDrenado {completadas, fallidas, quedaTrabajo}`, producido en Task 2 y consumido igual en Tasks 3 y 4. `crearServidor({db, deps, token})` producido en Task 3 y consumido igual en Task 4. `destinoDelDespertador(env)` y `despertarWorker(env?)` producidos en Task 5 y consumidos igual en Task 6. `Destino.credenciales: string | null` producido en Task 1 y consumido en el mismo archivo. La cabecera es `x-token-worker` en `servidor.ts` (Task 3), en `despertar.ts` (Task 5), en `docker-compose.yml` (Task 4) y en el trabajo de Scheduler (Task 8 paso 11).

**El plazo de Cloud Tasks (1800 s) es mayor que el tiempo de espera de Cloud Run (1200 s)**, que es la relación que el spec declara no negociable.
