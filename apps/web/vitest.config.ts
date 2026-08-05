import react from '@vitejs/plugin-react'
import { defineConfig } from 'vitest/config'

export default defineConfig({
  // Sin el plugin, vitest no transforma el JSX de los `.tsx` y las pruebas de
  // componente fallan al parsear.
  plugins: [react()],
  test: {
    // `node` sigue siendo el entorno por defecto: `datos.test.ts` y
    // `calendario.test.ts` golpean Postgres. Las pruebas de componente piden
    // jsdom archivo por archivo con `// @vitest-environment jsdom` en su
    // primera línea, en vez de partir esta configuración en dos proyectos.
    environment: 'node',
    // `.tsx` incluido: sin él, la primera prueba de un componente se saltaría
    // en silencio y el paquete seguiría dando "todo verde".
    include: ['src/**/*.test.{ts,tsx}'],
    setupFiles: ['../../vitest.setup.ts'],
    fileParallelism: false,
    server: {
      // `next-auth` es ESM y hace `import ... from 'next/server'` sin
      // extensión. Next no declara `exports` en su `package.json`, así que
      // esa ruta solo resuelve con la resolución permisiva de Vite. Dejarlo
      // externalizado (el comportamiento por omisión para todo lo que vive en
      // `node_modules`) entrega esa importación directo al resolutor nativo
      // de Node, que exige extensión y falla con `ERR_MODULE_NOT_FOUND`.
      deps: {
        inline: [/next-auth/],
      },
    },
  },
})
