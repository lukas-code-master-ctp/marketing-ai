import { esquema } from '@gc/db'
import { conBaseDeDatosDePrueba } from '@gc/db/pruebas'
import { describe, expect, it } from 'vitest'
import { marcasDeLaOrganizacion } from './datos.js'

describe('marcasDeLaOrganizacion', () => {
  it('devuelve las marcas de la organización ordenadas por antigüedad', async () => {
    await conBaseDeDatosDePrueba(async (db) => {
      const [org] = await db
        .insert(esquema.organizations)
        .values({ name: 'A', slug: 'a' })
        .returning()
      const [otra] = await db
        .insert(esquema.organizations)
        .values({ name: 'B', slug: 'b' })
        .returning()

      await db.insert(esquema.brands).values([
        { organizationId: org!.id, slug: 'primera', name: 'Primera' },
        { organizationId: org!.id, slug: 'segunda', name: 'Segunda' },
        { organizationId: otra!.id, slug: 'ajena', name: 'Ajena' },
      ])

      const marcas = await marcasDeLaOrganizacion(db, org!.id)

      expect(marcas.map((m) => m.slug)).toEqual(['primera', 'segunda'])
    })
  })
})
