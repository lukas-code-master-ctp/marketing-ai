import { esquema } from '@gc/db'
import { conBaseDeDatosDePrueba } from '@gc/db/pruebas'
import { describe, expect, it } from 'vitest'
import { piezasDelMes, resumenDePiezas } from './piezas.js'

const MES = '2026-09'

const PIEZA_LINKEDIN = {
  canal: 'linkedin' as const,
  gancho: 'El gancho de la pieza',
  cuerpo: 'El cuerpo largo de la pieza, con más de veinte caracteres.',
  hashtags: ['#parcelas', '#chile'],
}

async function sembrar(
  db: Parameters<Parameters<typeof conBaseDeDatosDePrueba>[0]>[0],
  organizacion: { slug: string; nombre: string } = { slug: 'x', nombre: 'X' },
) {
  const [org] = await db.insert(esquema.organizations)
    .values({ name: organizacion.nombre, slug: organizacion.slug }).returning()
  const [marca] = await db.insert(esquema.brands)
    .values({ organizationId: org!.id, slug: 'parcelas', name: 'CTP' }).returning()
  const [plan] = await db.insert(esquema.contentPlans)
    .values({ organizationId: org!.id, brandId: marca!.id, month: `${MES}-01`, status: 'aprobada' })
    .returning()
  const slots = await db.insert(esquema.planSlots)
    .values([
      {
        organizationId: org!.id, contentPlanId: plan!.id,
        scheduledFor: new Date('2026-09-01T10:00:00Z'), channel: 'linkedin', format: 'post',
        pillar: 'educacion', angle: 'Ángulo uno', brief: 'Brief del primer slot',
      },
      {
        organizationId: org!.id, contentPlanId: plan!.id,
        scheduledFor: new Date('2026-09-05T10:00:00Z'), channel: 'blog', format: 'articulo',
        pillar: 'educacion', angle: 'Ángulo dos', brief: 'Brief del segundo slot',
      },
      {
        organizationId: org!.id, contentPlanId: plan!.id,
        scheduledFor: new Date('2026-09-10T10:00:00Z'), channel: 'facebook', format: 'post',
        pillar: 'educacion', angle: 'Ángulo tres', brief: 'Brief del tercer slot',
        status: 'descartado',
      },
    ])
    .returning()

  return { organizationId: org!.id, brandId: marca!.id, planId: plan!.id, slots }
}

async function insertarCorrida(
  db: Parameters<Parameters<typeof conBaseDeDatosDePrueba>[0]>[0],
  args: {
    organizationId: string; brandId: string; slotId: string; mes: string
    status: 'fallido' | 'en_curso'
  },
) {
  await db.insert(esquema.pipelineRuns).values({
    organizationId: args.organizationId,
    brandId: args.brandId,
    flow: 'p3_pieza',
    status: args.status,
    input: { slotId: args.slotId, mes: args.mes, brandId: args.brandId },
  })
}

describe('resumenDePiezas', () => {
  it('cuenta los slots no descartados como total', async () => {
    await conBaseDeDatosDePrueba(async (db) => {
      const ref = await sembrar(db)
      const r = await resumenDePiezas(db, ref.organizationId, { slug: 'parcelas', mes: MES })
      expect(r.total).toBe(2)
    })
  })

  it('sin ninguna pieza, listas es cero', async () => {
    await conBaseDeDatosDePrueba(async (db) => {
      const ref = await sembrar(db)
      const r = await resumenDePiezas(db, ref.organizationId, { slug: 'parcelas', mes: MES })
      expect(r.listas).toBe(0)
    })
  })

  it('cuenta las piezas escritas', async () => {
    await conBaseDeDatosDePrueba(async (db) => {
      const ref = await sembrar(db)
      await db.insert(esquema.contentPieces).values({
        organizationId: ref.organizationId,
        planSlotId: ref.slots[0]!.id,
        channel: 'linkedin',
        data: PIEZA_LINKEDIN,
        brandProfileVersion: 1,
      })

      const r = await resumenDePiezas(db, ref.organizationId, { slug: 'parcelas', mes: MES })
      expect(r.listas).toBe(1)
    })
  })

  it('cuenta las corridas fallidas del mes', async () => {
    await conBaseDeDatosDePrueba(async (db) => {
      const ref = await sembrar(db)
      await insertarCorrida(db, {
        organizationId: ref.organizationId, brandId: ref.brandId,
        slotId: ref.slots[0]!.id, mes: MES, status: 'fallido',
      })

      const r = await resumenDePiezas(db, ref.organizationId, { slug: 'parcelas', mes: MES })
      expect(r.fallidas).toBe(1)
    })
  })

  it('cuenta las corridas vivas del mes', async () => {
    await conBaseDeDatosDePrueba(async (db) => {
      const ref = await sembrar(db)
      await insertarCorrida(db, {
        organizationId: ref.organizationId, brandId: ref.brandId,
        slotId: ref.slots[1]!.id, mes: MES, status: 'en_curso',
      })

      const r = await resumenDePiezas(db, ref.organizationId, { slug: 'parcelas', mes: MES })
      expect(r.enVuelo).toBe(1)
    })
  })

  it('no cuenta corridas de otro mes ni de otro flujo', async () => {
    await conBaseDeDatosDePrueba(async (db) => {
      const ref = await sembrar(db)
      // Otro mes, mismo flujo.
      await insertarCorrida(db, {
        organizationId: ref.organizationId, brandId: ref.brandId,
        slotId: ref.slots[0]!.id, mes: '2026-10', status: 'fallido',
      })
      // Mismo mes, otro flujo.
      await db.insert(esquema.pipelineRuns).values({
        organizationId: ref.organizationId,
        brandId: ref.brandId,
        flow: 'p2_grilla',
        status: 'en_curso',
        input: { mes: MES, brandId: ref.brandId },
      })

      const r = await resumenDePiezas(db, ref.organizationId, { slug: 'parcelas', mes: MES })
      expect(r.fallidas).toBe(0)
      expect(r.enVuelo).toBe(0)
    })
  })

  it('otra organización con una marca del mismo slug ve solo su propio resumen', async () => {
    // El mismo espíritu que la prueba de tenencia en encargos.test.ts:
    // resolverMarca filtra por organizationId, no solo por slug. La versión
    // que solo comprueba "B no ve nada" no basta acá: como brandId es un UUID
    // globalmente único, si resolverMarca resolviera la marca de la
    // organización A para una llamada de B, las cinco condiciones
    // `eq(..., organizationId)` de piezas.ts —que ya usan el organizationId
    // correcto, el que llega como argumento— igual filtrarían todo a cero, y
    // la prueba pasaría en verde sin haber probado nada. Por eso B necesita
    // sus propios datos: si resolverMarca le entrega el brandId equivocado,
    // el resumen de B deja de ver también los suyos, y eso sí lo pone rojo.
    await conBaseDeDatosDePrueba(async (db) => {
      const refA = await sembrar(db)
      await db.insert(esquema.contentPieces).values({
        organizationId: refA.organizationId,
        planSlotId: refA.slots[0]!.id,
        channel: 'linkedin',
        data: PIEZA_LINKEDIN,
        brandProfileVersion: 1,
      })
      await insertarCorrida(db, {
        organizationId: refA.organizationId, brandId: refA.brandId,
        slotId: refA.slots[1]!.id, mes: MES, status: 'fallido',
      })

      const refB = await sembrar(db, { slug: 'y', nombre: 'Y' })
      await db.insert(esquema.contentPieces).values({
        organizationId: refB.organizationId,
        planSlotId: refB.slots[0]!.id,
        channel: 'linkedin',
        data: PIEZA_LINKEDIN,
        brandProfileVersion: 1,
      })

      // B tiene los mismos dos slots vigentes que A (misma siembra), pero
      // solo una pieza y ninguna corrida fallida: si B viera lo de A, alguno
      // de estos cuatro números cambiaría.
      const r = await resumenDePiezas(db, refB.organizationId, { slug: 'parcelas', mes: MES })
      expect(r).toEqual({ total: 2, listas: 1, fallidas: 0, enVuelo: 0 })
    })
  })
})

