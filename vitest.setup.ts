import { config } from 'dotenv'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

// pnpm ejecuta cada paquete con su propia carpeta como cwd, así que el .env
// de la raíz no se encuentra solo. Se resuelve desde la ubicación de este archivo.
//
// `fileURLToPath(import.meta.url)` y no `new URL('.env', import.meta.url)`:
// Vite reescribe estáticamente ese segundo patrón como si fuera un activo, y
// bajo un entorno de navegador (jsdom, el de las pruebas de componente de
// `apps/web`) lo vuelve una URL del servidor de desarrollo
// —`http://localhost:3000/@fs/…`—, con lo que `fileURLToPath` falla con "The
// URL must be of scheme file" antes de que corra prueba alguna. Sin ese
// patrón, `import.meta.url` sigue siendo el `file://` de este archivo en los
// dos entornos.
const aqui = dirname(fileURLToPath(import.meta.url))
config({ path: join(aqui, '.env') })

// `destinoDeConexion` (`packages/db/src/destino.ts`) le da precedencia a
// `CLOUD_SQL_INSTANCIA` sobre `DATABASE_URL` — a propósito, porque así
// resuelve Vercel. El efecto colateral es que si alguien la descomenta en el
// `.env` de la raíz para depurar el camino de Cloud SQL, la sustitución de
// `apps/web/src/acciones.test.ts` (`process.env.DATABASE_URL =
// process.env.DATABASE_URL_TEST`) deja de bastar: con la instancia presente,
// `crearConexion` la elige primero y esas pruebas —el único archivo que llega
// a la conexión real— escribirían contra producción. No hay arreglo posible
// del lado de `destino.ts` sin tocar la precedencia deliberada; se neutraliza
// acá, borrando las cinco variables de Cloud SQL del proceso de pruebas antes
// de que ningún archivo de prueba corra.
//
// Las del **despertador** se borran por la misma simetría, y por el mismo
// escenario: `.env.example` invita a cargarlas para depurar el camino de la
// nube, y con las seis presentes cualquier prueba que llame a las Server
// Actions que encolan —`encolarGrillaAccion` y sus dos hermanas, que llaman a
// `despertarWorker`— crearía una tarea de verdad contra la cola de producción,
// que a su vez despertaría al worker de Cloud Run para que ejecute corridas de
// la base de pruebas. Hoy ninguna prueba llega ahí, así que es latente; deja
// de serlo el día que alguien pruebe esas acciones, y ese día el daño no lo
// avisaría nada. `WORKER_TOKEN` va en la lista aunque sola no configure
// ningún destino (ver `packages/despertador/src/destino.ts`): borrarla
// mantiene el entorno de pruebas parejo con el de un clon nuevo.
//
// `GOOGLE_CREDENCIALES_JSON` aparece una sola vez porque la comparten los dos
// caminos: es la misma cuenta de servicio para la base y para Cloud Tasks.
for (const nombre of [
  'CLOUD_SQL_INSTANCIA',
  'CLOUD_SQL_USUARIO',
  'CLOUD_SQL_CLAVE',
  'CLOUD_SQL_BASE',
  'GOOGLE_CREDENCIALES_JSON',
  'CLOUD_TASKS_PROYECTO',
  'CLOUD_TASKS_REGION',
  'CLOUD_TASKS_COLA',
  'WORKER_URL',
  'WORKER_CUENTA_DE_SERVICIO',
  'WORKER_TOKEN',
]) {
  delete process.env[nombre]
}
