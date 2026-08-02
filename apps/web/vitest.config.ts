import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    environment: 'node',
    // `.tsx` incluido: sin él, la primera prueba de un componente se saltaría
    // en silencio y el paquete seguiría dando "todo verde".
    include: ['src/**/*.test.{ts,tsx}'],
    setupFiles: ['../../vitest.setup.ts'],
    fileParallelism: false,
  },
})
