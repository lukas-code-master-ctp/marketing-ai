import { PERFIL_VALIDO } from '@gc/brand'
import { esquema } from '@gc/db'
import { conBaseDeDatosDePrueba } from '@gc/db/pruebas'
import { eq } from 'drizzle-orm'
import { describe, expect, it } from 'vitest'
import {
  PLANTILLA_DE_PERFIL,
  cargarPerfilDeObjeto,
  estrategiaDelTrimestre,
  perfilConHistorial,
} from './perfiles.js'
import { sembrarConEstrategia, sembrarConGrilla } from './pruebas/siembra.js'

async function sembrar(db: Parameters<Parameters<typeof conBaseDeDatosDePrueba>[0]>[0]) {
  const [org] = await db.insert(esquema.organizations).values({ name: 'X', slug: 'x' }).returning()
  const [marca] = await db
    .insert(esquema.brands)
    .values({ organizationId: org!.id, slug: 'parcelas', name: 'CTP' })
    .returning()
  return { organizationId: org!.id, brandId: marca!.id }
}

describe('perfilConHistorial', () => {
  it('devuelve el perfil vigente y el historial de versiones', async () => {
    await conBaseDeDatosDePrueba(async (db) => {
      const ref = await sembrar(db)
      await cargarPerfilDeObjeto(db, ref.organizationId, { slug: 'parcelas', perfil: PERFIL_VALIDO })
      await cargarPerfilDeObjeto(db, ref.organizationId, {
        slug: 'parcelas',
        perfil: { ...PERFIL_VALIDO, ofertas: [] },
      })

      const r = await perfilConHistorial(db, ref.organizationId, 'parcelas')

      expect(r).not.toBeNull()
      expect(r!.version).toBe(2)
      expect(r!.versiones.map((v) => v.version)).toEqual([2, 1])
    })
  })

  it('perfilConHistorial devuelve null cuando la marca todavía no tiene perfil', async () => {
    await conBaseDeDatosDePrueba(async (db) => {
      const [org] = await db
        .insert(esquema.organizations)
        .values({ name: 'Principal', slug: 'principal' })
        .returning({ id: esquema.organizations.id })
      await db
        .insert(esquema.brands)
        .values({ organizationId: org!.id, slug: 'nueva', name: 'Nueva' })

      expect(await perfilConHistorial(db, org!.id, 'nueva')).toBeNull()
    })
  })
})

/**
 * La plantilla la ve una persona que abre el perfil de una marca recién
 * creada. Si no valida, su primer "Guardar" le devuelve una lista de reglas
 * rotas que ella no escribió. Se guarda de verdad y no solo se valida: entre
 * `validarPerfil` y la columna hay una escritura que también puede fallar.
 */
describe('PLANTILLA_DE_PERFIL', () => {
  it('se puede guardar tal cual y queda como la versión 1', async () => {
    await conBaseDeDatosDePrueba(async (db) => {
      const ref = await sembrar(db)

      const version = await cargarPerfilDeObjeto(db, ref.organizationId, {
        slug: 'parcelas',
        perfil: PLANTILLA_DE_PERFIL,
      })

      expect(version).toBe(1)
      const guardado = await perfilConHistorial(db, ref.organizationId, 'parcelas')
      expect(guardado!.perfil).toEqual(PLANTILLA_DE_PERFIL)
    })
  })
})

describe('estrategiaDelTrimestre', () => {
  it('la estrategia del trimestre corresponde al mes', async () => {
    await conBaseDeDatosDePrueba(async (db) => {
      const ref = await sembrarConEstrategia(db) // crea 2026-Q3

      const deSeptiembre = await estrategiaDelTrimestre(db, ref.organizationId, 'parcelas', '2026-09')
      expect(deSeptiembre.tipo).toBe('ok')
      expect(deSeptiembre.periodo).toBe('2026-Q3')

      // Antes esto devolvía `null`; ahora "no hay" es un caso de la unión que
      // además nombra el trimestre que se buscó.
      expect(await estrategiaDelTrimestre(db, ref.organizationId, 'parcelas', '2026-12'))
        .toEqual({ tipo: 'ausente', periodo: '2026-Q4' })
    })
  })

  it('estrategiaDelTrimestre marca como inválida una estrategia corrupta, en vez de devolverla cruda', async () => {
    await conBaseDeDatosDePrueba(async (db) => {
      const ref = await sembrarConGrilla(db)
      await db
        .update(esquema.strategies)
        .set({ data: { objetivos: 'esto no es un arreglo' } })
        .where(eq(esquema.strategies.brandId, ref.brandId))

      const r = await estrategiaDelTrimestre(db, ref.organizationId, 'parcelas', '2026-09')

      expect(r.tipo).toBe('invalida')
      if (r.tipo !== 'invalida') throw new Error('inalcanzable')
      expect(r.periodo).toBe('2026-Q3')
    })
  })

  it('estrategiaDelTrimestre sí devuelve una archivada, con su estado', async () => {
    await conBaseDeDatosDePrueba(async (db) => {
      const ref = await sembrarConGrilla(db)
      await db
        .update(esquema.strategies)
        .set({ status: 'archivada' })
        .where(eq(esquema.strategies.brandId, ref.brandId))

      const r = await estrategiaDelTrimestre(db, ref.organizationId, 'parcelas', '2026-09')

      expect(r.tipo).toBe('ok')
      if (r.tipo !== 'ok') throw new Error('inalcanzable')
      expect(r.estado).toBe('archivada')
    })
  })
})
