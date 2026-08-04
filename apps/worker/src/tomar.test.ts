import { ClienteFalso } from '@gc/ai'
import { esquema } from '@gc/db'
import { conBaseDeDatosDePrueba } from '@gc/db/pruebas'
import { encolarEstrategia, encolarGrilla, reanudarCorridaEncolada } from '@gc/operaciones'
import { sembrarConEstrategia } from '@gc/operaciones/pruebas'
import { and, eq, sql } from 'drizzle-orm'
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

/**
 * El trimestre que la siembra **no** trae. `sembrarConEstrategia` deja
 * `2026-Q3` cargada, y P1 rechaza regenerar una estrategia que no esté en
 * borrador: pedir Q3 fallaría antes de llamar al modelo.
 */
const PERIODO = '2026-Q4'

const GRILLA = JSON.stringify({
  slots: [
    {
      fecha: '2026-09-02', hora: '13:00', canal: 'blog', formato: 'articulo',
      pilar: 'educacion', angulo: 'guía práctica',
      brief: 'Explicar paso a paso cómo verificar la factibilidad antes de comprar.',
    },
  ],
})

const ESTRATEGIA = JSON.stringify({
  objetivos: [{ nombre: 'Alcance', metrica: 'alcance', meta: '+10%' }],
  mensajesClave: ['mensaje uno bien largo', 'mensaje dos bien largo'],
  mixDeCanales: [{ canal: 'blog', publicacionesPorSemana: 1 }],
  reciclaje: [],
  temasPrioritarios: ['factibilidad de agua'],
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

  // Generar la estrategia desde el navegador es la mitad de lo que esta rama
  // entrega y hasta aquí no la ejercitaba nada: todas las pruebas de arriba
  // encolan `p2_grilla`. El `input` viaja como jsonb, así que `tsc` tampoco ve
  // el contrato: cambiar la clave `period` por `periodo` en `encolarEstrategia`
  // —y en la consulta de `corridaDe`, para que la pantalla siguiera
  // encontrando la corrida— dejaba las 384 pruebas en verde con la generación
  // de estrategia rota de punta a punta.
  it('ejecuta una estrategia encolada y la deja persistida', async () => {
    await conBaseDeDatosDePrueba(async (db) => {
      const ref = await sembrarConEstrategia(db)
      const runId = await encolarEstrategia(db, ref.organizationId, {
        slug: 'parcelas', periodo: PERIODO,
      })

      const r = await tomarYEjecutarUna(db, {
        cliente: new ClienteFalso([ESTRATEGIA]), env: ENV,
      })

      expect(r).toBe('completada')
      const [corrida] = await db
        .select()
        .from(esquema.pipelineRuns)
        .where(eq(esquema.pipelineRuns.id, runId))
      expect(corrida!.status).toBe('completado')

      // Que la corrida termine no basta: lo que la web va a mostrar es la fila
      // de `strategies`, y tiene que ser la del periodo que se pidió.
      const [estrategia] = await db
        .select()
        .from(esquema.strategies)
        .where(
          and(
            eq(esquema.strategies.brandId, ref.brandId),
            eq(esquema.strategies.period, PERIODO),
          ),
        )
      expect(estrategia!.status).toBe('borrador')
      expect(estrategia!.data).toMatchObject({ temasPrioritarios: ['factibilidad de agua'] })
    })
  })

  /**
   * La promesa que `EstadoDeCorrida` le hace al usuario por escrito —«los pasos
   * que ya se completaron no se vuelven a ejecutar, así que el modelo no se
   * cobra de nuevo»— medida donde el spec pidió medirla: en `ai_calls`, y no en
   * el resultado ni en un contador en memoria sobre un paso de mentira. El
   * resultado sale igual de las dos formas, así que ahí no distingue nada.
   *
   * La corrida cae **después** de la llamada al modelo: el primer paso propone
   * la grilla y se completa, el segundo revienta al insertar los slots. El
   * disparador que lo provoca es la forma que este repositorio ya usa para
   * simular un fallo de Postgres en una sentencia concreta (ver la prueba de
   * concurrencia de `corridas.test.ts`), y su SQLSTATE —P0001— es permanente,
   * así que el motor no lo reintenta y el turno termina con un solo intento.
   */
  it('reanudar no vuelve a llamar al modelo: ai_calls queda con una sola fila', async () => {
    await conBaseDeDatosDePrueba(async (db) => {
      const ref = await sembrarConEstrategia(db)
      const runId = await encolarGrilla(db, ref.organizationId, { slug: 'parcelas', mes: MES })

      // Dos respuestas cargadas a propósito. Con la idempotencia sana solo se
      // consume una; si el motor reejecutara el paso completado, la segunda
      // deja que la corrida termine bien igual, y entonces la prueba falla por
      // lo que mide —dos filas en `ai_calls`— y no porque el cliente falso se
      // quedara vacío, que es otro defecto y otro mensaje.
      const cliente = new ClienteFalso([GRILLA, GRILLA])

      await db.execute(sql`
        create or replace function gc_romper_persistencia() returns trigger
        language plpgsql as $$ begin raise exception 'la base se cayó al guardar la grilla'; end; $$
      `)
      await db.execute(sql`
        create trigger gc_romper_persistencia before insert on plan_slots
        for each row execute function gc_romper_persistencia()
      `)
      try {
        expect(await tomarYEjecutarUna(db, { cliente, env: ENV })).toBe('fallida')
      } finally {
        await db.execute(sql`drop trigger if exists gc_romper_persistencia on plan_slots`)
        await db.execute(sql`drop function if exists gc_romper_persistencia()`)
      }

      // El estado de partida de la reanudación, afirmado y no supuesto: el
      // paso del modelo completado y el de persistencia fallido. Sin esto, una
      // corrida que muriera **antes** de llamar al modelo llegaría al final con
      // una sola fila en `ai_calls` y pasaría sin haber probado nada.
      const pasos = await db
        .select()
        .from(esquema.pipelineSteps)
        .where(eq(esquema.pipelineSteps.runId, runId))
      expect(Object.fromEntries(pasos.map((p) => [p.name, p.status]))).toEqual({
        proponer_grilla: 'completado',
        persistir_grilla: 'fallido',
      })
      expect(await db.select().from(esquema.aiCalls)).toHaveLength(1)

      await reanudarCorridaEncolada(db, ref.organizationId, runId)
      expect(await tomarYEjecutarUna(db, { cliente, env: ENV })).toBe('completada')

      // La grilla quedó guardada —o sea que el segundo paso sí se ejecutó de
      // verdad— y el modelo se cobró una sola vez en toda la historia.
      expect((await db.select().from(esquema.planSlots)).length).toBeGreaterThan(0)
      expect(await db.select().from(esquema.aiCalls)).toHaveLength(1)
    })
  })
})
