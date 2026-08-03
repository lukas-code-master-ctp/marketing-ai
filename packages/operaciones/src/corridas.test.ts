import { esquema } from '@gc/db'
import { conBaseDeDatosDePrueba } from '@gc/db/pruebas'
import { eq, sql } from 'drizzle-orm'
import { describe, expect, it } from 'vitest'
import {
  corridaDe, encolarEstrategia, encolarGrilla, tomarCorridaPendiente,
} from './corridas.js'
import { crearMarca } from './marcas.js'
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

describe('encolarEstrategia', () => {
  it('rechaza un periodo mal escrito antes de encolar nada', async () => {
    await conBaseDeDatosDePrueba(async (db) => {
      const ref = await sembrarConEstrategia(db)

      await expect(
        encolarEstrategia(db, ref.organizationId, { slug: 'parcelas', periodo: '2026-Q9' }),
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
      // El slug viaja con la corrida porque quien la ejecuta se lo pasa al
      // motor como `brandSlug`: sin él los errores nombran el UUID de la marca.
      expect(tomada?.brandSlug).toBe('parcelas')
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

        // El temporizador es solo la red de seguridad para el camino en rojo
        // —si `tomarCorridaPendiente` se quedara esperando, el timeout es lo
        // que da un resultado en vez de colgar la prueba—. En el camino verde
        // se cancela: si no, sigue vivo dos segundos después de que la
        // prueba ya terminó.
        let temporizador: ReturnType<typeof setTimeout>
        const espera = new Promise((r) => {
          temporizador = setTimeout(() => r(ESPERANDO), 2_000)
        })
        resultado = await Promise.race([tomarCorridaPendiente(db), espera])
        clearTimeout(temporizador!)
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

  // La tenencia real la garantiza `resolverMarca` —dos organizaciones no
  // pueden compartir un `brandId`—, pero los dos `eq` de organización en el
  // `where` de `corridaDe` son profundidad sin prueba propia. Dos
  // organizaciones con una marca del mismo slug es el escenario donde, si se
  // quitara cualquiera de los dos filtros, la consulta seguiría siendo válida
  // pero podría cruzar corridas entre organizaciones.
  // `brandId` y `runId` son UUID generados por Postgres, así que en los
  // hechos ya son globalmente únicos: dado que el filtro por marca ya
  // desambigua, quitar solo el filtro por organización no alcanza a romper
  // un escenario con una marca por organización (el revisor ya lo comprobó:
  // la tenencia no está en riesgo hoy porque el guardián real es
  // `resolverMarca`). Por eso la organización `alfa` lleva una *segunda*
  // marca con una corrida del mismo mes: ahí el filtro por organización sola
  // no alcanza a elegir la marca correcta, y es lo que le da dientes a esta
  // prueba en vez de una que nunca podría fallar.
  it('no cruza corridas entre marcas ni entre organizaciones', async () => {
    await conBaseDeDatosDePrueba(async (db) => {
      const orgs = await db
        .insert(esquema.organizations)
        .values([{ name: 'A', slug: 'alfa' }, { name: 'B', slug: 'beta' }])
        .returning()
      const alfa = orgs.find((o) => o.slug === 'alfa')!
      const beta = orgs.find((o) => o.slug === 'beta')!

      await crearMarca(db, alfa.id, { slug: 'parcelas', nombre: 'En alfa' })
      await crearMarca(db, alfa.id, { slug: 'otra-marca', nombre: 'Otra en alfa' })
      await crearMarca(db, beta.id, { slug: 'parcelas', nombre: 'En beta' })

      const runAlfaParcelas = await encolarGrilla(db, alfa.id, { slug: 'parcelas', mes: '2026-10' })
      await encolarGrilla(db, alfa.id, { slug: 'otra-marca', mes: '2026-10' })
      const runBeta = await encolarGrilla(db, beta.id, { slug: 'parcelas', mes: '2026-10' })

      const cAlfa = await corridaDe(db, alfa.id, {
        slug: 'parcelas', flujo: 'p2_grilla', periodo: '2026-10',
      })
      const cBeta = await corridaDe(db, beta.id, {
        slug: 'parcelas', flujo: 'p2_grilla', periodo: '2026-10',
      })

      expect(cAlfa?.id).toBe(runAlfaParcelas)
      expect(cBeta?.id).toBe(runBeta)
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

  // Con un solo paso insertado, cambiar el `desc` del `ORDER BY` por `asc`
  // deja esta prueba en verde igual: no hay nada que ordenar. Separar dos
  // pasos en el tiempo es lo que le da al orden algo que afirmar, y por eso
  // el paso más reciente es el segundo, no el primero.
  it('informa el paso más reciente cuando hay más de uno', async () => {
    await conBaseDeDatosDePrueba(async (db) => {
      const ref = await sembrarConEstrategia(db)
      const runId = await encolarGrilla(db, ref.organizationId, { slug: 'parcelas', mes: '2026-10' })
      await db.insert(esquema.pipelineSteps).values({
        organizationId: ref.organizationId,
        runId,
        name: 'proponer_grilla',
        status: 'completado',
        idempotencyKey: `${runId}:proponer_grilla`,
      })
      await new Promise((r) => setTimeout(r, 10))
      await db.insert(esquema.pipelineSteps).values({
        organizationId: ref.organizationId,
        runId,
        name: 'persistir_grilla',
        status: 'en_curso',
        idempotencyKey: `${runId}:persistir_grilla`,
      })

      const c = await corridaDe(db, ref.organizationId, {
        slug: 'parcelas', flujo: 'p2_grilla', periodo: '2026-10',
      })

      expect(c?.pasoActual).toBe('persistir_grilla')
    })
  })
})
