import { esquema } from '@gc/db'
import { conBaseDeDatosDePrueba } from '@gc/db/pruebas'
import { describe, expect, it } from 'vitest'
import { crearRegistrador, exigirPresupuesto, gastoDelMes, registrarLlamada, verificarPresupuesto } from './costos.js'
import type { UsoDeLlamada } from './ejecutar.js'

const USO = (costoUsd: number): UsoDeLlamada => ({
  tarea: 'generar_copy',
  modelo: 'proveedor/uno',
  tokensEntrada: 100,
  tokensSalida: 50,
  costoUsd,
  latenciaMs: 900,
  hashDePrompt: 'abc123',
})

const MES = new Date('2026-09-15T00:00:00Z')

async function sembrar(db: Parameters<Parameters<typeof conBaseDeDatosDePrueba>[0]>[0], presupuesto = '10.00') {
  const [org] = await db.insert(esquema.organizations).values({ name: 'X', slug: 'x' }).returning()
  const [marca] = await db
    .insert(esquema.brands)
    .values({ organizationId: org!.id, slug: 'a', name: 'A', monthlyBudgetUsd: presupuesto })
    .returning()
  return { orgId: org!.id, marcaId: marca!.id }
}

describe('costos y presupuesto', () => {
  it('registra la llamada con su costo y hash', async () => {
    await conBaseDeDatosDePrueba(async (db) => {
      const { orgId, marcaId } = await sembrar(db)
      await registrarLlamada(db, {
        organizationId: orgId,
        brandId: marcaId,
        uso: USO(0.0125),
        brandProfileVersion: 3,
      })

      const filas = await db.select().from(esquema.aiCalls)
      expect(filas).toHaveLength(1)
      expect(filas[0]!.task).toBe('generar_copy')
      expect(Number(filas[0]!.costUsd)).toBeCloseTo(0.0125, 6)
      expect(filas[0]!.brandProfileVersion).toBe(3)
    })
  })

  it('suma solo el gasto del mes consultado', async () => {
    await conBaseDeDatosDePrueba(async (db) => {
      const { orgId, marcaId } = await sembrar(db)
      await db.insert(esquema.aiCalls).values([
        { organizationId: orgId, brandId: marcaId, task: 't', model: 'm', costUsd: '1.00', promptHash: 'h', createdAt: new Date('2026-09-02T00:00:00Z') },
        { organizationId: orgId, brandId: marcaId, task: 't', model: 'm', costUsd: '2.50', promptHash: 'h', createdAt: new Date('2026-09-28T00:00:00Z') },
        { organizationId: orgId, brandId: marcaId, task: 't', model: 'm', costUsd: '9.00', promptHash: 'h', createdAt: new Date('2026-10-01T00:00:00Z') },
      ])

      expect(await gastoDelMes(db, marcaId, MES)).toBeCloseTo(3.5, 6)
    })
  })

  it.each([
    ['1.00', 'ok'],
    ['8.50', 'aviso'],
    ['10.00', 'agotado'],
    ['12.00', 'agotado'],
  ])('con %s gastado el estado es %s', async (gasto, esperado) => {
    await conBaseDeDatosDePrueba(async (db) => {
      const { orgId, marcaId } = await sembrar(db, '10.00')
      await db.insert(esquema.aiCalls).values({
        organizationId: orgId, brandId: marcaId, task: 't', model: 'm',
        costUsd: gasto, promptHash: 'h', createdAt: MES,
      })

      const estado = await verificarPresupuesto(db, marcaId, MES)
      expect(estado.estado).toBe(esperado)
      expect(estado.presupuestoUsd).toBe(10)
    })
  })

  it('exigirPresupuesto lanza un error permanente cuando está agotado', async () => {
    await conBaseDeDatosDePrueba(async (db) => {
      const { orgId, marcaId } = await sembrar(db, '5.00')
      await db.insert(esquema.aiCalls).values({
        organizationId: orgId, brandId: marcaId, task: 't', model: 'm',
        costUsd: '5.00', promptHash: 'h', createdAt: MES,
      })

      await expect(exigirPresupuesto(db, marcaId, MES)).rejects.toMatchObject({
        clase: 'permanente',
      })
    })
  })

  it('nombra la marca por su slug al cortar por presupuesto agotado', async () => {
    await conBaseDeDatosDePrueba(async (db) => {
      const { orgId, marcaId } = await sembrar(db, '5.00')
      await db.insert(esquema.aiCalls).values({
        organizationId: orgId, brandId: marcaId, task: 't', model: 'm',
        costUsd: '5.00', promptHash: 'h', createdAt: MES,
      })

      const error = await exigirPresupuesto(db, marcaId, MES, 'parcelas').catch(
        (e: unknown) => e as Error,
      )

      expect(error).toMatchObject({ clase: 'permanente' })
      expect((error as Error).message).toContain('parcelas')
      expect((error as Error).message).not.toContain(marcaId)
    })
  })

  it('nombra la marca por su slug cuando la marca ni siquiera existe', async () => {
    await conBaseDeDatosDePrueba(async (db) => {
      await sembrar(db)
      const fantasma = '00000000-0000-4000-8000-000000000000'

      const error = await exigirPresupuesto(db, fantasma, MES, 'parcelas').catch(
        (e: unknown) => e as Error,
      )

      expect((error as Error).message).toContain('parcelas')
      expect((error as Error).message).not.toContain(fantasma)
    })
  })

  it('crearRegistrador produce una función compatible con ejecutarTarea', async () => {
    await conBaseDeDatosDePrueba(async (db) => {
      const { orgId, marcaId } = await sembrar(db)
      const registrar = crearRegistrador(db, { organizationId: orgId, brandId: marcaId })
      await registrar(USO(0.002))

      expect(await db.select().from(esquema.aiCalls)).toHaveLength(1)
    })
  })
})
