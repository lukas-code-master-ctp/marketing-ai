import { esquema } from '@gc/db'
import { conBaseDeDatosDePrueba } from '@gc/db/pruebas'
import { describe, expect, it } from 'vitest'
import {
  catalogoDeModelos, eleccionesDeModelo, guardarEleccionDeModelo, modelosDelNivel,
} from './modelos.js'

async function crearOrganizacion(
  db: Parameters<Parameters<typeof conBaseDeDatosDePrueba>[0]>[0],
  organizacion: { slug: string; nombre: string } = { slug: 'x', nombre: 'X' },
) {
  const [org] = await db.insert(esquema.organizations)
    .values({ name: organizacion.nombre, slug: organizacion.slug }).returning()
  return org!.id
}

/**
 * Ocho candidatos, con precios distintos por nivel, así como los sembraría
 * la migración de la Task 1 — pero el arnés de pruebas vacía `model_catalog`
 * entre pruebas (es una tabla global, sin `organization_id`, así que el
 * borrado en cascada por organización no la alcanza), así que cada prueba
 * necesita su propia siembra.
 */
async function sembrarCatalogo(
  db: Parameters<Parameters<typeof conBaseDeDatosDePrueba>[0]>[0],
) {
  const filas = await db.insert(esquema.modelCatalog).values([
    {
      level: 'razonamiento', modelId: 'proveedor/razonamiento-caro',
      label: 'Razonamiento caro', description: 'El más capaz.',
      priceInputUsd: '5.0000', priceOutputUsd: '15.0000',
    },
    {
      level: 'razonamiento', modelId: 'proveedor/razonamiento-barato',
      label: 'Razonamiento barato', description: 'Más barato, algo menos capaz.',
      priceInputUsd: '1.0000', priceOutputUsd: '3.0000',
    },
    {
      level: 'redaccion', modelId: 'proveedor/redaccion-caro',
      label: 'Redacción cara', description: 'La mejor pluma.',
      priceInputUsd: '3.0000', priceOutputUsd: '9.0000',
    },
    {
      level: 'redaccion', modelId: 'proveedor/redaccion-barato',
      label: 'Redacción barata', description: 'Pluma correcta y barata.',
      priceInputUsd: '0.5000', priceOutputUsd: '1.5000',
    },
    {
      level: 'utilitario', modelId: 'proveedor/utilitario-caro',
      label: 'Utilitario caro', description: 'Rápido y algo caro.',
      priceInputUsd: '0.3000', priceOutputUsd: '0.9000',
    },
    {
      level: 'utilitario', modelId: 'proveedor/utilitario-barato',
      label: 'Utilitario barato', description: 'El más barato de todos.',
      priceInputUsd: '0.1000', priceOutputUsd: '0.2000',
    },
  ]).returning()
  return filas
}

describe('modelosDelNivel', () => {
  it('devuelve el model_id del principal y del respaldo elegidos', async () => {
    await conBaseDeDatosDePrueba(async (db) => {
      const organizationId = await crearOrganizacion(db)
      const catalogo = await sembrarCatalogo(db)
      const principal = catalogo.find((m) => m.modelId === 'proveedor/razonamiento-caro')!
      const respaldo = catalogo.find((m) => m.modelId === 'proveedor/razonamiento-barato')!
      await db.insert(esquema.organizationModels).values({
        organizationId, level: 'razonamiento',
        principalId: principal.id, respaldoId: respaldo.id,
      })

      const r = await modelosDelNivel(db, organizationId, 'razonamiento')
      expect(r).toEqual({
        principal: 'proveedor/razonamiento-caro',
        respaldo: 'proveedor/razonamiento-barato',
      })
    })
  })

  it('sin respaldo elegido devuelve el principal en los dos', async () => {
    await conBaseDeDatosDePrueba(async (db) => {
      const organizationId = await crearOrganizacion(db)
      const catalogo = await sembrarCatalogo(db)
      const principal = catalogo.find((m) => m.modelId === 'proveedor/redaccion-caro')!
      await db.insert(esquema.organizationModels).values({
        organizationId, level: 'redaccion',
        principalId: principal.id, respaldoId: null,
      })

      const r = await modelosDelNivel(db, organizationId, 'redaccion')
      expect(r.respaldo).toBe(r.principal)
      expect(r.principal).toBe('proveedor/redaccion-caro')
    })
  })

  it('sin elección para ese nivel lanza un permanente que nombra la pantalla', async () => {
    await conBaseDeDatosDePrueba(async (db) => {
      const organizationId = await crearOrganizacion(db)
      await sembrarCatalogo(db)

      const error = await modelosDelNivel(db, organizationId, 'utilitario').catch((e: unknown) => e)
      expect(error).toMatchObject({ clase: 'permanente' })
      expect((error as Error).message).toMatch(/\/configuracion/)
    })
  })

  it('no ve la elección de otra organización', async () => {
    // A elige razonamiento; B elige utilitario (un nivel distinto, y con
    // datos propios, para que B no sea "sin datos" — ver la nota del brief
    // sobre el patrón que no puede fallar). B nunca eligió razonamiento, así
    // que pedirle ese nivel tiene que lanzar. Si el filtro por
    // organizationId faltara, la consulta encontraría la fila de A por
    // nivel solamente y no lanzaría — una distinción de "lanza o no", no de
    // "qué fila ganó", que no depende del orden en que Postgres devuelva
    // las filas.
    await conBaseDeDatosDePrueba(async (db) => {
      const catalogo = await sembrarCatalogo(db)
      const principalDeA = catalogo.find((m) => m.modelId === 'proveedor/razonamiento-caro')!
      const principalDeB = catalogo.find((m) => m.modelId === 'proveedor/utilitario-caro')!

      const organizationIdA = await crearOrganizacion(db, { slug: 'a', nombre: 'A' })
      await db.insert(esquema.organizationModels).values({
        organizationId: organizationIdA, level: 'razonamiento',
        principalId: principalDeA.id, respaldoId: null,
      })

      const organizationIdB = await crearOrganizacion(db, { slug: 'b', nombre: 'B' })
      await db.insert(esquema.organizationModels).values({
        organizationId: organizationIdB, level: 'utilitario',
        principalId: principalDeB.id, respaldoId: null,
      })

      const error = await modelosDelNivel(db, organizationIdB, 'razonamiento').catch((e: unknown) => e)
      expect(error).toMatchObject({ clase: 'permanente' })
      expect((error as Error).message).toMatch(/\/configuracion/)
    })
  })
})

