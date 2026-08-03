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
  },
})
