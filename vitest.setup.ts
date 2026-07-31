import { config } from 'dotenv'
import { fileURLToPath } from 'node:url'

// pnpm ejecuta cada paquete con su propia carpeta como cwd, así que el .env
// de la raíz no se encuentra solo. Se resuelve desde la ubicación de este archivo.
config({ path: fileURLToPath(new URL('.env', import.meta.url)) })
