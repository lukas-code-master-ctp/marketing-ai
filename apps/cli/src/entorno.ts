import { config } from 'dotenv'
import { resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

// pnpm ejecuta el CLI con cwd en apps/cli; el .env vive en la raíz.
// Este módulo se importa primero para que las variables existan antes de que
// se evalúe cualquier otro módulo.
config({ path: fileURLToPath(new URL('../../../.env', import.meta.url)) })

/**
 * Resuelve una ruta relativa contra el directorio donde el usuario escribió el
 * comando, no contra `apps/cli`. pnpm cambia el cwd al del paquete y deja el
 * original en INIT_CWD; sin esto, `--archivo perfiles/x.json` buscaría en
 * `apps/cli/perfiles/x.json`.
 */
export function resolverDesdeInvocacion(ruta: string): string {
  return resolve(process.env.INIT_CWD ?? process.cwd(), ruta)
}
