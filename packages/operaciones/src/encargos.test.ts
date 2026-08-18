import { esquema } from '@gc/db'
import { conBaseDeDatosDePrueba } from '@gc/db/pruebas'
import { eq } from 'drizzle-orm'
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

  it('una estrategia aprobada de OTRO trimestre no congela este encargo', async () => {
    // Sin el filtro de periodo en la consulta de congelación, la estrategia
    // aprobada de Q3 bloquearía el encargo de Q4 y el mensaje nombraría el
    // trimestre equivocado.
    await conBaseDeDatosDePrueba(async (db) => {
      const ref = await sembrar(db)
      await db.insert(esquema.strategies).values({
        organizationId: ref.organizationId, brandId: ref.brandId, period: '2026-Q3',
        status: 'aprobada', data: {}, brandProfileVersion: 1,
      })

      await expect(
        guardarEncargo(db, ref.organizationId, {
          slug: 'parcelas', periodo: '2026-Q4', encargo: ENCARGO,
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
      // La fila cruda viaja en `datos`: es lo que deja que el formulario se
      // siembre con lo que sí se pudo leer en vez de salir en blanco, que es
      // la única razón por la que este estado existe. Sin esta aserción, la
      // mitad productora del arreglo no la fija nada.
      expect(r).toMatchObject({ datos: { objetivo: 'corto' } })
    })
  })

  it('un objetivo demasiado corto rechaza con un mensaje en español que nombra el campo', async () => {
    // Antes, este mensaje era el volcado JSON de Zod: `leido.error.message`
    // interpolado tal cual. Esta prueba es lo que impide que vuelva a serlo.
    await conBaseDeDatosDePrueba(async (db) => {
      const ref = await sembrar(db)
      let mensaje = ''
      try {
        await guardarEncargo(db, ref.organizationId, {
          slug: 'parcelas', periodo: '2026-Q4', encargo: { ...ENCARGO, objetivo: 'Vender' },
        })
        throw new Error('inalcanzable: se esperaba que guardarEncargo lanzara')
      } catch (error) {
        mensaje = error instanceof Error ? error.message : String(error)
      }

      expect(mensaje).toContain('Objetivo del trimestre')
      expect(mensaje).not.toContain('"code"')
      expect(mensaje).not.toContain('"path"')
      expect(mensaje).not.toContain('String must contain')
      expect(await db.select().from(esquema.strategyBriefs)).toHaveLength(0)
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
      expect(await db.select().from(esquema.strategyBriefs)).toHaveLength(0)
    })
  })

  it('otra organización con una marca del mismo slug ve y guarda solo su propio encargo', async () => {
    // La propiedad que importa: resolverMarca filtra por organizationId, no
    // solo por slug. La versión anterior de esta prueba dejaba a B sin datos
    // propios y comprobaba solo "B ve ausente" — pero leerEncargo filtra por
    // `brandId = ref.brandId AND organizationId = organizationId` (el
    // argumento, no lo que devuelva resolverMarca), así que con B vacía la
    // combinación (brandId de A, organizationId de B) no encuentra fila tanto
    // si resolverMarca filtra bien como si resolviera por slug a secas: cero
    // es cero y no discrimina entre las dos versiones del código. Por eso B
    // necesita su propio encargo: si resolverMarca le devolviera el brandId
    // de A, leerEncargo dejaría de ver también el propio de B (volvería
    // 'ausente' en vez de 'presente'), y guardarEncargo pisaría el de A en
    // vez de escribir uno nuevo para B.
    await conBaseDeDatosDePrueba(async (db) => {
      const refA = await sembrar(db)
      await guardarEncargo(db, refA.organizationId, {
        slug: 'parcelas', periodo: '2026-Q4', encargo: ENCARGO,
      })

      const [orgB] = await db.insert(esquema.organizations)
        .values({ name: 'Y', slug: 'y' }).returning()
      await db.insert(esquema.brands)
        .values({ organizationId: orgB!.id, slug: 'parcelas', name: 'Otra marca' }).returning()

      const encargoB = {
        ...ENCARGO,
        objetivo: 'Vender las parcelas del loteo sur, que es de la otra marca',
      }
      await guardarEncargo(db, orgB!.id, {
        slug: 'parcelas', periodo: '2026-Q4', encargo: encargoB,
      })

      const r = await leerEncargo(db, orgB!.id, { slug: 'parcelas', periodo: '2026-Q4' })
      if (r.tipo !== 'presente') throw new Error('inalcanzable')
      expect(r.encargo.objetivo).toBe(encargoB.objetivo)

      // "No pisa": el encargo de A sigue siendo el suyo, y hay dos filas, una
      // por organización, no una sola que B haya sobrescrito.
      const filas = await db.select().from(esquema.strategyBriefs)
      expect(filas).toHaveLength(2)
      const [filaA] = filas.filter((f) => f.brandId === refA.brandId)
      expect((filaA!.data as typeof ENCARGO).objetivo).toBe(ENCARGO.objetivo)
    })
  })

  it('corregir sin usuarioId no borra el autor ni mueve la fecha de la primera escritura', async () => {
    // Las dos columnas dicen cosas distintas a propósito, y el comentario del
    // `onConflictDoUpdate` lo afirma: `createdAt` es cuándo se escribió el
    // encargo por primera vez y `createdBy` quién lo escribió por última.
    // Esta prueba es lo que impide que ese comentario se vuelva mentira.
    await conBaseDeDatosDePrueba(async (db) => {
      const ref = await sembrar(db)
      const [usuario] = await db.insert(esquema.users)
        .values({ email: 'autor@x.cl' }).returning()
      const args = { slug: 'parcelas', periodo: '2026-Q4' }

      await guardarEncargo(db, ref.organizationId, { ...args, encargo: ENCARGO }, usuario!.id)
      const [primera] = await db.select().from(esquema.strategyBriefs)
        .where(eq(esquema.strategyBriefs.brandId, ref.brandId))

      await guardarEncargo(db, ref.organizationId, {
        ...args, encargo: { ...ENCARGO, objetivo: 'Corrección sin usuario' },
      })

      const [fila] = await db.select().from(esquema.strategyBriefs)
        .where(eq(esquema.strategyBriefs.brandId, ref.brandId))
      expect(fila?.createdBy).toBe(usuario!.id)
      expect(fila?.createdAt).toEqual(primera!.createdAt)
    })
  })
})
