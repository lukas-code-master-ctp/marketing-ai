import { esquema } from '@gc/db'
import { conBaseDeDatosDePrueba } from '@gc/db/pruebas'
import { describe, expect, it } from 'vitest'
import { marcasDeLaOrganizacion, organizacionPorDefecto } from './datos.js'

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

      // Fechas explícitas y distintas. Con un INSERT por lote las tres filas
      // comparten `now()` — es constante dentro de una sentencia — y entonces
      // `orderBy` no ordena nada: la prueba pasaría igual sin él.
      await db.insert(esquema.brands).values([
        { organizationId: org!.id, slug: 'segunda', name: 'Segunda',
          createdAt: new Date('2026-02-01T00:00:00Z') },
        { organizationId: org!.id, slug: 'primera', name: 'Primera',
          createdAt: new Date('2026-01-01T00:00:00Z') },
        { organizationId: otra!.id, slug: 'ajena', name: 'Ajena',
          createdAt: new Date('2026-01-15T00:00:00Z') },
      ])

      const marcas = await marcasDeLaOrganizacion(db, org!.id)

      expect(marcas.map((m) => m.slug)).toEqual(['primera', 'segunda'])
    })
  })
})

describe('organizacionPorDefecto', () => {
  it('organizacionPorDefecto no crea la organización cuando no existe', async () => {
    await conBaseDeDatosDePrueba(async (db) => {
      await expect(organizacionPorDefecto(db)).rejects.toThrow(/No hay ninguna organización/)

      const filas = await db.select().from(esquema.organizations)
      expect(filas).toHaveLength(0)
    })
  })
})
