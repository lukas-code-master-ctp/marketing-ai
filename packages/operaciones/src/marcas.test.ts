import { ClienteFalso } from '@gc/ai'
import { PERFIL_VALIDO } from '@gc/brand'
import { esquema } from '@gc/db'
import { conBaseDeDatosDePrueba } from '@gc/db/pruebas'
import { generarGrilla } from '@gc/flujos'
import { describe, expect, it } from 'vitest'
import { crearMarca, resolverOrganizacion } from './marcas.js'
import { cargarPerfilDeObjeto } from './perfiles.js'

const SIN_ENV = {}

describe('resolverOrganizacion', () => {
  it('crea la organización por defecto cuando no hay ninguna', async () => {
    await conBaseDeDatosDePrueba(async (db) => {
      const id = await resolverOrganizacion(db, { env: SIN_ENV })

      const [org] = await db.select().from(esquema.organizations)
      expect(org!.id).toBe(id)
      expect(org!.slug).toBe('principal')
    })
  })

  it('usa la única organización que exista', async () => {
    await conBaseDeDatosDePrueba(async (db) => {
      const [org] = await db
        .insert(esquema.organizations)
        .values({ name: 'Sola', slug: 'sola' })
        .returning()

      expect(await resolverOrganizacion(db, { env: SIN_ENV })).toBe(org!.id)
    })
  })

  it('falla listando los slugs cuando hay varias y no se indicó cuál', async () => {
    await conBaseDeDatosDePrueba(async (db) => {
      await db.insert(esquema.organizations).values([
        { name: 'A', slug: 'alfa' },
        { name: 'B', slug: 'beta' },
      ])

      const error = await resolverOrganizacion(db, { env: SIN_ENV }).catch((e: unknown) => e)

      expect(error).toMatchObject({ clase: 'permanente' })
      expect((error as Error).message).toContain('alfa')
      expect((error as Error).message).toContain('beta')
    })
  })

  it('la bandera desempata', async () => {
    await conBaseDeDatosDePrueba(async (db) => {
      const filas = await db
        .insert(esquema.organizations)
        .values([{ name: 'A', slug: 'alfa' }, { name: 'B', slug: 'beta' }])
        .returning()
      const beta = filas.find((o) => o.slug === 'beta')!

      expect(await resolverOrganizacion(db, { org: 'beta', env: SIN_ENV })).toBe(beta.id)
    })
  })

  it('la variable de entorno desempata cuando no hay bandera', async () => {
    await conBaseDeDatosDePrueba(async (db) => {
      const filas = await db
        .insert(esquema.organizations)
        .values([{ name: 'A', slug: 'alfa' }, { name: 'B', slug: 'beta' }])
        .returning()
      const alfa = filas.find((o) => o.slug === 'alfa')!

      expect(await resolverOrganizacion(db, { env: { ORGANIZACION: 'alfa' } })).toBe(alfa.id)
    })
  })

  it('la bandera gana sobre la variable de entorno', async () => {
    await conBaseDeDatosDePrueba(async (db) => {
      const filas = await db
        .insert(esquema.organizations)
        .values([{ name: 'A', slug: 'alfa' }, { name: 'B', slug: 'beta' }])
        .returning()
      const beta = filas.find((o) => o.slug === 'beta')!

      expect(
        await resolverOrganizacion(db, { org: 'beta', env: { ORGANIZACION: 'alfa' } }),
      ).toBe(beta.id)
    })
  })

  it('falla si la organización pedida no existe', async () => {
    await conBaseDeDatosDePrueba(async (db) => {
      await db.insert(esquema.organizations).values({ name: 'A', slug: 'alfa' })

      await expect(
        resolverOrganizacion(db, { org: 'inventada', env: SIN_ENV }),
      ).rejects.toMatchObject({ clase: 'permanente' })
    })
  })
})

describe('marcas por organización', () => {
  it('dos organizaciones pueden tener el mismo slug de marca', async () => {
    await conBaseDeDatosDePrueba(async (db) => {
      const filas = await db
        .insert(esquema.organizations)
        .values([{ name: 'A', slug: 'alfa' }, { name: 'B', slug: 'beta' }])
        .returning()
      const alfa = filas.find((o) => o.slug === 'alfa')!
      const beta = filas.find((o) => o.slug === 'beta')!

      const enAlfa = await crearMarca(db, alfa.id, { slug: 'parcelas', nombre: 'En alfa' })
      const enBeta = await crearMarca(db, beta.id, { slug: 'parcelas', nombre: 'En beta' })

      expect(enAlfa.brandId).not.toBe(enBeta.brandId)
      expect(enAlfa.organizationId).toBe(alfa.id)
      expect(enBeta.organizationId).toBe(beta.id)
    })
  })

  it('un slug repetido dentro de la misma organización da un error legible', async () => {
    await conBaseDeDatosDePrueba(async (db) => {
      const [org] = await db
        .insert(esquema.organizations)
        .values({ name: 'A', slug: 'alfa' })
        .returning()

      await crearMarca(db, org!.id, { slug: 'parcelas', nombre: 'Primera' })

      const error = await crearMarca(db, org!.id, { slug: 'parcelas', nombre: 'Segunda' })
        .catch((e: unknown) => e)

      expect(error).toMatchObject({ clase: 'permanente' })
      expect((error as Error).message).toContain('parcelas')
    })
  })

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
