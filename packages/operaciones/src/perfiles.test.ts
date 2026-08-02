import { PERFIL_VALIDO } from '@gc/brand'
import { esquema } from '@gc/db'
import { conBaseDeDatosDePrueba } from '@gc/db/pruebas'
import { describe, expect, it } from 'vitest'
import { cargarPerfilDeObjeto, estrategiaDelTrimestre, perfilConHistorial } from './perfiles.js'
import { sembrarConEstrategia } from './pruebas/siembra.js'

async function sembrar(db: Parameters<Parameters<typeof conBaseDeDatosDePrueba>[0]>[0]) {
  const [org] = await db.insert(esquema.organizations).values({ name: 'X', slug: 'x' }).returning()
  const [marca] = await db
    .insert(esquema.brands)
    .values({ organizationId: org!.id, slug: 'parcelas', name: 'CTP' })
    .returning()
  return { organizationId: org!.id, brandId: marca!.id }
}

describe('perfilConHistorial', () => {
  it('devuelve el perfil vigente y el historial de versiones', async () => {
    await conBaseDeDatosDePrueba(async (db) => {
      const ref = await sembrar(db)
      await cargarPerfilDeObjeto(db, ref.organizationId, { slug: 'parcelas', perfil: PERFIL_VALIDO })
      await cargarPerfilDeObjeto(db, ref.organizationId, {
        slug: 'parcelas',
        perfil: { ...PERFIL_VALIDO, ofertas: [] },
      })

      const r = await perfilConHistorial(db, ref.organizationId, 'parcelas')

      expect(r.version).toBe(2)
      expect(r.versiones.map((v) => v.version)).toEqual([2, 1])
    })
  })
})

describe('estrategiaDelTrimestre', () => {
  it('la estrategia del trimestre corresponde al mes', async () => {
    await conBaseDeDatosDePrueba(async (db) => {
      const ref = await sembrarConEstrategia(db) // crea 2026-Q3

      expect((await estrategiaDelTrimestre(db, ref.organizationId, 'parcelas', '2026-09'))!.periodo)
        .toBe('2026-Q3')
      expect(await estrategiaDelTrimestre(db, ref.organizationId, 'parcelas', '2026-12'))
        .toBeNull()
    })
  })
})
