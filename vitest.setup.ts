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
