import { ClienteFalso } from '@gc/ai'
import { PERFIL_VALIDO, guardarPerfil } from '@gc/brand'
import { esquema } from '@gc/db'
import { conBaseDeDatosDePrueba } from '@gc/db/pruebas'
import { ejecutarFlujo } from '@gc/pipeline'
import { eq } from 'drizzle-orm'
import { describe, expect, it } from 'vitest'
import { crearFlujoEstrategia } from './p1.js'

const ENV = { MODELO_RAZONAMIENTO: 'proveedor/fuerte' }
const SIN_ESPERA = { dormir: async () => {}, aleatorio: () => 0 }

const ESTRATEGIA_JSON = JSON.stringify({
  objetivos: [{ nombre: 'Autoridad', metrica: 'alcance', meta: '+30% trimestral' }],
  mensajesClave: ['La factibilidad se verifica antes de comprar', 'Trazabilidad legal completa'],
  mixDeCanales: [
    { canal: 'blog', publicacionesPorSemana: 1 },
    { canal: 'linkedin', publicacionesPorSemana: 2 },
  ],
  reciclaje: [{ desde: 'blog', hacia: ['linkedin'], diasDespues: 2 }],
  temasPrioritarios: ['Factibilidad de agua', 'Regularización de roles'],
})

async function sembrar(db: Parameters<Parameters<typeof conBaseDeDatosDePrueba>[0]>[0]) {
  const [org] = await db.insert(esquema.organizations).values({ name: 'X', slug: 'x' }).returning()
  const [marca] = await db
    .insert(esquema.brands)
    .values({ organizationId: org!.id, slug: 'parcelas', name: 'CTP' })
    .returning()
  const ref = { organizationId: org!.id, brandId: marca!.id }
  await guardarPerfil(db, ref, PERFIL_VALIDO)
  return ref
}

