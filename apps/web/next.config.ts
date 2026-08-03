import { config } from 'dotenv'
import type { NextConfig } from 'next'
import { fileURLToPath } from 'node:url'

// Next.js busca su propio .env en apps/web. El del proyecto vive en la raíz,
// y tener dos sería volver a un problema que este repositorio ya resolvió.
config({ path: fileURLToPath(new URL('../../.env', import.meta.url)) })

const nextConfig: NextConfig = {
  // Los paquetes del workspace se distribuyen como TypeScript sin compilar.
  // La lista incluye los transitivos y no solo los que la app importa directo:
  // @gc/operaciones arrastra @gc/brand.
  //
  // Ojo con lo que esta lista NO hace: no es lo que permite compilar el
  // TypeScript del workspace, ni impide resolver lo que se omite. Next sigue
  // los symlinks de pnpm hasta la ruta real de cada paquete, que cae fuera de
  // node_modules, y por eso ya los trata como código de primera parte. Se
  // comprobó quitando @gc/brand y @gc/strategy de aquí: el build siguió
  // pasando. La lista se mantiene explícita porque documenta el conjunto de
  // paquetes que la web transpila y no depende de ese detalle de resolución.
  //
  // Que @gc/ai, @gc/pipeline y @gc/flujos no aparezcan no es lo que los deja
  // fuera: eso lo garantiza el grafo de dependencias, y se verifica con la
  // comprobación de `require.resolve` documentada en CLAUDE.md.
  transpilePackages: [
    '@gc/brand', '@gc/db', '@gc/operaciones', '@gc/shared', '@gc/strategy',
  ],
  // Todo el código del proyecto importa con extensión .js apuntando a
  // archivos .ts (estilo ESM/NodeNext). Vitest lo resuelve solo; el webpack
  // de Next necesita este alias explícito o falla con "Module not found".
  experimental: {
    extensionAlias: {
      '.js': ['.ts', '.tsx', '.js'],
    },
  },
}

export default nextConfig
