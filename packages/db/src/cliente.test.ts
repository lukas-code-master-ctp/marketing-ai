import { esViolacionDeUnica } from '@gc/shared'
import { describe, expect, it } from 'vitest'
import { esquema } from './esquema.js'
import { conBaseDeDatosDePrueba } from './pruebas/entorno.js'

/**
 * `clasificarError` —el único punto del sistema donde se decide reintentar—
 * lee `e.code` del error que devuelve el driver. Las pruebas de
 * `esViolacionDeUnica` en `@gc/shared` construyen ese objeto a mano
 * (`{ code: '23505' }`) y por eso no detectarían que `node-postgres` expone
 * el SQLSTATE de otra forma. Esta prueba provoca una violación de unicidad
 * real contra la base y confirma que el error que de verdad lanza el driver
 * sigue siendo reconocido.
 */
describe('errores reales del driver', () => {
  it('esViolacionDeUnica reconoce una violación de unicidad real de node-postgres', async () => {
    await conBaseDeDatosDePrueba(async (db) => {
      await db.insert(esquema.users).values({ email: 'duplicado@ejemplo.cl', name: 'Uno' })

      const error = await db
        .insert(esquema.users)
        .values({ email: 'duplicado@ejemplo.cl', name: 'Otro' })
        .catch((e: unknown) => e)

      expect(esViolacionDeUnica(error)).toBe(true)
    })
  })
})