describe('flujo P1 · estrategia', () => {
  it('genera y persiste la estrategia fijando la versión del perfil', async () => {
    await conBaseDeDatosDePrueba(async (db) => {
      const ref = await sembrar(db)
      const cliente = new ClienteFalso([ESTRATEGIA_JSON])
      const flujo = crearFlujoEstrategia({ cliente, env: ENV })

      const r = await ejecutarFlujo(
        db, flujo, { brandId: ref.brandId, period: '2026-Q4' }, ref, SIN_ESPERA,
      )

      expect(r.estado).toBe('completado')
      const [fila] = await db.select().from(esquema.strategies)
      expect(fila!.period).toBe('2026-Q4')
      expect(fila!.status).toBe('borrador')
      expect(fila!.brandProfileVersion).toBe(1)
    })
  })

  it('envía el contexto de marca al modelo', async () => {
    await conBaseDeDatosDePrueba(async (db) => {
      const ref = await sembrar(db)
      const cliente = new ClienteFalso([ESTRATEGIA_JSON])
      const flujo = crearFlujoEstrategia({ cliente, env: ENV })

      await ejecutarFlujo(db, flujo, { brandId: ref.brandId, period: '2026-Q4' }, ref, SIN_ESPERA)

      const enviado = cliente.peticiones[0]!.mensajes.map((m) => m.texto).join('\n')
      expect(enviado).toContain('Pilares de contenido')
      expect(enviado).toContain('PROHIBIDO usar: Rentabilidad garantizada')
      expect(enviado).toContain('2026-Q4')
    })
  })

  it('registra el costo de la llamada', async () => {
    await conBaseDeDatosDePrueba(async (db) => {
      const ref = await sembrar(db)
      const flujo = crearFlujoEstrategia({ cliente: new ClienteFalso([ESTRATEGIA_JSON]), env: ENV })

      await ejecutarFlujo(db, flujo, { brandId: ref.brandId, period: '2026-Q4' }, ref, SIN_ESPERA)

      const llamadas = await db.select().from(esquema.aiCalls)
      expect(llamadas).toHaveLength(1)
      expect(llamadas[0]!.task).toBe('generar_estrategia')
      expect(llamadas[0]!.brandProfileVersion).toBe(1)
    })
  })

  it('se detiene si el presupuesto está agotado', async () => {
    await conBaseDeDatosDePrueba(async (db) => {
      const ref = await sembrar(db)
      await db.insert(esquema.aiCalls).values({
        organizationId: ref.organizationId, brandId: ref.brandId,
        task: 't', model: 'm', costUsd: '999.00', promptHash: 'h',
      })
      const flujo = crearFlujoEstrategia({ cliente: new ClienteFalso([ESTRATEGIA_JSON]), env: ENV })

      await expect(
        ejecutarFlujo(db, flujo, { brandId: ref.brandId, period: '2026-Q4' }, ref, SIN_ESPERA),
      ).rejects.toMatchObject({ clase: 'permanente' })
    })
  })

  it('reejecutar el mismo periodo reemplaza la estrategia en borrador', async () => {
    await conBaseDeDatosDePrueba(async (db) => {
      const ref = await sembrar(db)
      const entrada = { brandId: ref.brandId, period: '2026-Q4' }

      for (const _ of [1, 2]) {
        const flujo = crearFlujoEstrategia({ cliente: new ClienteFalso([ESTRATEGIA_JSON]), env: ENV })
        await ejecutarFlujo(db, flujo, entrada, ref, SIN_ESPERA)
      }

      expect(await db.select().from(esquema.strategies)).toHaveLength(1)
    })
  })

  it('no pisa una estrategia ya aprobada', async () => {
    await conBaseDeDatosDePrueba(async (db) => {
      const ref = await sembrar(db)
      const entrada = { brandId: ref.brandId, period: '2026-Q4' }

      const flujo = crearFlujoEstrategia({ cliente: new ClienteFalso([ESTRATEGIA_JSON]), env: ENV })
      await ejecutarFlujo(db, flujo, entrada, ref, SIN_ESPERA)

      await db
        .update(esquema.strategies)
        .set({ status: 'aprobada', data: { marca: 'revisada a mano' } })
        .where(eq(esquema.strategies.brandId, ref.brandId))

      const otro = crearFlujoEstrategia({ cliente: new ClienteFalso([ESTRATEGIA_JSON]), env: ENV })
      await expect(
        ejecutarFlujo(db, otro, entrada, ref, SIN_ESPERA),
      ).rejects.toMatchObject({ clase: 'permanente' })

      const [fila] = await db.select().from(esquema.strategies)
      expect(fila!.status).toBe('aprobada')
      expect(fila!.data).toEqual({ marca: 'revisada a mano' })
    })
  })

  it('nombra el estado real y no gasta llamadas al reintentar sobre una aprobada', async () => {
    await conBaseDeDatosDePrueba(async (db) => {
      const ref = await sembrar(db)
      await db.insert(esquema.strategies).values({
        organizationId: ref.organizationId,
        brandId: ref.brandId,
        period: '2026-Q4',
        status: 'aprobada',
        data: { marca: 'revisada a mano' },
        brandProfileVersion: 1,
      })

      const cliente = new ClienteFalso([ESTRATEGIA_JSON])
      const flujo = crearFlujoEstrategia({ cliente, env: ENV })

      await expect(
        ejecutarFlujo(db, flujo, { brandId: ref.brandId, period: '2026-Q4' }, ref, SIN_ESPERA),
      ).rejects.toThrow(/"aprobada"/)

      // El estado ya condena la regeneración: ni una llamada al modelo.
      expect(cliente.peticiones).toHaveLength(0)
      expect(await db.select().from(esquema.aiCalls)).toHaveLength(0)
    })
  })

  it('nombra el estado archivada, que el upsert tampoco deja regenerar', async () => {
    await conBaseDeDatosDePrueba(async (db) => {
      const ref = await sembrar(db)
      await db.insert(esquema.strategies).values({
        organizationId: ref.organizationId,
        brandId: ref.brandId,
        period: '2026-Q4',
        status: 'archivada',
        data: { marca: 'vieja' },
        brandProfileVersion: 1,
      })

      const flujo = crearFlujoEstrategia({ cliente: new ClienteFalso([ESTRATEGIA_JSON]), env: ENV })
      await expect(
        ejecutarFlujo(db, flujo, { brandId: ref.brandId, period: '2026-Q4' }, ref, SIN_ESPERA),
      ).rejects.toThrow(/"archivada".*borrador/s)
    })
  })

  it('rechaza un periodo con formato inválido antes de gastar', async () => {
    await conBaseDeDatosDePrueba(async (db) => {
      const ref = await sembrar(db)
      const cliente = new ClienteFalso([ESTRATEGIA_JSON])
      const flujo = crearFlujoEstrategia({ cliente, env: ENV })

      await expect(
        ejecutarFlujo(db, flujo, { brandId: ref.brandId, period: '2026-3' }, ref, SIN_ESPERA),
      ).rejects.toMatchObject({ clase: 'permanente' })

      expect(cliente.peticiones).toHaveLength(0)
      expect(await db.select().from(esquema.aiCalls)).toHaveLength(0)
    })
  })
})
