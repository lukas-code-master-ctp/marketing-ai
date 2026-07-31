import { eq } from 'drizzle-orm'
import { describe, expect, it } from 'vitest'
import type { BaseDeDatos } from './cliente.js'
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

describe('organization_id obligatorio', () => {
  it('rechaza un pipeline_step sin organization_id', async () => {
    await conBaseDeDatosDePrueba(async (db) => {
      const [org] = await db
        .insert(esquema.organizations)
        .values({ name: 'X' })
        .returning()
      const [run] = await db
        .insert(esquema.pipelineRuns)
        .values({ organizationId: org!.id, flow: 'demo' })
        .returning()

      await expect(
        db.insert(esquema.pipelineSteps).values({
          runId: run!.id,
          name: 'paso-1',
          status: 'en_curso',
          idempotencyKey: 'clave-sin-organizacion',
        } as never),
      ).rejects.toThrow()
    })
  })
})

describe('restricciones CHECK de enums', () => {
  const casos: Array<[string, (db: BaseDeDatos, org: { id: string }) => Promise<unknown>]> = [
    [
      'channel_accounts.channel',
      async (db, org) => {
        const [marca] = await db
          .insert(esquema.brands)
          .values({ organizationId: org.id, slug: 'a', name: 'A' })
          .returning()
        return db.insert(esquema.channelAccounts).values({
          organizationId: org.id,
          brandId: marca!.id,
          channel: 'canal_inexistente' as never,
        })
      },
    ],
    [
      'content_plans.status',
      async (db, org) => {
        const [marca] = await db
          .insert(esquema.brands)
          .values({ organizationId: org.id, slug: 'a', name: 'A' })
          .returning()
        return db.insert(esquema.contentPlans).values({
          organizationId: org.id,
          brandId: marca!.id,
          month: '2026-09-01',
          status: 'estado_inexistente' as never,
        })
      },
    ],
    [
      'pipeline_steps.status',
      async (db, org) => {
        const [run] = await db
          .insert(esquema.pipelineRuns)
          .values({ organizationId: org.id, flow: 'demo' })
          .returning()
        return db.insert(esquema.pipelineSteps).values({
          organizationId: org.id,
          runId: run!.id,
          name: 'paso-1',
          status: 'estado_inexistente' as never,
          idempotencyKey: 'clave-check-pipeline-steps',
        })
      },
    ],
  ]

  it.each(casos)('rechaza un valor inválido en %s', async (_nombre, intentarInsertar) => {
    await conBaseDeDatosDePrueba(async (db) => {
      const [org] = await db
        .insert(esquema.organizations)
        .values({ name: 'X' })
        .returning()

      await expect(intentarInsertar(db, org!)).rejects.toThrow()
    })
  })
})
