// Expansión del workspace, compartida por las comprobaciones de `scripts/`.
//
// Vive aquí y no dentro de una de ellas porque ya son dos las que necesitan la
// misma respuesta —qué paquetes existen y dónde— y dos copias se separan: la
// que se olvide de un globo nuevo de `pnpm-workspace.yaml` no fallaría, dejaría
// de auditar en silencio, que es la clase de comprobación que este proyecto no
// acepta.

import { readFileSync, readdirSync, existsSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

export const raizDir = path.dirname(fileURLToPath(new URL('../package.json', import.meta.url)))

/**
 * Índice `nombre de paquete -> directorio`, leyendo el `name` real de cada
 * `package.json` en vez de suponer que `@gc/<x>` vive en `packages/<x>`:
 * `@gc/web`, `@gc/cli` y `@gc/worker` viven en `apps/`, así que esa convención
 * nunca fue cierta del todo.
 *
 * Los globos salen de `pnpm-workspace.yaml`, que es la única definición del
 * workspace. Solo se soportan los de la forma `<prefijo>/*`, que son los dos
 * que hay; cualquier otro se rechaza en vez de ignorarse en silencio.
 */
export function indexarPaquetesDelWorkspace() {
  const yaml = readFileSync(path.join(raizDir, 'pnpm-workspace.yaml'), 'utf8')
  const globos = yaml
    .split('\n')
    .map((linea) => linea.trim())
    .filter((linea) => linea.startsWith('- '))
    .map((linea) => linea.slice(2).trim().replace(/^["']|["']$/g, ''))

  if (globos.length === 0) {
    throw new Error('pnpm-workspace.yaml no declara ningún globo de paquetes')
  }

  const indice = new Map()
  for (const globo of globos) {
    if (!globo.endsWith('/*')) {
      throw new Error(
        `El globo "${globo}" de pnpm-workspace.yaml no tiene la forma "<prefijo>/*" y este ` +
          'script no sabe expandirlo. Ampliar la expansión antes de agregar globos así.',
      )
    }
    const prefijo = path.join(raizDir, globo.slice(0, -2))
    for (const entrada of readdirSync(prefijo, { withFileTypes: true })) {
      if (!entrada.isDirectory()) continue
      const dir = path.join(prefijo, entrada.name)
      const manifiesto = path.join(dir, 'package.json')
      if (!existsSync(manifiesto)) continue
      const { name } = JSON.parse(readFileSync(manifiesto, 'utf8'))
      if (name) indice.set(name, dir)
    }
  }
  return indice
}

/** Ruta del paquete relativa a la raíz, con `/` siempre (esto corre en Windows). */
export function rutaRelativa(dir) {
  return path.relative(raizDir, dir).split(path.sep).join('/')
}
