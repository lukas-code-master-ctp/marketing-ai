import { conBaseDeDatosDePrueba } from '@gc/db/pruebas'
import { esquema } from '@gc/db'
import { describe, expect, it } from 'vitest'
import { leerEstrategiaDelTrimestre } from './estrategias.js'

const ESTRATEGIA_VALIDA = {
  objetivos: [{ nombre: 'Reconocimiento', metrica: 'Alcance mensual', meta: '50k' }],
  mensajesClave: ['Parcelas con agua y luz', 'Financiamiento directo sin banco'],
  mixDeCanales: [{ canal: 'instagram', publicacionesPorSemana: 3 }],
  reciclaje: [],
  temasPrioritarios: ['Riego tecnificado'],
}

/** Organización + marca + una estrategia con el estado que se pida. */
async function sembrar(db: Parameters<Parameters<typeof conBaseDeDatosDePrueba>[0]>[0], estado: string, datos: unknown = ESTRATEGIA_VALIDA) {
  const [org] = await db
    .insert(esquema.organizations)
    .values({ name: 'Principal', slug: 'principal' })
    .returning({ id: esquema.organizations.id })
  const [marca] = await db
    .insert(esquema.brands)
    .values({ organizationId: org!.id, slug: 'parcelas', name: 'Parcelas' })
    .returning({ id: esquema.brands.id })
  await db.insert(esquema.strategies).values({
    organizationId: org!.id,
    brandId: marca!.id,
    period: '2026-Q3',
    status: estado as 'borrador',
    data: datos,
    brandProfileVersion: 1,
  })
  return marca!.id
}

describe('leerEstrategiaDelTrimestre', () => {
  it('con archivadas: "excluir" no devuelve una archivada', async () => {
    await conBaseDeDatosDePrueba(async (db) => {
      const brandId = await sembrar(db, 'archivada')
      const r = await leerEstrategiaDelTrimestre(db, brandId, '2026-09', { archivadas: 'excluir' })
      expect(r.tipo).toBe('ausente')
      expect(r.periodo).toBe('2026-Q3')
    })
  })

  it('con archivadas: "incluir" sí devuelve una archivada, con su estado', async () => {
    await conBaseDeDatosDePrueba(async (db) => {
      const brandId = await sembrar(db, 'archivada')
      const r = await leerEstrategiaDelTrimestre(db, brandId, '2026-09', { archivadas: 'incluir' })
      expect(r.tipo).toBe('ok')
      if (r.tipo !== 'ok') throw new Error('inalcanzable')
      expect(r.estado).toBe('archivada')
      expect(r.estrategia.mixDeCanales[0]!.canal).toBe('instagram')
    })
  })

  it('una estrategia corrupta sale como "invalida" por las dos políticas', async () => {
    await conBaseDeDatosDePrueba(async (db) => {
      const brandId = await sembrar(db, 'aprobada', { objetivos: 'esto no es un arreglo' })
      for (const archivadas of ['excluir', 'incluir'] as const) {
        const r = await leerEstrategiaDelTrimestre(db, brandId, '2026-09', { archivadas })
        expect(r.tipo).toBe('invalida')
        if (r.tipo !== 'invalida') throw new Error('inalcanzable')
        expect(r.estado).toBe('aprobada')
      }
    })
  })

  it('sin estrategia para el trimestre devuelve "ausente" nombrando el periodo', async () => {
    await conBaseDeDatosDePrueba(async (db) => {
      const brandId = await sembrar(db, 'aprobada')
      const r = await leerEstrategiaDelTrimestre(db, brandId, '2026-12', { archivadas: 'incluir' })
      expect(r).toEqual({ tipo: 'ausente', periodo: '2026-Q4' })
    })
  })
})
