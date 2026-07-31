import { esquema } from '@gc/db'
import { conBaseDeDatosDePrueba } from '@gc/db/pruebas'
import { describe, expect, it } from 'vitest'
import { PERFIL_VALIDO } from './perfil.fixture.js'
import { cargarPerfilVigente, guardarPerfil } from './repositorio.js'

async function sembrar(db: Parameters<Parameters<typeof conBaseDeDatosDePrueba>[0]>[0]) {
  const [org] = await db.insert(esquema.organizations).values({ name: 'X' }).returning()
  const [marca] = await db
    .insert(esquema.brands)
    .values({ organizationId: org!.id, slug: 'parcelas', name: 'CTP' })
    .returning()
  return { organizationId: org!.id, brandId: marca!.id }
}

describe('repositorio de perfiles', () => {
  it('crea versiones incrementales en vez de sobrescribir', async () => {
    await conBaseDeDatosDePrueba(async (db) => {
      const ref = await sembrar(db)

      expect(await guardarPerfil(db, ref, PERFIL_VALIDO)).toBe(1)

      const v2 = {
        ...PERFIL_VALIDO,
        posicionamiento: { ...PERFIL_VALIDO.posicionamiento, promesa: 'Otra promesa distinta' },
      }
      expect(await guardarPerfil(db, ref, v2)).toBe(2)

      const vigente = await cargarPerfilVigente(db, ref.brandId)
      expect(vigente.version).toBe(2)
      expect(vigente.perfil.posicionamiento.promesa).toBe('Otra promesa distinta')
      expect(await db.select().from(esquema.brandProfiles)).toHaveLength(2)
    })
  })

  it('rechaza guardar un perfil inválido', async () => {
    await conBaseDeDatosDePrueba(async (db) => {
      const ref = await sembrar(db)
      await expect(
        guardarPerfil(db, ref, { ...PERFIL_VALIDO, publicos: [] }),
      ).rejects.toMatchObject({ clase: 'permanente' })
    })
  })

  it('falla de forma permanente si la marca no tiene perfil', async () => {
    await conBaseDeDatosDePrueba(async (db) => {
      const ref = await sembrar(db)
      await expect(cargarPerfilVigente(db, ref.brandId)).rejects.toMatchObject({
        clase: 'permanente',
      })
    })
  })

  it('falla de forma permanente si la marca no existe', async () => {
    await conBaseDeDatosDePrueba(async (db) => {
      const ref = await sembrar(db)
      const inexistente = { ...ref, brandId: '00000000-0000-4000-8000-000000000000' }
      await expect(
        guardarPerfil(db, inexistente, PERFIL_VALIDO),
      ).rejects.toMatchObject({ clase: 'permanente' })
    })
  })

  it('dos guardados simultáneos producen versiones distintas', async () => {
    await conBaseDeDatosDePrueba(async (db) => {
      const ref = await sembrar(db)

      const versiones = await Promise.all([
        guardarPerfil(db, ref, PERFIL_VALIDO),
        guardarPerfil(db, ref, PERFIL_VALIDO),
      ])

      expect([...versiones].sort()).toEqual([1, 2])
      expect(await db.select().from(esquema.brandProfiles)).toHaveLength(2)
    })
  })
})
