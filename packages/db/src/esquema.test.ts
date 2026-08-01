import { eq, sql } from 'drizzle-orm'
import { describe, expect, it } from 'vitest'
import type { BaseDeDatos } from './cliente.js'
import { esquema } from './esquema.js'
import { conBaseDeDatosDePrueba } from './pruebas/entorno.js'

describe('esquema', () => {
  it('crea organización, marca y perfil versionado', async () => {
    await conBaseDeDatosDePrueba(async (db) => {
      const [org] = await db
        .insert(esquema.organizations)
        .values({ name: 'Mis Startups', slug: 'a' })
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
        .values({ name: 'X', slug: 'a' })
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
        .values({ name: 'X', slug: 'a' })
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
        .values({ name: 'X', slug: 'a' })
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
        .values({ name: 'X', slug: 'a' })
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
      const [orgA] = await db
        .insert(esquema.organizations)
        .values({ name: 'A', slug: 'a' })
        .returning()
      const [orgB] = await db
        .insert(esquema.organizations)
        .values({ name: 'B', slug: 'b' })
        .returning()
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
      ).rejects.toThrow(/brand_profiles_brand_org_fk/)
    })
  })

  it('rechaza un plan que apunta a una estrategia de otra organización', async () => {
    await conBaseDeDatosDePrueba(async (db) => {
      const [orgA] = await db
        .insert(esquema.organizations)
        .values({ name: 'A', slug: 'a' })
        .returning()
      const [orgB] = await db
        .insert(esquema.organizations)
        .values({ name: 'B', slug: 'b' })
        .returning()
      const [marcaA] = await db
        .insert(esquema.brands)
        .values({ organizationId: orgA!.id, slug: 'a', name: 'A' })
        .returning()
      const [marcaB] = await db
        .insert(esquema.brands)
        .values({ organizationId: orgB!.id, slug: 'b', name: 'B' })
        .returning()
      const [estrategiaDeB] = await db
        .insert(esquema.strategies)
        .values({
          organizationId: orgB!.id,
          brandId: marcaB!.id,
          period: '2026-Q3',
          data: {},
          brandProfileVersion: 1,
        })
        .returning()

      // El plan es de orgA; la estrategia que referencia es de orgB. P2 lee la
      // estrategia del plan, así que sin esta compuesta el join serviría la
      // estrategia de otro inquilino.
      await expect(
        db.insert(esquema.contentPlans).values({
          organizationId: orgA!.id,
          brandId: marcaA!.id,
          strategyId: estrategiaDeB!.id,
          month: '2026-09-01',
        }),
      ).rejects.toThrow(/content_plans_strategy_org_fk/)
    })
  })

  // Mismo trato que el registro de costo: borrar una estrategia no puede
  // llevarse por delante los planes que la referencian.
  it('conserva los planes al borrar su estrategia, anulando solo strategy_id', async () => {
    await conBaseDeDatosDePrueba(async (db) => {
      const [org] = await db
        .insert(esquema.organizations)
        .values({ name: 'A', slug: 'a' })
        .returning()
      const [marca] = await db
        .insert(esquema.brands)
        .values({ organizationId: org!.id, slug: 'a', name: 'A' })
        .returning()
      const [estrategia] = await db
        .insert(esquema.strategies)
        .values({
          organizationId: org!.id,
          brandId: marca!.id,
          period: '2026-Q3',
          data: {},
          brandProfileVersion: 1,
        })
        .returning()
      await db.insert(esquema.contentPlans).values({
        organizationId: org!.id,
        brandId: marca!.id,
        strategyId: estrategia!.id,
        month: '2026-09-01',
      })

      await db.delete(esquema.strategies).where(eq(esquema.strategies.id, estrategia!.id))

      const planes = await db.select().from(esquema.contentPlans)
      expect(planes).toHaveLength(1)
      expect(planes[0]!.strategyId).toBeNull()
      expect(planes[0]!.organizationId).toBe(org!.id)
      expect(planes[0]!.brandId).toBe(marca!.id)
    })
  })

  it('rechaza un slot cuya organización no coincide con la de su plan', async () => {
    await conBaseDeDatosDePrueba(async (db) => {
      const [orgA] = await db
        .insert(esquema.organizations)
        .values({ name: 'A', slug: 'a' })
        .returning()
      const [orgB] = await db
        .insert(esquema.organizations)
        .values({ name: 'B', slug: 'b' })
        .returning()
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
      ).rejects.toThrow(/plan_slots_plan_org_fk/)
    })
  })

  it('rechaza un derivado que apunta a un slot de otra organización', async () => {
    await conBaseDeDatosDePrueba(async (db) => {
      const [orgA] = await db
        .insert(esquema.organizations)
        .values({ name: 'A', slug: 'a' })
        .returning()
      const [orgB] = await db
        .insert(esquema.organizations)
        .values({ name: 'B', slug: 'b' })
        .returning()

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
      ).rejects.toThrow(/plan_slots_source_org_fk/)
    })
  })

  // El registro de costo tiene que sobrevivir a su corrida: es lo que suma el
  // guardián de presupuesto. Si al borrar un `pipeline_run` se perdiera el
  // gasto histórico, se debilitaría en silencio la única barrera del sistema
  // con dinero detrás.
  it('conserva la llamada de IA al borrar su corrida, anulando solo run_id', async () => {
    await conBaseDeDatosDePrueba(async (db) => {
      const [org] = await db
        .insert(esquema.organizations)
        .values({ name: 'A', slug: 'a' })
        .returning()
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
      const [org] = await db
        .insert(esquema.organizations)
        .values({ name: 'A', slug: 'a' })
        .returning()
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

async function sembrarPadreConDerivado(db: BaseDeDatos) {
  const [org] = await db
    .insert(esquema.organizations)
    .values({ name: 'Cascada', slug: 'cascada' })
    .returning()
  const [marca] = await db
    .insert(esquema.brands)
    .values({ organizationId: org!.id, slug: 'c', name: 'C' })
    .returning()
  const [plan] = await db
    .insert(esquema.contentPlans)
    .values({ organizationId: org!.id, brandId: marca!.id, month: '2026-09-01' })
    .returning()

  const fila = (sourceSlotId: string | null, canal: 'blog' | 'linkedin', dia: string) => ({
    organizationId: org!.id,
    contentPlanId: plan!.id,
    sourceSlotId,
    scheduledFor: new Date(`2026-09-${dia}T13:00:00Z`),
    channel: canal,
    format: sourceSlotId ? 'derivado' : 'articulo',
    pillar: 'educacion',
    angle: 'x',
    brief: 'Un brief suficientemente largo para pasar la validación.',
  })

  const [padre] = await db.insert(esquema.planSlots).values(fila(null, 'blog', '03')).returning()
  await db.insert(esquema.planSlots).values(fila(padre!.id, 'linkedin', '05'))

  return { planId: plan!.id, padreId: padre!.id }
}

describe('borrado de plan_slots con derivados', () => {
  // Esta es la prueba que fija la decisión: es la única que falla si alguien
  // devuelve la clave a CASCADE, porque entonces el borrado del padre pasa y
  // se lleva al derivado. La de abajo pasa con CASCADE, RESTRICT y NO ACTION
  // por igual, así que no sirve de guardia: solo documenta el camino feliz.
  it('impide borrar un slot que todavía tiene derivados', async () => {
    await conBaseDeDatosDePrueba(async (db) => {
      const { padreId } = await sembrarPadreConDerivado(db)

      await expect(
        db.delete(esquema.planSlots).where(eq(esquema.planSlots.id, padreId)),
      ).rejects.toThrow(/plan_slots_source_org_fk/)

      // El derivado sigue vivo: nada se perdió en silencio.
      expect(await db.select().from(esquema.planSlots)).toHaveLength(2)
    })
  })

  it('permite borrar el plan entero, padres y derivados en una sola sentencia', async () => {
    await conBaseDeDatosDePrueba(async (db) => {
      const { planId } = await sembrarPadreConDerivado(db)

      // Es el camino que usa la regeneración de grilla. Funciona porque la
      // restricción es NOT DEFERRABLE y se verifica al final de la sentencia,
      // cuando los hijos ya se fueron —con NO ACTION y con RESTRICT por igual.
      await db.delete(esquema.planSlots).where(eq(esquema.planSlots.contentPlanId, planId))

      expect(await db.select().from(esquema.planSlots)).toHaveLength(0)
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
        .values({ name: 'X', slug: 'a' })
        .returning()

      await expect(intentarInsertar(db, org!)).rejects.toThrow()
    })
  })
})

/**
 * Catálogo, no comportamiento. Las pruebas de arriba solo se disparan cuando
 * alguien borra o inserta la fila justa, así que siete de las doce compuestas
 * no las cubre ninguna. Bastaría un `drizzle-kit generate` que reescriba una
 * migración para que la barrera desapareciera con la suite en verde.
 *
 * Se compara la definición completa a propósito: es lo que delata un `ON
 * DELETE` perdido, un destino renombrado y —sobre todo— la reaparición de un
 * `SET NULL` pelado donde van `SET NULL (run_id)` y `SET NULL (strategy_id)`,
 * las dos columnas que sostienen el gasto histórico y el vínculo del plan con
 * su estrategia.
 */
describe('catálogo de restricciones compuestas', () => {
  interface FilaDeRestriccion {
    tabla: string
    conname: string
    definicion: string
  }

  const FK: FilaDeRestriccion[] = [
    {
      tabla: 'ai_calls',
      conname: 'ai_calls_brand_org_fk',
      definicion:
        'FOREIGN KEY (brand_id, organization_id) REFERENCES brands(id, organization_id) ON DELETE CASCADE',
    },
    {
      tabla: 'ai_calls',
      conname: 'ai_calls_run_org_fk',
      definicion:
        'FOREIGN KEY (run_id, organization_id) REFERENCES pipeline_runs(id, organization_id) ON DELETE SET NULL (run_id)',
    },
    {
      tabla: 'approval_policies',
      conname: 'approval_policies_brand_org_fk',
      definicion:
        'FOREIGN KEY (brand_id, organization_id) REFERENCES brands(id, organization_id) ON DELETE CASCADE',
    },
    {
      tabla: 'brand_profiles',
      conname: 'brand_profiles_brand_org_fk',
      definicion:
        'FOREIGN KEY (brand_id, organization_id) REFERENCES brands(id, organization_id) ON DELETE CASCADE',
    },
    {
      tabla: 'channel_accounts',
      conname: 'channel_accounts_brand_org_fk',
      definicion:
        'FOREIGN KEY (brand_id, organization_id) REFERENCES brands(id, organization_id) ON DELETE CASCADE',
    },
    {
      tabla: 'content_plans',
      conname: 'content_plans_brand_org_fk',
      definicion:
        'FOREIGN KEY (brand_id, organization_id) REFERENCES brands(id, organization_id) ON DELETE CASCADE',
    },
    {
      tabla: 'content_plans',
      conname: 'content_plans_strategy_org_fk',
      definicion:
        'FOREIGN KEY (strategy_id, organization_id) REFERENCES strategies(id, organization_id) ON DELETE SET NULL (strategy_id)',
    },
    {
      tabla: 'pipeline_runs',
      conname: 'pipeline_runs_brand_org_fk',
      definicion:
        'FOREIGN KEY (brand_id, organization_id) REFERENCES brands(id, organization_id) ON DELETE CASCADE',
    },
    {
      tabla: 'pipeline_steps',
      conname: 'pipeline_steps_run_org_fk',
      definicion:
        'FOREIGN KEY (run_id, organization_id) REFERENCES pipeline_runs(id, organization_id) ON DELETE CASCADE',
    },
    {
      tabla: 'plan_slots',
      conname: 'plan_slots_plan_org_fk',
      definicion:
        'FOREIGN KEY (content_plan_id, organization_id) REFERENCES content_plans(id, organization_id) ON DELETE CASCADE',
    },
    {
      tabla: 'plan_slots',
      conname: 'plan_slots_source_org_fk',
      definicion:
        'FOREIGN KEY (source_slot_id, organization_id) REFERENCES plan_slots(id, organization_id)',
    },
    {
      tabla: 'strategies',
      conname: 'strategies_brand_org_fk',
      definicion:
        'FOREIGN KEY (brand_id, organization_id) REFERENCES brands(id, organization_id) ON DELETE CASCADE',
    },
  ]

  // Las cinco `(id, organization_id)` son el otro lado del trato: sin ellas
  // ninguna de las doce compuestas de arriba podría siquiera declararse. Se
  // listan junto al resto de las únicas compuestas porque filtrar por su
  // definición volvería tautológica justo la comparación que interesa.
  const UNICAS: FilaDeRestriccion[] = [
    {
      tabla: 'approval_policies',
      conname: 'approval_policies_brand_id_channel_unique',
      definicion: 'UNIQUE (brand_id, channel)',
    },
    {
      tabla: 'brand_profiles',
      conname: 'brand_profiles_brand_id_version_unique',
      definicion: 'UNIQUE (brand_id, version)',
    },
    {
      tabla: 'brands',
      conname: 'brands_id_organization_id_unique',
      definicion: 'UNIQUE (id, organization_id)',
    },
    {
      tabla: 'brands',
      conname: 'brands_organization_id_slug_unique',
      definicion: 'UNIQUE (organization_id, slug)',
    },
    {
      tabla: 'channel_accounts',
      conname: 'channel_accounts_brand_id_channel_unique',
      definicion: 'UNIQUE (brand_id, channel)',
    },
    {
      tabla: 'content_plans',
      conname: 'content_plans_brand_id_month_unique',
      definicion: 'UNIQUE (brand_id, month)',
    },
    {
      tabla: 'content_plans',
      conname: 'content_plans_id_organization_id_unique',
      definicion: 'UNIQUE (id, organization_id)',
    },
    {
      tabla: 'pipeline_runs',
      conname: 'pipeline_runs_id_organization_id_unique',
      definicion: 'UNIQUE (id, organization_id)',
    },
    {
      tabla: 'plan_slots',
      conname: 'plan_slots_id_organization_id_unique',
      definicion: 'UNIQUE (id, organization_id)',
    },
    {
      tabla: 'strategies',
      conname: 'strategies_brand_id_period_unique',
      definicion: 'UNIQUE (brand_id, period)',
    },
    {
      tabla: 'strategies',
      conname: 'strategies_id_organization_id_unique',
      definicion: 'UNIQUE (id, organization_id)',
    },
  ]

  const leer = async (db: BaseDeDatos, tipo: 'f' | 'u') => {
    const filas = await db.execute(sql`
      select conrelid::regclass::text as tabla, conname, pg_get_constraintdef(oid) as definicion
      from pg_constraint
      where contype = ${tipo}
        and connamespace = 'public'::regnamespace
        and array_length(conkey, 1) > 1
      order by conrelid::regclass::text, conname
    `)
    return [...filas] as unknown as FilaDeRestriccion[]
  }

  it('declara exactamente las doce foráneas compuestas esperadas', async () => {
    await conBaseDeDatosDePrueba(async (db) => {
      expect(await leer(db, 'f')).toEqual(FK)
    })
  })

  it('declara las únicas compuestas, entre ellas las cinco (id, organization_id)', async () => {
    await conBaseDeDatosDePrueba(async (db) => {
      expect(await leer(db, 'u')).toEqual(UNICAS)
    })
  })
})

describe('slug en organizations', () => {
  it('exige slug único en organizations', async () => {
    await conBaseDeDatosDePrueba(async (db) => {
      await db.insert(esquema.organizations).values({ name: 'A', slug: 'a' })

      await expect(
        db.insert(esquema.organizations).values({ name: 'Otra', slug: 'a' }),
      ).rejects.toThrow()
    })
  })

  it('no acepta una organización sin slug', async () => {
    await conBaseDeDatosDePrueba(async (db) => {
      await expect(
        db.insert(esquema.organizations).values({ name: 'Sin slug' } as never),
      ).rejects.toThrow()
    })
  })
})
