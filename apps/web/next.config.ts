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
  // fileURLToPath la rechaza.
  //
  // Desactivar esa interpretación deja el `new URL()` como código en tiempo
  // de ejecución, que es lo que @gc/strategy espera — pero solo para los
  // archivos de ese paquete. Un `parser.javascript.url = false` global
  // apagaría el manejo de assets de webpack para cualquier `new URL()` en
  // toda la app y en el resto de los paquetes transpilados, incluyendo usos
  // legítimos futuros (imágenes, fuentes) que si dependieran de esa
  // interpretación.
  //
  // Aviso para quien despliegue esto: dejar el `new URL()` como código
  // significa que `fileURLToPath` corre en tiempo de ejecución con la ruta
  // absoluta de la máquina donde vive el checkout — funciona en desarrollo
  // local y en cualquier build hecho y ejecutado en la misma máquina/imagen,
  // pero si el build se genera en una máquina y el resultado se copia o
  // despliega en otra con una ruta de proyecto distinta, la ruta absoluta
  // ya no existe y `readFile(RUTA_PROMPT)` falla con ENOENT.
  webpack: (webpackConfig) => {
    webpackConfig.module.rules.push({
      test: /\.ts$/,
      include: fileURLToPath(new URL('../../packages/strategy/src', import.meta.url)),
      // A nivel de Rule las opciones del parser van sin el envoltorio
      // `javascript:` que sí usa `module.parser` (ese envoltorio es para
      // configurar por tipo de módulo a nivel global); aquí el tipo ya lo
      // decide la regla que matchea el recurso.
      parser: { url: false },
    })
    return webpackConfig
  },
}

export default nextConfig
