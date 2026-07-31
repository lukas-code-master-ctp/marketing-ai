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

describe('integridad multi-tenant', () => {
  it('rechaza una hija de marca cuya organización no coincide', async () => {
    await conBaseDeDatosDePrueba(async (db) => {
      const [orgA] = await db.insert(esquema.organizations).values({ name: 'A' }).returning()
      const [orgB] = await db.insert(esquema.organizations).values({ name: 'B' }).returning()
      const [marca] = await db
        .insert(esquema.brands)
        .values({ organizationId: orgA!.id, slug: 'a', name: 'A' })
        .returning()

      // La marca es de orgA; el perfil dice ser de orgB.
      await expect(
        db.insert(esquema.brandProfiles).values({
          organizationId: orgB!.id,
          brandId: marca!.id,
          version: 1,
          data: {},
        }),
      ).rejects.toThrow()
    })
  })

  it('rechaza un slot cuya organización no coincide con la de su plan', async () => {
    await conBaseDeDatosDePrueba(async (db) => {
      const [orgA] = await db.insert(esquema.organizations).values({ name: 'A' }).returning()
      const [orgB] = await db.insert(esquema.organizations).values({ name: 'B' }).returning()
      const [marca] = await db
        .insert(esquema.brands)
        .values({ organizationId: orgA!.id, slug: 'a', name: 'A' })
        .returning()
      const [plan] = await db
        .insert(esquema.contentPlans)
        .values({ organizationId: orgA!.id, brandId: marca!.id, month: '2026-09-01' })
        .returning()

      await expect(
        db.insert(esquema.planSlots).values({
          organizationId: orgB!.id,
          contentPlanId: plan!.id,
          scheduledFor: new Date('2026-09-03T13:00:00Z'),
          channel: 'blog',
          format: 'articulo',
          pillar: 'educacion',
          angle: 'x',
          brief: 'Un brief suficientemente largo para pasar la validación.',
        }),
      ).rejects.toThrow()
    })
  })

  it('rechaza un derivado que apunta a un slot de otra organización', async () => {
    await conBaseDeDatosDePrueba(async (db) => {
      const [orgA] = await db.insert(esquema.organizations).values({ name: 'A' }).returning()
      const [orgB] = await db.insert(esquema.organizations).values({ name: 'B' }).returning()

      const crearSlot = async (orgId: string, slug: string) => {
        const [marca] = await db
          .insert(esquema.brands)
          .values({ organizationId: orgId, slug, name: slug })
          .returning()
        const [plan] = await db
          .insert(esquema.contentPlans)
          .values({ organizationId: orgId, brandId: marca!.id, month: '2026-09-01' })
          .returning()
        const [slot] = await db
          .insert(esquema.planSlots)
          .values({
            organizationId: orgId,
            contentPlanId: plan!.id,
            scheduledFor: new Date('2026-09-03T13:00:00Z'),
            channel: 'blog',
            format: 'articulo',
            pillar: 'educacion',
            angle: 'x',
            brief: 'Un brief suficientemente largo para pasar la validación.',
          })
          .returning()
        return { planId: plan!.id, slotId: slot!.id }
      }

      const a = await crearSlot(orgA!.id, 'a')
      const b = await crearSlot(orgB!.id, 'b')

      // Un slot de orgB no puede colgar de un padre de orgA.
      await expect(
        db.insert(esquema.planSlots).values({
          organizationId: orgB!.id,
          contentPlanId: b.planId,
          sourceSlotId: a.slotId,
          scheduledFor: new Date('2026-09-05T13:00:00Z'),
          channel: 'linkedin',
          format: 'derivado',
          pillar: 'educacion',
          angle: 'x',
          brief: 'Un brief suficientemente largo para pasar la validación.',
        }),
      ).rejects.toThrow()
    })
  })

  // El registro de costo tiene que sobrevivir a su corrida: es lo que suma el
  // guardián de presupuesto. Si al borrar un `pipeline_run` se perdiera el
  // gasto histórico, se debilitaría en silencio la única barrera del sistema
  // con dinero detrás.
  it('conserva la llamada de IA al borrar su corrida, anulando solo run_id', async () => {
    await conBaseDeDatosDePrueba(async (db) => {
      const [org] = await db.insert(esquema.organizations).values({ name: 'A' }).returning()
      const [marca] = await db
        .insert(esquema.brands)
        .values({ organizationId: org!.id, slug: 'a', name: 'A' })
        .returning()
      const [corrida] = await db
        .insert(esquema.pipelineRuns)
        .values({ organizationId: org!.id, brandId: marca!.id, flow: 'demo' })
        .returning()
      await db.insert(esquema.aiCalls).values({
        organizationId: org!.id,
        brandId: marca!.id,
        runId: corrida!.id,
        task: 'redaccion',
        model: 'proveedor/modelo',
        costUsd: '1.500000',
        promptHash: 'hash-de-prueba',
      })

      await db.delete(esquema.pipelineRuns).where(eq(esquema.pipelineRuns.id, corrida!.id))

      const llamadas = await db.select().from(esquema.aiCalls)
      expect(llamadas).toHaveLength(1)
      expect(llamadas[0]!.runId).toBeNull()
      expect(llamadas[0]!.organizationId).toBe(org!.id)
      expect(llamadas[0]!.costUsd).toBe('1.500000')
    })
  })

  it('acepta las filas cuya organización sí coincide', async () => {
    await conBaseDeDatosDePrueba(async (db) => {
      const [org] = await db.insert(esquema.organizations).values({ name: 'A' }).returning()
      const [marca] = await db
        .insert(esquema.brands)
        .values({ organizationId: org!.id, slug: 'a', name: 'A' })
        .returning()
      const [plan] = await db
        .insert(esquema.contentPlans)
        .values({ organizationId: org!.id, brandId: marca!.id, month: '2026-09-01' })
        .returning()
      const [padre] = await db
        .insert(esquema.planSlots)
        .values({
          organizationId: org!.id,
          contentPlanId: plan!.id,
          scheduledFor: new Date('2026-09-03T13:00:00Z'),
          channel: 'blog',
          format: 'articulo',
          pillar: 'educacion',
          angle: 'x',
          brief: 'Un brief suficientemente largo para pasar la validación.',
        })
        .returning()

      await db.insert(esquema.planSlots).values({
        organizationId: org!.id,
        contentPlanId: plan!.id,
        sourceSlotId: padre!.id,
        scheduledFor: new Date('2026-09-05T13:00:00Z'),
        channel: 'linkedin',
        format: 'derivado',
        pillar: 'educacion',
        angle: 'x',
        brief: 'Un brief suficientemente largo para pasar la validación.',
      })

      expect(await db.select().from(esquema.planSlots)).toHaveLength(2)
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
