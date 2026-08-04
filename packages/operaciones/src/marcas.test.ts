import { esquema } from '@gc/db'
import { conBaseDeDatosDePrueba } from '@gc/db/pruebas'
import { describe, expect, it } from 'vitest'
import { crearMarca, resolverOrganizacion } from './marcas.js'

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

  it('con crearSiFalta: false y ninguna organización, falla en vez de insertar', async () => {
    await conBaseDeDatosDePrueba(async (db) => {
      await expect(
        resolverOrganizacion(db, { crearSiFalta: false, env: {} }),
      ).rejects.toThrow(/no hay ninguna organización/i)

      const filas = await db.select().from(esquema.organizations)
      expect(filas).toHaveLength(0)
    })
  })

  it('sin la opción sigue creando la organización por defecto', async () => {
    await conBaseDeDatosDePrueba(async (db) => {
      const id = await resolverOrganizacion(db, { env: {} })

      const filas = await db.select().from(esquema.organizations)
      expect(filas).toHaveLength(1)
      expect(filas[0]!.slug).toBe('principal')
      expect(filas[0]!.id).toBe(id)
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
})

/**
 * Mientras la marca nacía del CLI, quien escribía el slug lo escribía sabiendo
 * que iba a ser un segmento de URL. Desde que hay un formulario, el slug lo
 * llena una persona que no tiene por qué saberlo: "Mi Marca" entraba tal cual
 * y dejaba la marca en `/Mi Marca/grilla/2026-09`, y un presupuesto con coma
 * salía como error crudo de Postgres. La validación va acá y no en la web
 * porque el CLI escribe por la misma puerta.
 */
describe('crearMarca valida lo que escribe una persona', () => {
  async function conOrganizacion(
    db: Parameters<Parameters<typeof conBaseDeDatosDePrueba>[0]>[0],
  ) {
    const [org] = await db
      .insert(esquema.organizations)
      .values({ name: 'A', slug: 'alfa' })
      .returning()
    return org!.id
  }

  it('rechaza un slug que no sirve como segmento de URL, y no inserta nada', async () => {
    await conBaseDeDatosDePrueba(async (db) => {
      const organizationId = await conOrganizacion(db)

      for (const slug of ['Mi Marca', 'MiMarca', 'con_guion_bajo', '-borde', 'acentuada-ñ', '']) {
        const error = await crearMarca(db, organizationId, { slug, nombre: 'Nombre' })
          .catch((e: unknown) => e)
        expect(error, `debía rechazar el slug ${JSON.stringify(slug)}`).toMatchObject({
          clase: 'permanente',
        })
        expect((error as Error).message).toMatch(/minúsculas/)
      }

      expect(await db.select().from(esquema.brands)).toHaveLength(0)
    })
  })

  it('acepta el slug con minúsculas, números y guiones', async () => {
    await conBaseDeDatosDePrueba(async (db) => {
      const organizationId = await conOrganizacion(db)

      const ref = await crearMarca(db, organizationId, { slug: 'marca-2', nombre: 'Marca 2' })

      expect(ref.brandSlug).toBe('marca-2')
    })
  })

  // El slug se validaba sin recortar: " parcelas" fallaba con un mensaje que
  // entrecomillaba un valor visualmente idéntico a uno válido. El nombre se
  // validaba recortado y se insertaba crudo, así que los espacios llegaban a
  // la base y salían en el encabezado de cada pantalla.
  it('recorta el slug y el nombre antes de validar, y guarda lo recortado', async () => {
    await conBaseDeDatosDePrueba(async (db) => {
      const organizationId = await conOrganizacion(db)

      const ref = await crearMarca(db, organizationId, {
        slug: '  con-espacios  ',
        nombre: '  Con Espacios  ',
      })

      expect(ref.brandSlug).toBe('con-espacios')
      const [marca] = await db.select().from(esquema.brands)
      expect(marca!.slug).toBe('con-espacios')
      expect(marca!.name).toBe('Con Espacios')
    })
  })

  // La columna es `text`: sin tope, un slug de 300 caracteres entraba y
  // quedaba dentro de cada dirección del sistema. El comentario de la
  // validación dice que es un segmento de URL; esto lo hace cumplir.
  it('rechaza un slug más largo que el tope, y no inserta nada', async () => {
    await conBaseDeDatosDePrueba(async (db) => {
      const organizationId = await conOrganizacion(db)

      const error = await crearMarca(db, organizationId, {
        slug: 'a'.repeat(61),
        nombre: 'Larga',
      }).catch((e: unknown) => e)

      expect(error).toMatchObject({ clase: 'permanente' })
      expect((error as Error).message).toMatch(/60/)
      expect(await db.select().from(esquema.brands)).toHaveLength(0)
    })
  })

  it('acepta un slug de exactamente el tope', async () => {
    await conBaseDeDatosDePrueba(async (db) => {
      const organizationId = await conOrganizacion(db)

      const ref = await crearMarca(db, organizationId, { slug: 'a'.repeat(60), nombre: 'Justa' })

      expect(ref.brandSlug).toBe('a'.repeat(60))
    })
  })

  it('rechaza un nombre en blanco', async () => {
    await conBaseDeDatosDePrueba(async (db) => {
      const organizationId = await conOrganizacion(db)

      const error = await crearMarca(db, organizationId, { slug: 'valida', nombre: '   ' })
        .catch((e: unknown) => e)

      expect(error).toMatchObject({ clase: 'permanente' })
      expect((error as Error).message).toMatch(/nombre/i)
      expect(await db.select().from(esquema.brands)).toHaveLength(0)
    })
  })

  it('rechaza un presupuesto que no es un número, con un mensaje legible', async () => {
    await conBaseDeDatosDePrueba(async (db) => {
      const organizationId = await conOrganizacion(db)

      const error = await crearMarca(db, organizationId, {
        slug: 'valida',
        nombre: 'Válida',
        presupuesto: '25,50',
      }).catch((e: unknown) => e)

      expect(error).toMatchObject({ clase: 'permanente' })
      expect((error as Error).message).toMatch(/presupuesto/i)
      // Sin validación esto salía como `invalid input syntax for type numeric`,
      // en inglés y nombrando un tipo de Postgres.
      expect((error as Error).message).not.toMatch(/numeric|syntax/i)
      expect(await db.select().from(esquema.brands)).toHaveLength(0)
    })
  })

  it('guarda el presupuesto que sí es un número', async () => {
    await conBaseDeDatosDePrueba(async (db) => {
      const organizationId = await conOrganizacion(db)

      await crearMarca(db, organizationId, {
        slug: 'valida',
        nombre: 'Válida',
        presupuesto: '40.50',
      })

      const [marca] = await db.select().from(esquema.brands)
      expect(marca!.monthlyBudgetUsd).toBe('40.50')
    })
  })
})
