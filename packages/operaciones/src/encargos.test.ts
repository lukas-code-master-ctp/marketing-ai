import { esquema } from '@gc/db'
import { conBaseDeDatosDePrueba } from '@gc/db/pruebas'
import { describe, expect, it } from 'vitest'
import { guardarEncargo, leerEncargo } from './encargos.js'

const ENCARGO = {
  objetivo: 'Vender las doce parcelas que quedan del loteo norte',
  comoSeMide: 'Formularios de contacto recibidos',
  publicacionesPorSemana: 4,
  canalesDisponibles: ['instagram', 'blog'],
  queEstaPasando: 'Empieza la temporada alta de visitas',
  queFunciono: '',
  queNoFunciono: '',
  queEvitar: '',
  algoMas: '',
}

async function sembrar(db: Parameters<Parameters<typeof conBaseDeDatosDePrueba>[0]>[0]) {
  const [org] = await db.insert(esquema.organizations)
    .values({ name: 'X', slug: 'x' }).returning()
  const [marca] = await db.insert(esquema.brands)
    .values({ organizationId: org!.id, slug: 'parcelas', name: 'CTP' }).returning()
  return { organizationId: org!.id, brandId: marca!.id }
}

describe('guardarEncargo y leerEncargo', () => {
  it('guarda y devuelve lo guardado', async () => {
    await conBaseDeDatosDePrueba(async (db) => {
      const ref = await sembrar(db)
      await guardarEncargo(db, ref.organizationId, {
        slug: 'parcelas', periodo: '2026-Q4', encargo: ENCARGO,
      })

      const r = await leerEncargo(db, ref.organizationId, { slug: 'parcelas', periodo: '2026-Q4' })
      expect(r.tipo).toBe('presente')
      if (r.tipo !== 'presente') throw new Error('inalcanzable')
      expect(r.encargo.objetivo).toBe(ENCARGO.objetivo)
      expect(r.encargo.canalesDisponibles).toEqual(['instagram', 'blog'])
    })
  })

  it('sin encargo escrito devuelve ausente', async () => {
    await conBaseDeDatosDePrueba(async (db) => {
      const ref = await sembrar(db)
      const r = await leerEncargo(db, ref.organizationId, { slug: 'parcelas', periodo: '2026-Q4' })
      expect(r.tipo).toBe('ausente')
    })
  })

  it('guardar dos veces el mismo trimestre corrige, no duplica', async () => {
    await conBaseDeDatosDePrueba(async (db) => {
      const ref = await sembrar(db)
      const args = { slug: 'parcelas', periodo: '2026-Q4' }
      await guardarEncargo(db, ref.organizationId, { ...args, encargo: ENCARGO })
      await guardarEncargo(db, ref.organizationId, {
        ...args, encargo: { ...ENCARGO, objetivo: 'Construir autoridad antes de vender nada' },
      })

      const filas = await db.select().from(esquema.strategyBriefs)
      expect(filas).toHaveLength(1)
      const r = await leerEncargo(db, ref.organizationId, args)
      if (r.tipo !== 'presente') throw new Error('inalcanzable')
      expect(r.encargo.objetivo).toBe('Construir autoridad antes de vender nada')
    })
  })

  it('rechaza un encargo que no cumple el esquema, sin escribir nada', async () => {
    await conBaseDeDatosDePrueba(async (db) => {
      const ref = await sembrar(db)
      await expect(
        guardarEncargo(db, ref.organizationId, {
          slug: 'parcelas', periodo: '2026-Q4', encargo: { ...ENCARGO, canalesDisponibles: [] },
        }),
      ).rejects.toThrow()
      expect(await db.select().from(esquema.strategyBriefs)).toHaveLength(0)
    })
  })

  it('con la estrategia fuera de borrador el encargo queda congelado', async () => {
    // Es lo que evita la mentira de leer un encargo que ya no es el que
    // produjo la estrategia que estás mirando.
    await conBaseDeDatosDePrueba(async (db) => {
      const ref = await sembrar(db)
      const args = { slug: 'parcelas', periodo: '2026-Q4' }
      await guardarEncargo(db, ref.organizationId, { ...args, encargo: ENCARGO })
      await db.insert(esquema.strategies).values({
        organizationId: ref.organizationId, brandId: ref.brandId, period: '2026-Q4',
        status: 'aprobada', data: {}, brandProfileVersion: 1,
      })

      await expect(
        guardarEncargo(db, ref.organizationId, { ...args, encargo: ENCARGO }),
      ).rejects.toThrow(/aprobada|borrador/i)
    })
  })

  it('con la estrategia archivada también queda congelado', async () => {
    // La condición es «el estado no es borrador», no «el estado es aprobada»:
    // una estrategia archivada tampoco se regenera.
    await conBaseDeDatosDePrueba(async (db) => {
      const ref = await sembrar(db)
      const args = { slug: 'parcelas', periodo: '2026-Q4' }
      await guardarEncargo(db, ref.organizationId, { ...args, encargo: ENCARGO })
      await db.insert(esquema.strategies).values({
        organizationId: ref.organizationId, brandId: ref.brandId, period: '2026-Q4',
        status: 'archivada', data: {}, brandProfileVersion: 1,
      })

      await expect(
        guardarEncargo(db, ref.organizationId, { ...args, encargo: ENCARGO }),
      ).rejects.toThrow()
    })
  })

  it('con la estrategia en borrador se puede seguir corrigiendo', async () => {
    await conBaseDeDatosDePrueba(async (db) => {
      const ref = await sembrar(db)
      const args = { slug: 'parcelas', periodo: '2026-Q4' }
      await guardarEncargo(db, ref.organizationId, { ...args, encargo: ENCARGO })
      await db.insert(esquema.strategies).values({
        organizationId: ref.organizationId, brandId: ref.brandId, period: '2026-Q4',
        status: 'borrador', data: {}, brandProfileVersion: 1,
      })

      await expect(
        guardarEncargo(db, ref.organizationId, {
          ...args, encargo: { ...ENCARGO, objetivo: 'Otro objetivo bien distinto del anterior' },
        }),
      ).resolves.toBeUndefined()
    })
  })

  it('una fila que dejó de cumplir el esquema se reporta como inválida', async () => {
    await conBaseDeDatosDePrueba(async (db) => {
      const ref = await sembrar(db)
      await db.insert(esquema.strategyBriefs).values({
        organizationId: ref.organizationId, brandId: ref.brandId,
        period: '2026-Q4', data: { objetivo: 'corto' },
      })

      const r = await leerEncargo(db, ref.organizationId, { slug: 'parcelas', periodo: '2026-Q4' })
      expect(r.tipo).toBe('invalido')
    })
  })

  it('un periodo mal formado se rechaza antes de tocar la base', async () => {
    await conBaseDeDatosDePrueba(async (db) => {
      const ref = await sembrar(db)
      await expect(
        guardarEncargo(db, ref.organizationId, {
          slug: 'parcelas', periodo: '2026-Q9', encargo: ENCARGO,
        }),
      ).rejects.toThrow()
    })
  })
})