describe('catalogoDeModelos', () => {
  it('agrupa por nivel y ordena por precio de salida', async () => {
    await conBaseDeDatosDePrueba(async (db) => {
      await sembrarCatalogo(db)

      const mapa = await catalogoDeModelos(db)
      expect(mapa.get('razonamiento')?.map((m) => m.modelId)).toEqual([
        'proveedor/razonamiento-barato', 'proveedor/razonamiento-caro',
      ])
      expect(mapa.get('redaccion')?.map((m) => m.modelId)).toEqual([
        'proveedor/redaccion-barato', 'proveedor/redaccion-caro',
      ])
      expect(mapa.get('utilitario')?.map((m) => m.modelId)).toEqual([
        'proveedor/utilitario-barato', 'proveedor/utilitario-caro',
      ])
      const barato = mapa.get('razonamiento')![0]!
      expect(barato.precioEntradaUsd).toBe(1)
      expect(barato.precioSalidaUsd).toBe(3)
    })
  })
})

describe('eleccionesDeModelo', () => {
  it('omite los niveles que la organización no eligió', async () => {
    await conBaseDeDatosDePrueba(async (db) => {
      const organizationId = await crearOrganizacion(db)
      const catalogo = await sembrarCatalogo(db)
      const principal = catalogo.find((m) => m.modelId === 'proveedor/razonamiento-caro')!
      await db.insert(esquema.organizationModels).values({
        organizationId, level: 'razonamiento',
        principalId: principal.id, respaldoId: null,
      })

      const elecciones = await eleccionesDeModelo(db, organizationId)
      expect(elecciones).toHaveLength(1)
      expect(elecciones[0]!.nivel).toBe('razonamiento')
      expect(elecciones[0]!.principal.modelId).toBe('proveedor/razonamiento-caro')
      expect(elecciones[0]!.respaldo).toBeNull()
    })
  })
})

describe('guardarEleccionDeModelo', () => {
  it('guardar dos veces el mismo nivel corrige, no duplica', async () => {
    await conBaseDeDatosDePrueba(async (db) => {
      const organizationId = await crearOrganizacion(db)
      const catalogo = await sembrarCatalogo(db)
      const primero = catalogo.find((m) => m.modelId === 'proveedor/redaccion-caro')!
      const segundo = catalogo.find((m) => m.modelId === 'proveedor/redaccion-barato')!

      await guardarEleccionDeModelo(
        db, organizationId,
        { nivel: 'redaccion', principalId: primero.id, respaldoId: null },
      )
      const primeraFecha = (await db.select().from(esquema.organizationModels))[0]!.updatedAt

      // Aseguramos que el reloj avance para que la comparación de fechas no
      // dependa de que dos llamadas caigan en el mismo milisegundo.
      await new Promise((resolve) => setTimeout(resolve, 5))

      await guardarEleccionDeModelo(
        db, organizationId,
        { nivel: 'redaccion', principalId: segundo.id, respaldoId: null },
      )

      const filas = await db.select().from(esquema.organizationModels)
      expect(filas).toHaveLength(1)
      expect(filas[0]!.principalId).toBe(segundo.id)
      expect(filas[0]!.updatedAt.getTime()).toBeGreaterThan(primeraFecha.getTime())
    })
  })

  it('no deja elegir un modelo de otro nivel', async () => {
    await conBaseDeDatosDePrueba(async (db) => {
      const organizationId = await crearOrganizacion(db)
      const catalogo = await sembrarCatalogo(db)
      const deOtroNivel = catalogo.find((m) => m.modelId === 'proveedor/utilitario-barato')!

      await expect(
        guardarEleccionDeModelo(
          db, organizationId,
          { nivel: 'redaccion', principalId: deOtroNivel.id, respaldoId: null },
        ),
      ).rejects.toMatchObject({ clase: 'permanente' })

      const filas = await db.select().from(esquema.organizationModels)
      expect(filas).toHaveLength(0)
    })
  })
})
