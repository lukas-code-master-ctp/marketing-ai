import { existsSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

/**
 * Comprueba el hecho estructural del que depende toda la fuga cerrada en
 * `app/layout.tsx` y `app/(app)/layout.tsx`: que la pantalla de entrada vive
 * **fuera** del grupo de rutas `(app)`. El middleware excluye `/entrar` del
 * control de sesión asumiendo justo eso (ver `middleware.ts`), y el layout
 * raíz quedó sin consultar el catálogo de marcas asumiendo lo mismo.
 *
 * Ninguna prueba de comportamiento afirma esto. `paginas.test.tsx` prueba que
 * `RaizLayout` no consulta el catálogo, pero si alguien moviera
 * `app/entrar/` dentro de `app/(app)/`, `RaizLayout` no cambiaría en nada:
 * seguiría sin consultar nada, la prueba de comportamiento seguiría verde, y
 * la fuga volvería completa porque `/entrar` pasaría a heredar el layout de
 * `(app)`, que sí arma el selector de marcas. Hace falta afirmar la posición
 * del archivo en sí, no un efecto indirecto de ella — el mismo motivo por el
 * que `scripts/comprobar-aislamiento.mjs` y `scripts/comprobar-volumenes.mjs`
 * comprueban hechos de grafo y de configuración en vez de comportamiento.
 */
describe('la posición de la pantalla de entrada', () => {
  it('vive fuera del grupo de rutas (app), no bajo su árbol', () => {
    const rutaFueraDeApp = fileURLToPath(new URL('./app/entrar/page.tsx', import.meta.url))
    const rutaDentroDeApp = fileURLToPath(new URL('./app/(app)/entrar/page.tsx', import.meta.url))

    expect(existsSync(rutaFueraDeApp)).toBe(true)
    expect(existsSync(rutaDentroDeApp)).toBe(false)
  })
})
