import { esquema } from '@gc/db'
import { conBaseDeDatosDePrueba } from '@gc/db/pruebas'
import { eq, sql } from 'drizzle-orm'
import { describe, expect, it } from 'vitest'
import {
  corridaDe, encolarEstrategia, encolarGrilla, tomarCorridaPendiente,
} from './corridas.js'
import { sembrarConEstrategia } from './pruebas/siembra.js'

describe('encolarGrilla', () => {
  it('deja la corrida en pendiente, con la entrada que el flujo espera', async () => {
    await conBaseDeDatosDePrueba(async (db) => {
      const ref = await sembrarConEstrategia(db)
      const runId = await encolarGrilla(db, ref.organizationId, { slug: 'parcelas', mes: '2026-10' })

      const [fila] = await db
        .select()
        .from(esquema.pipelineRuns)
        .where(eq(esquema.pipelineRuns.id, runId))

      expect(fila!.status).toBe('pendiente')
      expect(fila!.flow).toBe('p2_grilla')
      expect(fila!.brandId).toBe(ref.brandId)
      expect(fila!.input).toEqual({ brandId: ref.brandId, mes: '2026-10' })
    })
  })

  it('rechaza un mes mal escrito antes de encolar nada', async () => {
    await conBaseDeDatosDePrueba(async (db) => {
      const ref = await sembrarConEstrategia(db)

      await expect(
        encolarGrilla(db, ref.organizationId, { slug: 'parcelas', mes: '2026-13' }),
      ).rejects.toThrow()

      const filas = await db.select().from(esquema.pipelineRuns)
      expect(filas).toHaveLength(0)
    })
  })
})

describe('tomarCorridaPendiente', () => {
  it('devuelve la corrida y la deja en_curso', async () => {
    await conBaseDeDatosDePrueba(async (db) => {
      const ref = await sembrarConEstrategia(db)
      const runId = await encolarGrilla(db, ref.organizationId, { slug: 'parcelas', mes: '2026-10' })

      const tomada = await tomarCorridaPendiente(db)

      expect(tomada?.id).toBe(runId)
      const [fila] = await db
        .select()
        .from(esquema.pipelineRuns)
        .where(eq(esquema.pipelineRuns.id, runId))
      expect(fila!.status).toBe('en_curso')
    })
  })

  it('sin corridas pendientes devuelve null', async () => {
    await conBaseDeDatosDePrueba(async (db) => {
      expect(await tomarCorridaPendiente(db)).toBeNull()
    })
  })

  it('dos consumidores concurrentes no toman la misma corrida', async () => {
    await conBaseDeDatosDePrueba(async (db) => {
      const ref = await sembrarConEstrategia(db)
      await encolarGrilla(db, ref.organizationId, { slug: 'parcelas', mes: '2026-10' })

      // El pool sí ejecuta las dos llamadas en conexiones distintas —está
      // medido: dos `pg_sleep(0.5)` en `Promise.all` tardan 524 ms y devuelven
      // dos `pg_backend_pid()` distintos—, pero el UPDATE dura microsegundos,
      // así que el primero termina antes de que el segundo llegue al servidor
      // y las dos sentencias nunca se solapan. Sin esta ventana la prueba
      // pasaba igual con `FOR UPDATE SKIP LOCKED`, con `FOR UPDATE` a secas y
      // sin cláusula de bloqueo ninguna: no podía fallar.
      //
      // El disparador estira el UPDATE del primero a 300 ms, que es tiempo de
      // sobra para que el segundo entre mientras la fila está bloqueada y sin
      // confirmar. Con `FOR UPDATE` a secas —sin `SKIP LOCKED`— los dos leen
      // el mismo id, el segundo espera al primero y al despertar revalida solo
      // su propio `WHERE id = <ese id>`, que sigue siendo cierto: actualiza la
      // fila otra vez y se lleva la misma corrida.
      await db.execute(sql`
        create or replace function gc_demorar_toma() returns trigger
        language plpgsql as $$ begin perform pg_sleep(0.3); return new; end; $$
      `)
      await db.execute(sql`
        create trigger gc_demorar_toma before update on pipeline_runs
        for each row execute function gc_demorar_toma()
      `)

      let a: Awaited<ReturnType<typeof tomarCorridaPendiente>>
      let b: typeof a
      try {
        ;[a, b] = await Promise.all([tomarCorridaPendiente(db), tomarCorridaPendiente(db)])
      } finally {
        await db.execute(sql`drop trigger if exists gc_demorar_toma on pipeline_runs`)
        await db.execute(sql`drop function if exists gc_demorar_toma()`)
      }

      const tomadas = [a, b].filter((x) => x !== null)
      expect(tomadas).toHaveLength(1)
    })
  }, 30_000)

  it('no se queda esperando la corrida que otro consumidor tiene bloqueada', async () => {
    await conBaseDeDatosDePrueba(async (db) => {
      const ref = await sembrarConEstrategia(db)
      await encolarGrilla(db, ref.organizationId, { slug: 'parcelas', mes: '2026-10' })

      // Lo que aporta `SKIP LOCKED` no es la exclusión —eso lo da `FOR UPDATE`—
      // sino no bloquearse: un worker que se encuentra la fila tomada por otro
      // sigue de largo en vez de quedar colgado hasta que el otro confirme.
      // Aquí la transacción abierta hace de ese otro consumidor.
      const ESPERANDO = 'se quedó esperando la fila bloqueada'
      let resultado: unknown

      await db.transaction(async (tx) => {
        await tx.execute(sql`
          select id from pipeline_runs
          where status = 'pendiente'
          order by ${esquema.pipelineRuns.startedAt}
          limit 1
          for update
        `)

        resultado = await Promise.race([
          tomarCorridaPendiente(db),
          new Promise((r) => setTimeout(() => r(ESPERANDO), 2_000)),
        ])
      })

      expect(resultado).toBeNull()
    })
  }, 30_000)

  it('toma la más antigua primero', async () => {
    await conBaseDeDatosDePrueba(async (db) => {
      const ref = await sembrarConEstrategia(db)
      const primera = await encolarGrilla(db, ref.organizationId, { slug: 'parcelas', mes: '2026-10' })
      // `started_at` tiene resolución suficiente, pero dos inserciones seguidas
      // pueden compartir marca: se separa explícitamente para que el ORDER BY
      // tenga algo que ordenar y la prueba no pase por casualidad.
      await new Promise((r) => setTimeout(r, 10))
      await encolarGrilla(db, ref.organizationId, { slug: 'parcelas', mes: '2026-11' })

      expect((await tomarCorridaPendiente(db))?.id).toBe(primera)
    })
  })
})

