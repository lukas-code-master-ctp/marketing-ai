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
for (const nombre of [
  'CLOUD_SQL_INSTANCIA',
  'CLOUD_SQL_USUARIO',
  'CLOUD_SQL_CLAVE',
  'CLOUD_SQL_BASE',
  'GOOGLE_CREDENCIALES_JSON',
]) {
  delete process.env[nombre]
}
