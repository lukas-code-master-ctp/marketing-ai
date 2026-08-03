import { ClienteFalso } from '@gc/ai'
import { PERFIL_VALIDO } from '@gc/brand'
import { conBaseDeDatosDePrueba } from '@gc/db/pruebas'
import { cargarPerfilDeObjeto, crearMarca, resolverOrganizacion } from '@gc/operaciones'
import { describe, expect, it } from 'vitest'
import { generarGrilla } from './flujos.js'

describe('generarGrilla', () => {
  // Esta prueba vivía en `marcas.test.ts` de @gc/operaciones. Se mudó aquí
  // porque genera de verdad: lo que afirma es sobre el mensaje que produce el
  // motor, no sobre las operaciones de marca. Dejarla allá obligaba a
  // @gc/operaciones a declarar @gc/ai y @gc/flujos, y eso volvía el modelo
  // resoluble desde el paquete que la app web sí carga.
  it('los errores nombran la marca por su slug, no por su UUID', async () => {
    await conBaseDeDatosDePrueba(async (db) => {
      const organizationId = await resolverOrganizacion(db, { env: {} })
      const ref = await crearMarca(db, organizationId, { slug: 'parcelas', nombre: 'CTP' })
      await cargarPerfilDeObjeto(db, organizationId, {
        slug: 'parcelas', perfil: PERFIL_VALIDO,
      })

      // Sin estrategia para el trimestre: el mensaje nace en @gc/strategy,
      // que hoy solo conoce el brandId. Es el error que originó esta tarea.
      const error = await generarGrilla(db, new ClienteFalso([]), organizationId, {
        slug: 'parcelas', mes: '2026-09',
      }).catch((e: unknown) => e)

      expect((error as Error).message).toContain('parcelas')
      expect((error as Error).message).not.toContain(ref.brandId)
    })
  })
})
