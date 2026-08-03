import { ClienteFalso } from '@gc/ai'
import { esquema } from '@gc/db'
import { conBaseDeDatosDePrueba } from '@gc/db/pruebas'
import { encolarGrilla } from '@gc/operaciones'
import { sembrarConEstrategia } from '@gc/operaciones/pruebas'
import { eq } from 'drizzle-orm'
import { describe, expect, it } from 'vitest'
import { tomarYEjecutarUna } from './tomar.js'

const ENV = { MODELO_RAZONAMIENTO: 'proveedor/fuerte' }

/**
 * El mes es de 2026-Q3 y no de Q4 a propósito: `sembrarConEstrategia` siembra
 * la estrategia de `2026-Q3`, así que pedir la grilla de octubre falla en el
 * primer paso con «no tiene estrategia vigente para 2026-Q4» — nunca llega a
 * ejercitar ni al cliente ni a la persistencia.
 */
const MES = '2026-09'

const GRILLA = JSON.stringify({
  slots: [
    {
      fecha: '2026-09-02', hora: '13:00', canal: 'blog', formato: 'articulo',
      pilar: 'educacion', angulo: 'guía práctica',
      brief: 'Explicar paso a paso cómo verificar la factibilidad antes de comprar.',
    },
  ],
})

describe('tomarYEjecutarUna', () => {
  it('sin corridas pendientes no hace nada', async () => {
    await conBaseDeDatosDePrueba(async (db) => {
      expect(await tomarYEjecutarUna(db, { cliente: new ClienteFalso([]), env: ENV })).toBe('nada')
    })
  })

  it('ejecuta una corrida encolada y la deja completada', async () => {
    await conBaseDeDatosDePrueba(async (db) => {
      const ref = await sembrarConEstrategia(db)
      const runId = await encolarGrilla(db, ref.organizationId, { slug: 'parcelas', mes: MES })

      const r = await tomarYEjecutarUna(db, { cliente: new ClienteFalso([GRILLA]), env: ENV })

      expect(r).toBe('completada')
      const [fila] = await db
        .select()
        .from(esquema.pipelineRuns)
        .where(eq(esquema.pipelineRuns.id, runId))
      expect(fila!.status).toBe('completado')

      const slots = await db.select().from(esquema.planSlots)
      expect(slots.length).toBeGreaterThan(0)
    })
  })

  it('una corrida que falla queda fallida, con el error guardado', async () => {
    await conBaseDeDatosDePrueba(async (db) => {
      const ref = await sembrarConEstrategia(db)
      const runId = await encolarGrilla(db, ref.organizationId, { slug: 'parcelas', mes: MES })

      // Sin respuestas en el cliente, el flujo no puede proponer nada.
      const r = await tomarYEjecutarUna(db, { cliente: new ClienteFalso([]), env: ENV })

      expect(r).toBe('fallida')
      const [fila] = await db
        .select()
        .from(esquema.pipelineRuns)
        .where(eq(esquema.pipelineRuns.id, runId))
      expect(fila!.status).toBe('fallido')
      // No basta con que haya *algo* escrito: lo que la pantalla muestra tiene
      // que llevar la clase del error, que es lo que dice si reintentar sirve.
      expect(fila!.error).toContain('[permanente]')
    })
  })

  it('un flujo desconocido deja la corrida fallida sin reintentar', async () => {
    await conBaseDeDatosDePrueba(async (db) => {
      const ref = await sembrarConEstrategia(db)
      const [fila] = await db
        .insert(esquema.pipelineRuns)
        .values({
          organizationId: ref.organizationId,
          brandId: ref.brandId,
          flow: 'flujo_del_futuro',
          status: 'pendiente',
          input: {},
        })
        .returning({ id: esquema.pipelineRuns.id })

      const r = await tomarYEjecutarUna(db, { cliente: new ClienteFalso([]), env: ENV })

      expect(r).toBe('fallida')
      const [despues] = await db
        .select()
        .from(esquema.pipelineRuns)
        .where(eq(esquema.pipelineRuns.id, fila!.id))
      expect(despues!.status).toBe('fallido')
      expect(despues!.error).toMatch(/flujo_del_futuro/)
      // Este es el único fallo cuyo mensaje escribe el worker de punta a
      // punta: ocurre antes de que `ejecutarFlujo` llegue a correr, así que
      // el motor no lo toca. Si el worker dejara de anteponer la clase, la
      // pantalla mostraría este error sin decir si reintentar sirve.
      expect(despues!.error).toContain('[permanente]')
    })
  })

  // El worker es el único camino de ejecución detrás del navegador, así que si
  // pierde el slug, el cien por ciento de los mensajes de error que ve el
  // usuario nombra la marca por su UUID. El mes es de 2026-Q4, sin estrategia
  // sembrada: el flujo falla en el primer paso con el mensaje que interpola
  // `ctx.brandSlug`, sin llegar al cliente.
  it('el error guardado nombra la marca por su slug y no por su UUID', async () => {
    await conBaseDeDatosDePrueba(async (db) => {
      const ref = await sembrarConEstrategia(db)
      const runId = await encolarGrilla(db, ref.organizationId, {
        slug: 'parcelas', mes: '2026-10',
      })

      expect(await tomarYEjecutarUna(db, { cliente: new ClienteFalso([]), env: ENV })).toBe(
        'fallida',
      )

      const [fila] = await db
        .select()
        .from(esquema.pipelineRuns)
        .where(eq(esquema.pipelineRuns.id, runId))
      expect(fila!.error).toContain('La marca parcelas no tiene estrategia vigente')
      expect(fila!.error).not.toContain(ref.brandId)
    })
  })
})
