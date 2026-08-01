import { config } from 'dotenv'
import type { NextConfig } from 'next'
import { fileURLToPath } from 'node:url'

// Next.js busca su propio .env en apps/web. El del proyecto vive en la raíz,
// y tener dos sería volver a un problema que este repositorio ya resolvió.
config({ path: fileURLToPath(new URL('../../.env', import.meta.url)) })

const nextConfig: NextConfig = {
  // Los paquetes del workspace se distribuyen como TypeScript sin compilar.
  // Todos los paquetes del workspace, no solo los que la app importa directo:
  // @gc/operaciones arrastra @gc/ai y @gc/pipeline, y también se distribuyen
  // como TypeScript sin compilar.
  transpilePackages: [
    '@gc/ai', '@gc/brand', '@gc/db', '@gc/operaciones',
    '@gc/pipeline', '@gc/shared', '@gc/strategy',
  ],
  // Todo el código del proyecto importa con extensión .js apuntando a
  // archivos .ts (estilo ESM/NodeNext). Vitest lo resuelve solo; el webpack
  // de Next necesita este alias explícito o falla con "Module not found".
  experimental: {
    extensionAlias: {
      '.js': ['.ts', '.tsx', '.js'],
    },
  },
  // @gc/strategy resuelve la ruta de sus prompts con
  // `fileURLToPath(new URL('./archivo.md', import.meta.url))`, el modismo
  // estándar de Node/ESM para ubicar un archivo junto al módulo. El parser
  // de webpack intercepta ese patrón `new URL()` como una importación de
  // asset y lo reemplaza por su propia clase URL, que no es la de Node:
  // fileURLToPath la rechaza. Desactivar esa interpretación especial deja
  // el `new URL()` como código en tiempo de ejecución, que es lo que
  // @gc/strategy espera.
  webpack: (webpackConfig) => {
    webpackConfig.module.parser = {
      ...webpackConfig.module.parser,
      javascript: { ...webpackConfig.module.parser?.javascript, url: false },
    }
    return webpackConfig
  },
}

export default nextConfig
