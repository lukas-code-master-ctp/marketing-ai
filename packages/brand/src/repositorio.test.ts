import { esquema } from '@gc/db'
import { conBaseDeDatosDePrueba } from '@gc/db/pruebas'
import { and, eq } from 'drizzle-orm'
import { describe, expect, it } from 'vitest'
import { PERFIL_VALIDO } from './perfil.fixture.js'
import { cargarPerfilVigente, guardarPerfil } from './repositorio.js'

async function sembrar(db: Parameters<Parameters<typeof conBaseDeDatosDePrueba>[0]>[0]) {
  const [org] = await db.insert(esquema.organizations).values({ name: 'X', slug: 'x' }).returning()
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

  it('nombra la marca por su nombre visible cuando se le da uno', async () => {
    await conBaseDeDatosDePrueba(async (db) => {
      const ref = await sembrar(db)

      const error = await cargarPerfilVigente(db, ref.brandId, 'parcelas')
        .catch((e: unknown) => e)

      expect((error as Error).message).toContain('parcelas')
      expect((error as Error).message).not.toContain(ref.brandId)
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

  it('nombra la marca por su slug cuando falla por marca inexistente', async () => {
    await conBaseDeDatosDePrueba(async (db) => {
      const ref = await sembrar(db)
      const inexistente = {
        ...ref, brandId: '00000000-0000-4000-8000-000000000000', brandSlug: 'parcelas',
      }

      const error = await guardarPerfil(db, inexistente, PERFIL_VALIDO)
        .catch((e: unknown) => e)

      expect((error as Error).message).toContain('parcelas')
      expect((error as Error).message).not.toContain(inexistente.brandId)
    })
  })

  it('guardar el perfil registra quién lo hizo', async () => {
    await conBaseDeDatosDePrueba(async (db) => {
      const ref = await sembrar(db)
      const [persona] = await db
        .insert(esquema.users)
        .values({ email: 'lukas@ejemplo.cl', name: 'Lukas' })
        .returning({ id: esquema.users.id })

      const version = await guardarPerfil(db, ref, PERFIL_VALIDO, persona!.id)

      // `brandId` además de `version`: con una sola marca sembrada por prueba
      // `version` ya identifica la fila sin ambigüedad, pero eso deja de ser
      // cierto en cuanto la siembra crezca a dos marcas — dos filas podrían
      // compartir número de versión y esta consulta traería una fila
      // cualquiera de las dos sin que nada lo señale.
      const [fila] = await db
        .select({ createdBy: esquema.brandProfiles.createdBy })
        .from(esquema.brandProfiles)
        .where(
          and(
            eq(esquema.brandProfiles.brandId, ref.brandId),
            eq(esquema.brandProfiles.version, version),
          ),
        )

      expect(fila!.createdBy).toBe(persona!.id)
    })
  })

  // Verifica el comportamiento correcto bajo concurrencia, pero NO es una
  // prueba de regresión confiable de la carrera: sin el FOR UPDATE también
  // pasa, porque un Postgres local responde antes de que las dos operaciones
  // alcancen a solaparse. La garantía real está en el bloqueo de
  // repositorio.ts, no aquí. Que este test esté verde no prueba que el
  // bloqueo siga puesto.
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
