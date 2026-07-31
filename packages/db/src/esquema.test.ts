import { eq } from 'drizzle-orm'
import { describe, expect, it } from 'vitest'
import { esquema } from './esquema.js'
import { conBaseDeDatosDePrueba } from './pruebas/entorno.js'

describe('esquema', () => {
  it('crea organización, marca y perfil versionado', async () => {
    await conBaseDeDatosDePrueba(async (db) => {
      const [org] = await db
        .insert(esquema.organizations)
        .values({ name: 'Mis Startups' })
        .returning()

      const [marca] = await db
        .insert(esquema.brands)
        .values({
          organizationId: org!.id,
          slug: 'parcelas',
          name: 'Compra Tu Parcela',
          monthlyBudgetUsd: '50.00',
        })
        .returning()

      await db.insert(esquema.brandProfiles).values([
        { organizationId: org!.id, brandId: marca!.id, version: 1, data: { tono: 'v1' } },
        { organizationId: org!.id, brandId: marca!.id, version: 2, data: { tono: 'v2' } },
      ])

      const perfiles = await db
        .select()
        .from(esquema.brandProfiles)
        .where(eq(esquema.brandProfiles.brandId, marca!.id))

      expect(perfiles).toHaveLength(2)
    })
  })

  it('rechaza dos versiones iguales del mismo perfil', async () => {
    await conBaseDeDatosDePrueba(async (db) => {
      const [org] = await db
        .insert(esquema.organizations)
        .values({ name: 'X' })
        .returning()
      const [marca] = await db
        .insert(esquema.brands)
        .values({ organizationId: org!.id, slug: 'a', name: 'A' })
        .returning()

      await db.insert(esquema.brandProfiles).values({
        organizationId: org!.id, brandId: marca!.id, version: 1, data: {},
      })

      await expect(
        db.insert(esquema.brandProfiles).values({
          organizationId: org!.id, brandId: marca!.id, version: 1, data: {},
        }),
      ).rejects.toThrow()
    })
  })

  it('rechaza una política de aprobación inválida', async () => {
    await conBaseDeDatosDePrueba(async (db) => {
      const [org] = await db
        .insert(esquema.organizations)
        .values({ name: 'X' })
        .returning()
      const [marca] = await db
        .insert(esquema.brands)
        .values({ organizationId: org!.id, slug: 'a', name: 'A' })
        .returning()

      await expect(
        db.insert(esquema.approvalPolicies).values({
          organizationId: org!.id,
          brandId: marca!.id,
          channel: 'blog',
          policy: 'lo_que_sea' as never,
        }),
      ).rejects.toThrow()
    })
  })

  it('borra en cascada los slots al borrar la marca', async () => {
    await conBaseDeDatosDePrueba(async (db) => {
      const [org] = await db
        .insert(esquema.organizations)
        .values({ name: 'X' })
        .returning()
      const [marca] = await db
        .insert(esquema.brands)
        .values({ organizationId: org!.id, slug: 'a', name: 'A' })
        .returning()
      const [plan] = await db
        .insert(esquema.contentPlans)
        .values({ organizationId: org!.id, brandId: marca!.id, month: '2026-09-01' })
        .returning()
      await db.insert(esquema.planSlots).values({
        organizationId: org!.id,
        contentPlanId: plan!.id,
        scheduledFor: new Date('2026-09-03T13:00:00Z'),
        channel: 'linkedin',
        format: 'post',
        pillar: 'educacion',
        angle: 'mito común',
        brief: 'Desmontar el mito de que...',
      })

      await db.delete(esquema.brands).where(eq(esquema.brands.id, marca!.id))

      expect(await db.select().from(esquema.planSlots)).toHaveLength(0)
    })
  })
})
