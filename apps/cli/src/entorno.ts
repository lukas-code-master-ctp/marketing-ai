import { config } from 'dotenv'
import { fileURLToPath } from 'node:url'

// pnpm ejecuta el CLI con cwd en apps/cli; el .env vive en la raíz.
// Este módulo se importa primero para que las variables existan antes de que
// se evalúe cualquier otro módulo.
config({ path: fileURLToPath(new URL('../../../.env', import.meta.url)) })