describe('corridaDe', () => {
  it('devuelve la corrida del periodo pedido, con su antigüedad', async () => {
    await conBaseDeDatosDePrueba(async (db) => {
      const ref = await sembrarConEstrategia(db)
      await encolarGrilla(db, ref.organizationId, { slug: 'parcelas', mes: '2026-10' })

      const c = await corridaDe(db, ref.organizationId, {
        slug: 'parcelas', flujo: 'p2_grilla', periodo: '2026-10',
      })

      expect(c?.estado).toBe('pendiente')
      expect(c?.encoladaHace).toBeGreaterThanOrEqual(0)
      expect(c?.pasoActual).toBeNull()
    })
  })

  it('no devuelve la corrida de otro mes', async () => {
    await conBaseDeDatosDePrueba(async (db) => {
      const ref = await sembrarConEstrategia(db)
      await encolarGrilla(db, ref.organizationId, { slug: 'parcelas', mes: '2026-10' })

      const c = await corridaDe(db, ref.organizationId, {
        slug: 'parcelas', flujo: 'p2_grilla', periodo: '2026-11',
      })

      expect(c).toBeNull()
    })
  })

  // La estrategia guarda su periodo bajo `period` y la grilla bajo `mes`. Sin
  // esta prueba la rama `p1_estrategia` del selector de campo no la ejercita
  // nadie: podría buscar `mes` en una corrida de estrategia y devolver siempre
  // null sin que ninguna prueba se enterara.
  it('encuentra la corrida de estrategia, que guarda el periodo bajo otra clave', async () => {
    await conBaseDeDatosDePrueba(async (db) => {
      const ref = await sembrarConEstrategia(db)
      const runId = await encolarEstrategia(db, ref.organizationId, {
        slug: 'parcelas', periodo: '2026-Q4',
      })

      const c = await corridaDe(db, ref.organizationId, {
        slug: 'parcelas', flujo: 'p1_estrategia', periodo: '2026-Q4',
      })

      expect(c?.id).toBe(runId)
      expect(c?.estado).toBe('pendiente')
    })
  })

  it('informa el paso en curso cuando lo hay', async () => {
    await conBaseDeDatosDePrueba(async (db) => {
      const ref = await sembrarConEstrategia(db)
      const runId = await encolarGrilla(db, ref.organizationId, { slug: 'parcelas', mes: '2026-10' })
      await db.insert(esquema.pipelineSteps).values({
        organizationId: ref.organizationId,
        runId,
        name: 'proponer_grilla',
        status: 'en_curso',
        idempotencyKey: `${runId}:proponer_grilla`,
      })

      const c = await corridaDe(db, ref.organizationId, {
        slug: 'parcelas', flujo: 'p2_grilla', periodo: '2026-10',
      })

      expect(c?.pasoActual).toBe('proponer_grilla')
    })
  })
})
