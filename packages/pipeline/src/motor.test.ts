import { esquema } from '@gc/db'
import { conBaseDeDatosDePrueba } from '@gc/db/pruebas'
import { permanente, transitorio } from '@gc/shared'
import { eq } from 'drizzle-orm'
import { describe, expect, it } from 'vitest'
import { definirPaso, ejecutarFlujo } from './motor.js'

const SIN_ESPERA = { dormir: async () => {}, aleatorio: () => 0 }

async function sembrarOrg(db: Parameters<Parameters<typeof conBaseDeDatosDePrueba>[0]>[0]) {
  const [org] = await db.insert(esquema.organizations).values({ name: 'X' }).returning()
  return org!.id
}

describe('ejecutarFlujo', () => {
  it('encadena la salida de cada paso al siguiente', async () => {
    await conBaseDeDatosDePrueba(async (db) => {
      const organizationId = await sembrarOrg(db)
      const flujo = {
        nombre: 'prueba',
        pasos: [
          definirPaso<{ n: number }, { n: number }>({
            nombre: 'doblar',
            ejecutar: async (e) => ({ n: e.n * 2 }),
          }),
          definirPaso<{ n: number }, { n: number }>({
            nombre: 'sumar_uno',
            ejecutar: async (e) => ({ n: e.n + 1 }),
          }),
        ],
      }

      const r = await ejecutarFlujo(db, flujo, { n: 5 }, { organizationId }, SIN_ESPERA)

      expect(r.estado).toBe('completado')
      expect(r.salida).toEqual({ n: 11 })

      const pasos = await db.select().from(esquema.pipelineSteps)
      expect(pasos.map((p) => p.name)).toEqual(['doblar', 'sumar_uno'])
      expect(pasos.every((p) => p.status === 'completado')).toBe(true)
    })
  })

  it('reintenta los errores transitorios y registra el intento', async () => {
    await conBaseDeDatosDePrueba(async (db) => {
      const organizationId = await sembrarOrg(db)
      let llamadas = 0
      const flujo = {
        nombre: 'prueba',
        pasos: [
          definirPaso<{ n: number }, { n: number }>({
            nombre: 'inestable',
            ejecutar: async (e) => {
              llamadas++
              if (llamadas < 3) throw transitorio('la red falló')
              return { n: e.n }
            },
          }),
        ],
      }

      const r = await ejecutarFlujo(db, flujo, { n: 1 }, { organizationId }, SIN_ESPERA)

      expect(r.estado).toBe('completado')
      expect(llamadas).toBe(3)
      const [paso] = await db.select().from(esquema.pipelineSteps)
      expect(paso!.attempt).toBe(3)
    })
  })

  it('no reintenta los errores permanentes y marca la corrida como fallida', async () => {
    await conBaseDeDatosDePrueba(async (db) => {
      const organizationId = await sembrarOrg(db)
      let llamadas = 0
      const flujo = {
        nombre: 'prueba',
        pasos: [
          definirPaso<unknown, unknown>({
            nombre: 'invalido',
            ejecutar: async () => {
              llamadas++
              throw permanente('esquema inválido')
            },
          }),
        ],
      }

      await expect(
        ejecutarFlujo(db, flujo, {}, { organizationId }, SIN_ESPERA),
      ).rejects.toMatchObject({ clase: 'permanente' })

      expect(llamadas).toBe(1)
      const [corrida] = await db.select().from(esquema.pipelineRuns)
      expect(corrida!.status).toBe('fallido')
      expect(corrida!.error).toContain('esquema inválido')
    })
  })

  it('se rinde tras agotar los intentos de un error transitorio', async () => {
    await conBaseDeDatosDePrueba(async (db) => {
      const organizationId = await sembrarOrg(db)
      let llamadas = 0
      const flujo = {
        nombre: 'prueba',
        pasos: [
          definirPaso<unknown, unknown>({
            nombre: 'siempre_falla',
            ejecutar: async () => {
              llamadas++
              throw transitorio('502')
            },
          }),
        ],
      }

      await expect(
        ejecutarFlujo(db, flujo, {}, { organizationId }, { ...SIN_ESPERA, maxIntentos: 3 }),
      ).rejects.toMatchObject({ clase: 'transitorio' })

      expect(llamadas).toBe(3)
    })
  })

  it('es idempotente: reanudar una corrida no reejecuta los pasos completados', async () => {
    await conBaseDeDatosDePrueba(async (db) => {
      const organizationId = await sembrarOrg(db)
      let ejecucionesDelPrimero = 0
      let debeFallarElSegundo = true

      const flujo = {
        nombre: 'prueba',
        pasos: [
          definirPaso<{ n: number }, { n: number }>({
            nombre: 'caro',
            ejecutar: async (e) => {
              ejecucionesDelPrimero++
              return { n: e.n * 10 }
            },
          }),
          definirPaso<{ n: number }, { n: number }>({
            nombre: 'fragil',
            ejecutar: async (e) => {
              if (debeFallarElSegundo) throw permanente('todavía no')
              return { n: e.n + 1 }
            },
          }),
        ],
      }

      const primera = await ejecutarFlujo(
        db, flujo, { n: 2 }, { organizationId }, SIN_ESPERA,
      ).catch((e: unknown) => e)
      expect(primera).toBeInstanceOf(Error)
      expect(ejecucionesDelPrimero).toBe(1)

      const [corrida] = await db.select().from(esquema.pipelineRuns)
      debeFallarElSegundo = false

      const segunda = await ejecutarFlujo(
        db, flujo, { n: 2 }, { organizationId, runId: corrida!.id }, SIN_ESPERA,
      )

      expect(segunda.estado).toBe('completado')
      expect(segunda.salida).toEqual({ n: 21 })
      expect(ejecucionesDelPrimero).toBe(1)

      const corridas = await db
        .select()
        .from(esquema.pipelineRuns)
        .where(eq(esquema.pipelineRuns.id, corrida!.id))
      expect(corridas[0]!.status).toBe('completado')
    })
  })

  it('no reejecuta un paso completado cuya salida fue null', async () => {
    await conBaseDeDatosDePrueba(async (db) => {
      const organizationId = await sembrarOrg(db)
      let efectos = 0
      let debeFallarElSegundo = true

      const flujo = {
        nombre: 'prueba',
        pasos: [
          definirPaso<unknown, null>({
            nombre: 'efecto_sin_retorno',
            ejecutar: async () => {
              efectos++
              return null
            },
          }),
          definirPaso<null, { ok: boolean }>({
            nombre: 'fragil',
            ejecutar: async () => {
              if (debeFallarElSegundo) throw permanente('todavía no')
              return { ok: true }
            },
          }),
        ],
      }

      await expect(
        ejecutarFlujo(db, flujo, {}, { organizationId }, SIN_ESPERA),
      ).rejects.toThrow()
      expect(efectos).toBe(1)

      const [corrida] = await db.select().from(esquema.pipelineRuns)
      debeFallarElSegundo = false
      await ejecutarFlujo(db, flujo, {}, { organizationId, runId: corrida!.id }, SIN_ESPERA)

      // Un paso que devuelve null sigue estando completado: no se repite.
      expect(efectos).toBe(1)

      const [fragil] = await db
        .select()
        .from(esquema.pipelineSteps)
        .where(eq(esquema.pipelineSteps.name, 'fragil'))
      expect(fragil!.status).toBe('completado')
      expect(fragil!.error).toBeNull()
      expect(fragil!.finishedAt).not.toBeNull()
    })
  })

  it('espera con backoff exponencial entre reintentos', async () => {
    await conBaseDeDatosDePrueba(async (db) => {
      const organizationId = await sembrarOrg(db)
      const esperas: number[] = []
      let llamadas = 0

      const flujo = {
        nombre: 'prueba',
        pasos: [
          definirPaso<unknown, unknown>({
            nombre: 'inestable',
            ejecutar: async () => {
              llamadas++
              if (llamadas < 3) throw transitorio('502')
              return {}
            },
          }),
        ],
      }

      await ejecutarFlujo(db, flujo, {}, { organizationId }, {
        dormir: async (ms) => void esperas.push(ms),
        aleatorio: () => 0,
      })

      expect(esperas).toEqual([1000, 2000])
    })
  })

  it('rechaza reanudar una corrida de otra organización', async () => {
    await conBaseDeDatosDePrueba(async (db) => {
      const organizationId = await sembrarOrg(db)
      const [otra] = await db
        .insert(esquema.organizations)
        .values({ name: 'Otra' })
        .returning()

      const flujo = {
        nombre: 'prueba',
        pasos: [
          definirPaso<unknown, unknown>({ nombre: 'trivial', ejecutar: async () => ({}) }),
        ],
      }
      const r = await ejecutarFlujo(db, flujo, {}, { organizationId }, SIN_ESPERA)

      await expect(
        ejecutarFlujo(db, flujo, {}, { organizationId: otra!.id, runId: r.runId }, SIN_ESPERA),
      ).rejects.toMatchObject({ clase: 'permanente' })
    })
  })
})