describe('piezasDelMes', () => {
  it('devuelve un mapa de slot a pieza', async () => {
    await conBaseDeDatosDePrueba(async (db) => {
      const ref = await sembrar(db)
      await db.insert(esquema.contentPieces).values({
        organizationId: ref.organizationId,
        planSlotId: ref.slots[0]!.id,
        channel: 'linkedin',
        data: PIEZA_LINKEDIN,
        brandProfileVersion: 1,
      })

      const mapa = await piezasDelMes(db, ref.organizationId, { slug: 'parcelas', mes: MES })
      expect(mapa.size).toBe(1)
      const pieza = mapa.get(ref.slots[0]!.id)
      expect(pieza).toMatchObject({ canal: 'linkedin', gancho: PIEZA_LINKEDIN.gancho })
    })
  })

  it('omite una fila cuyo data no valida, sin lanzar', async () => {
    await conBaseDeDatosDePrueba(async (db) => {
      const ref = await sembrar(db)
      await db.insert(esquema.contentPieces).values({
        organizationId: ref.organizationId,
        planSlotId: ref.slots[0]!.id,
        channel: 'linkedin',
        data: { canal: 'linkedin', gancho: 'muy corto pero sin cuerpo ni hashtags' },
        brandProfileVersion: 1,
      })

      const mapa = await piezasDelMes(db, ref.organizationId, { slug: 'parcelas', mes: MES })
      expect(mapa.size).toBe(0)
    })
  })

  it('otra organización con una marca del mismo slug ve solo su propia pieza', async () => {
    // Mismo escenario que la prueba análoga de resumenDePiezas, y por el
    // mismo motivo: piezasDelMes junta contentPieces con planSlots y
    // contentPlans, y las tres condiciones `eq(..., organizationId)` de esa
    // consulta ya usan el organizationId correcto (el argumento), así que una
    // B sin datos propios pasaría en verde aunque resolverMarca resolviera
    // mal la marca. Dándole a B su propia pieza, el mapa que le corresponde
    // tiene que traer esa pieza y ninguna otra.
    await conBaseDeDatosDePrueba(async (db) => {
      const refA = await sembrar(db)
      await db.insert(esquema.contentPieces).values({
        organizationId: refA.organizationId,
        planSlotId: refA.slots[0]!.id,
        channel: 'linkedin',
        data: PIEZA_LINKEDIN,
        brandProfileVersion: 1,
      })

      const refB = await sembrar(db, { slug: 'y', nombre: 'Y' })
      await db.insert(esquema.contentPieces).values({
        organizationId: refB.organizationId,
        planSlotId: refB.slots[0]!.id,
        channel: 'linkedin',
        data: PIEZA_LINKEDIN,
        brandProfileVersion: 1,
      })

      const mapa = await piezasDelMes(db, refB.organizationId, { slug: 'parcelas', mes: MES })
      expect(mapa.size).toBe(1)
      expect(mapa.has(refB.slots[0]!.id)).toBe(true)
      expect(mapa.has(refA.slots[0]!.id)).toBe(false)
    })
  })
})
