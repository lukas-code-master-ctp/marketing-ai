import { esquema } from '@gc/db'
import { conBaseDeDatosDePrueba } from '@gc/db/pruebas'
import { eq, sql } from 'drizzle-orm'
import { describe, expect, it } from 'vitest'
import {
  corridaDe, encolarEstrategia, encolarGrilla, reanudarCorridaEncolada, tomarCorridaPendiente,
} from './corridas.js'
import { guardarEncargo } from './encargos.js'
import { crearMarca } from './marcas.js'
import { sembrarConEstrategia } from './pruebas/siembra.js'

/**
 * El encargo que `encolarEstrategia` ahora exige antes de encolar. Se sembró
 * en cada prueba que llama a esa función con un periodo válido, para no
 * confundir "no hay encargo" —lo que prueba `describe('encargo requerido')`—
 * con cualquier otro comportamiento que la prueba en realidad mide.
 */
const ENCARGO_VALIDO = {
  objetivo: 'Vender las doce parcelas que quedan del loteo norte',
  comoSeMide: 'Formularios de contacto recibidos',
  publicacionesPorSemana: 4,
  canalesDisponibles: ['instagram', 'blog'] as const,
  queEstaPasando: '', queFunciono: '', queNoFunciono: '', queEvitar: '', algoMas: '',
}

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
  // La gemela de la primera prueba de `encolarGrilla`, y no es simetría
  // decorativa: la clave del periodo dentro de `input` es la que P1 lee, viaja
  // como jsonb —o sea que `tsc` no la ve— y es distinta de la de la grilla.
  it('deja la corrida en pendiente, con la entrada que el flujo espera', async () => {
    await conBaseDeDatosDePrueba(async (db) => {
      const ref = await sembrarConEstrategia(db)
      await guardarEncargo(db, ref.organizationId, {
        slug: 'parcelas', periodo: '2026-Q4', encargo: ENCARGO_VALIDO,
      })
      const runId = await encolarEstrategia(db, ref.organizationId, {
        slug: 'parcelas', periodo: '2026-Q4',
      })

      const [fila] = await db
        .select()
        .from(esquema.pipelineRuns)
        .where(eq(esquema.pipelineRuns.id, runId))

      expect(fila!.status).toBe('pendiente')
      expect(fila!.flow).toBe('p1_estrategia')
      expect(fila!.input).toEqual({ brandId: ref.brandId, period: '2026-Q4' })
    })
  })

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

  // El encargo del trimestre es obligatorio desde este bloque: sin él el
  // modelo se inventa las métricas de los objetivos y el mix de canales. Esta
  // guarda avisa al instante, en la pantalla; la autoritativa vive en P1.
  it('se niega si el trimestre no tiene encargo escrito', async () => {
    await conBaseDeDatosDePrueba(async (db) => {
      const ref = await sembrarConEstrategia(db)
      await expect(
        encolarEstrategia(db, ref.organizationId, { slug: 'parcelas', periodo: '2026-Q4' }),
      ).rejects.toThrow(/encargo/i)

      // Y no deja una corrida colgada que el worker vaya a tomar.
      expect(await db.select().from(esquema.pipelineRuns)).toHaveLength(0)
    })
  })

  // Un encargo que dejó de cumplir su esquema es tan poco confiable como uno
  // ausente: dejarlo pasar encolaría una corrida que el worker no puede leer.
  // Sin esta prueba, cambiar la guarda de `!== 'presente'` a `=== 'ausente'`
  // —una mutación tentadora, y equivocada— queda en verde: es el escenario
  // que ese cambio deja de cubrir.
  it('se niega si el encargo escrito ya no cumple su esquema', async () => {
    await conBaseDeDatosDePrueba(async (db) => {
      const ref = await sembrarConEstrategia(db)
      await db.insert(esquema.strategyBriefs).values({
        organizationId: ref.organizationId,
        brandId: ref.brandId,
        period: '2026-Q4',
        data: { objetivo: 'corto' },
      })

      await expect(
        encolarEstrategia(db, ref.organizationId, { slug: 'parcelas', periodo: '2026-Q4' }),
      ).rejects.toThrow(/encargo/i)

      expect(await db.select().from(esquema.pipelineRuns)).toHaveLength(0)
    })
  })

  it('encola cuando el encargo ya está escrito', async () => {
    await conBaseDeDatosDePrueba(async (db) => {
      const ref = await sembrarConEstrategia(db)
      await guardarEncargo(db, ref.organizationId, {
        slug: 'parcelas', periodo: '2026-Q4', encargo: ENCARGO_VALIDO,
      })

      const runId = await encolarEstrategia(db, ref.organizationId, {
        slug: 'parcelas', periodo: '2026-Q4',
      })
      expect(runId).toBeTruthy()
    })
  })
})

/**
 * La guarda contra el doble encolado, en el dominio.
 *
 * Las dos pantallas ya esconden el botón mientras hay una corrida viva y eso
 * está probado, pero es un render de servidor: dos pestañas abiertas, o una
 * pestaña vieja, lo esquivan. Medido antes de esta guarda: dos `encolarGrilla`
 * seguidos daban dos corridas sin una queja del dominio, el worker ejecutaba
 * las dos y `ai_calls` terminaba en 2 — y `corridaDe` devuelve solo la más
 * reciente, así que la otra se paga sin aparecer en pantalla.
 */
describe('encolar con una corrida ya viva', () => {
  it('rechaza la segunda grilla del mismo mes y no inserta nada', async () => {
    await conBaseDeDatosDePrueba(async (db) => {
      const ref = await sembrarConEstrategia(db)
      await encolarGrilla(db, ref.organizationId, { slug: 'parcelas', mes: '2026-10' })

      // El mensaje lo lee una persona en pantalla: nombra qué se está
      // generando, de qué periodo, de qué marca, y qué hacer.
      await expect(
        encolarGrilla(db, ref.organizationId, { slug: 'parcelas', mes: '2026-10' }),
      ).rejects.toThrow(/Ya se está generando la grilla de 2026-10 para la marca parcelas/)

      expect(await db.select().from(esquema.pipelineRuns)).toHaveLength(1)
    })
  })

  it('rechaza la segunda estrategia del mismo trimestre', async () => {
    await conBaseDeDatosDePrueba(async (db) => {
      const ref = await sembrarConEstrategia(db)
      await guardarEncargo(db, ref.organizationId, {
        slug: 'parcelas', periodo: '2026-Q4', encargo: ENCARGO_VALIDO,
      })
      await encolarEstrategia(db, ref.organizationId, { slug: 'parcelas', periodo: '2026-Q4' })

      await expect(
        encolarEstrategia(db, ref.organizationId, { slug: 'parcelas', periodo: '2026-Q4' }),
      ).rejects.toThrow(/Ya se está generando la estrategia de 2026-Q4/)

      expect(await db.select().from(esquema.pipelineRuns)).toHaveLength(1)
    })
  })

  // El caso que de verdad ocurre: el worker ya la tomó —así que la fila pasó a
  // `en_curso` y el modelo ya se está pagando— y alguien vuelve a la pestaña
  // vieja y aprieta Generar. Mirar solo `pendiente` dejaría pasar justo este.
  it('rechaza también cuando el worker ya la tomó', async () => {
    await conBaseDeDatosDePrueba(async (db) => {
      const ref = await sembrarConEstrategia(db)
      const runId = await encolarGrilla(db, ref.organizationId, { slug: 'parcelas', mes: '2026-10' })
      await db
        .update(esquema.pipelineRuns)
        .set({ status: 'en_curso' })
        .where(eq(esquema.pipelineRuns.id, runId))

      await expect(
        encolarGrilla(db, ref.organizationId, { slug: 'parcelas', mes: '2026-10' }),
      ).rejects.toThrow(/en curso/)
    })
  })

  // El otro lado, y el que impide que la guarda se vuelva una trampa:
  // regenerar es una operación legítima y frecuente. Una corrida terminada
  // —bien o mal— no bloquea nada.
  it('una corrida completada o fallida no impide volver a generar', async () => {
    await conBaseDeDatosDePrueba(async (db) => {
      const ref = await sembrarConEstrategia(db)
      const primera = await encolarGrilla(db, ref.organizationId, {
        slug: 'parcelas', mes: '2026-10',
      })
      await db
        .update(esquema.pipelineRuns)
        .set({ status: 'completado' })
        .where(eq(esquema.pipelineRuns.id, primera))

      const segunda = await encolarGrilla(db, ref.organizationId, {
        slug: 'parcelas', mes: '2026-10',
      })
      await db
        .update(esquema.pipelineRuns)
        .set({ status: 'fallido', error: 'lo que sea' })
        .where(eq(esquema.pipelineRuns.id, segunda))

      await expect(
        encolarGrilla(db, ref.organizationId, { slug: 'parcelas', mes: '2026-10' }),
      ).resolves.toEqual(expect.any(String))

      expect(await db.select().from(esquema.pipelineRuns)).toHaveLength(3)
    })
  })

  // La guarda es por marca, por flujo y por periodo. Sin cualquiera de los
  // tres filtros, generar la grilla de noviembre quedaría bloqueada porque
  // octubre está en la cola, y la marca nueva no podría generar nada mientras
  // otra estuviera generando.
  it('no bloquea otro periodo, otro flujo ni otra marca', async () => {
    await conBaseDeDatosDePrueba(async (db) => {
      const ref = await sembrarConEstrategia(db)
      await crearMarca(db, ref.organizationId, { slug: 'otra-marca', nombre: 'Otra' })
      await encolarGrilla(db, ref.organizationId, { slug: 'parcelas', mes: '2026-10' })

      await encolarGrilla(db, ref.organizationId, { slug: 'parcelas', mes: '2026-11' })
      await guardarEncargo(db, ref.organizationId, {
        slug: 'parcelas', periodo: '2026-Q4', encargo: ENCARGO_VALIDO,
      })
      await encolarEstrategia(db, ref.organizationId, { slug: 'parcelas', periodo: '2026-Q4' })
      await encolarGrilla(db, ref.organizationId, { slug: 'otra-marca', mes: '2026-10' })

      expect(await db.select().from(esquema.pipelineRuns)).toHaveLength(4)
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
      //
      // QUÉ SOSTIENE HOY ESTA PRUEBA, que no es lo que su nombre sugiere.
      // Medido en la revisión final: quitar `FOR UPDATE SKIP LOCKED` entero de
      // `tomarCorridaPendiente` la deja **verde**. Quien la salva es el
      // `WHERE status = 'pendiente'` del UPDATE externo, que se agregó después
      // como defensa en profundidad y está documentado allá: al despertar, el
      // segundo revalida ese predicado contra la fila ya actualizada, la ve
      // `en_curso` y no escribe. O sea que esta prueba afirma la garantía de
      // punta a punta —dos consumidores, una sola corrida— y no la cláusula de
      // bloqueo en particular.
      // Lo que sí es falsable por la cláusula es la prueba de al lado: sin
      // `SKIP LOCKED`, «no se queda esperando la corrida que otro consumidor
      // tiene bloqueada» se pone roja. Son dos garantías distintas —corrección
      // y vivacidad— y por eso son dos pruebas.
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
      await guardarEncargo(db, ref.organizationId, {
        slug: 'parcelas', periodo: '2026-Q4', encargo: ENCARGO_VALIDO,
      })
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

  // `segundosSinSenal` no es `encoladaHace` con otro nombre, y esta es la
  // diferencia que la pantalla necesita: una corrida que lleva veinte minutos
  // encolada pero cuyo paso terminó hace un momento **no** está colgada, y
  // ofrecerle "Reanudar" pondría a dos workers en el mismo paso. Es el mismo
  // cálculo que usa la guarda de `reanudarCorridaEncolada`, y por eso la
  // pantalla ofrece el botón exactamente cuando el dominio lo acepta.
  it('informa los segundos sin señal contando desde el paso, no desde el encolado', async () => {
    await conBaseDeDatosDePrueba(async (db) => {
      const ref = await sembrarConEstrategia(db)
      const runId = await encolarGrilla(db, ref.organizationId, { slug: 'parcelas', mes: '2026-10' })
      await db
        .update(esquema.pipelineRuns)
        .set({ status: 'en_curso', startedAt: sql`now() - interval '20 minutes'` })
        .where(eq(esquema.pipelineRuns.id, runId))
      await db.insert(esquema.pipelineSteps).values({
        organizationId: ref.organizationId,
        runId,
        name: 'proponer_grilla',
        status: 'completado',
        idempotencyKey: `${runId}:proponer_grilla`,
        startedAt: sql`now() - interval '19 minutes'`,
        finishedAt: sql`now() - interval '5 seconds'`,
      })

      const c = await corridaDe(db, ref.organizationId, {
        slug: 'parcelas', flujo: 'p2_grilla', periodo: '2026-10',
      })

      // Las dos aserciones juntas: sin la de arriba, devolver `encoladaHace`
      // en las dos propiedades pasaría la de abajo.
      expect(c?.encoladaHace).toBeGreaterThan(1_000)
      expect(c?.segundosSinSenal).toBeLessThan(60)
    })
  })
})

describe('reanudarCorridaEncolada', () => {
  it('devuelve una corrida fallida a pendiente, y limpia su error', async () => {
    await conBaseDeDatosDePrueba(async (db) => {
      const ref = await sembrarConEstrategia(db)
      const runId = await encolarGrilla(db, ref.organizationId, { slug: 'parcelas', mes: '2026-10' })
      await db
        .update(esquema.pipelineRuns)
        .set({ status: 'fallido', error: 'lo que sea' })
        .where(eq(esquema.pipelineRuns.id, runId))

      await reanudarCorridaEncolada(db, ref.organizationId, runId)

      const [fila] = await db
        .select()
        .from(esquema.pipelineRuns)
        .where(eq(esquema.pipelineRuns.id, runId))
      expect(fila!.status).toBe('pendiente')
      expect(fila!.error).toBeNull()
    })
  })

  // Reanudar **es** volver a encolar, así que la antigüedad en la cola cuenta
  // desde ahora. Sin reiniciar la marca de tiempo, una corrida que llevaba una
  // hora encolada renace `pendiente` con 3600 segundos encima y la pantalla
  // anuncia «nadie tomó esta generación… lo normal es que el worker no esté
  // corriendo» en el instante mismo en que se suelta el botón, con el worker
  // sano. La hora se escribe hacia atrás en la base en vez de esperarla.
  it('reanudar deja la antigüedad en la cola en casi cero', async () => {
    await conBaseDeDatosDePrueba(async (db) => {
      const ref = await sembrarConEstrategia(db)
      const runId = await encolarGrilla(db, ref.organizationId, { slug: 'parcelas', mes: '2026-10' })
      await db
        .update(esquema.pipelineRuns)
        .set({ status: 'fallido', error: 'lo que sea', startedAt: sql`now() - interval '1 hour'` })
        .where(eq(esquema.pipelineRuns.id, runId))

      // El estado de partida es el que el revisor midió: una corrida vieja.
      // Sin esto, una prueba que solo mira el final pasaría igual con una
      // corrida recién encolada, que no puede fallar.
      const antes = await corridaDe(db, ref.organizationId, {
        slug: 'parcelas', flujo: 'p2_grilla', periodo: '2026-10',
      })
      expect(antes?.encoladaHace).toBeGreaterThan(3_000)

      await reanudarCorridaEncolada(db, ref.organizationId, runId)

      const despues = await corridaDe(db, ref.organizationId, {
        slug: 'parcelas', flujo: 'p2_grilla', periodo: '2026-10',
      })
      expect(despues?.estado).toBe('pendiente')
      expect(despues?.encoladaHace).toBeLessThan(30)
      expect(despues?.segundosSinSenal).toBeLessThan(30)
    })
  })

  // Efecto secundario de reiniciar la marca de tiempo, y el correcto:
  // `tomarCorridaPendiente` ordena por esa misma columna, así que la reanudada
  // espera su turno en vez de colarse delante de las que ya estaban en la cola.
  it('la corrida reanudada va al final de la cola, no al principio', async () => {
    await conBaseDeDatosDePrueba(async (db) => {
      const ref = await sembrarConEstrategia(db)
      const vieja = await encolarGrilla(db, ref.organizationId, { slug: 'parcelas', mes: '2026-10' })
      await db
        .update(esquema.pipelineRuns)
        .set({ status: 'fallido', error: 'lo que sea', startedAt: sql`now() - interval '1 hour'` })
        .where(eq(esquema.pipelineRuns.id, vieja))
      const esperando = await encolarGrilla(db, ref.organizationId, {
        slug: 'parcelas', mes: '2026-11',
      })

      await reanudarCorridaEncolada(db, ref.organizationId, vieja)

      expect((await tomarCorridaPendiente(db))?.id).toBe(esperando)
      expect((await tomarCorridaPendiente(db))?.id).toBe(vieja)
    })
  })

  // La antigüedad se escribe hacia atrás en la base en vez de esperarla: una
  // prueba que duerme quince minutos no la corre nadie.
  it('reanuda una corrida colgada en en_curso que hace rato no da señales', async () => {
    await conBaseDeDatosDePrueba(async (db) => {
      const ref = await sembrarConEstrategia(db)
      const runId = await encolarGrilla(db, ref.organizationId, { slug: 'parcelas', mes: '2026-10' })
      await db
        .update(esquema.pipelineRuns)
        .set({ status: 'en_curso', startedAt: sql`now() - interval '20 minutes'` })
        .where(eq(esquema.pipelineRuns.id, runId))

      await reanudarCorridaEncolada(db, ref.organizationId, runId)

      const [fila] = await db
        .select()
        .from(esquema.pipelineRuns)
        .where(eq(esquema.pipelineRuns.id, runId))
      expect(fila!.status).toBe('pendiente')
    })
  })

  // El estado `en_curso` no distingue "se colgó" de "el worker la está
  // ejecutando ahora mismo". Si esta se reanudara, otro worker la tomaría
  // mientras el primero sigue, y los dos pagarían el mismo paso del modelo.
  it('no reanuda una corrida en_curso que dio señales hace un momento', async () => {
    await conBaseDeDatosDePrueba(async (db) => {
      const ref = await sembrarConEstrategia(db)
      const runId = await encolarGrilla(db, ref.organizationId, { slug: 'parcelas', mes: '2026-10' })
      await db
        .update(esquema.pipelineRuns)
        .set({ status: 'en_curso' })
        .where(eq(esquema.pipelineRuns.id, runId))

      // El mensaje es distinto del de una completada: no dice "este estado no
      // se reanuda" sino "espera, alguien la está ejecutando".
      await expect(
        reanudarCorridaEncolada(db, ref.organizationId, runId),
      ).rejects.toThrow(/parece estar ejecutándose/)

      const [fila] = await db
        .select()
        .from(esquema.pipelineRuns)
        .where(eq(esquema.pipelineRuns.id, runId))
      expect(fila!.status).toBe('en_curso')
    })
  })

  // Las dos que siguen clavan el umbral, y son las únicas que lo hacen. Las de
  // arriba lo rodean cómodamente —veinte minutos de un lado, cero y cinco
  // segundos del otro— así que bajarlo de quince minutos a dos las dejaba a
  // todas en verde, con `@gc/operaciones` y `@gc/web` completos. Y el propio
  // `senales.ts` explica qué cuesta quedarse corto: dos workers en el mismo
  // paso, **los dos pagando el modelo**.
  //
  // Los números van escritos a mano y no importando la constante a propósito:
  // una prueba que la importe se compara consigo misma y acepta cualquier
  // valor. Estas dos, juntas, solo aceptan un umbral entre 14 y 16 minutos.
  it('a los catorce minutos sin señal todavía no se reanuda', async () => {
    await conBaseDeDatosDePrueba(async (db) => {
      const ref = await sembrarConEstrategia(db)
      const runId = await encolarGrilla(db, ref.organizationId, { slug: 'parcelas', mes: '2026-10' })
      await db
        .update(esquema.pipelineRuns)
        .set({ status: 'en_curso', startedAt: sql`now() - interval '14 minutes'` })
        .where(eq(esquema.pipelineRuns.id, runId))

      await expect(
        reanudarCorridaEncolada(db, ref.organizationId, runId),
      ).rejects.toThrow(/parece estar ejecutándose/)

      const [fila] = await db
        .select()
        .from(esquema.pipelineRuns)
        .where(eq(esquema.pipelineRuns.id, runId))
      expect(fila!.status).toBe('en_curso')
    })
  })

  it('a los dieciséis minutos sin señal ya se reanuda', async () => {
    await conBaseDeDatosDePrueba(async (db) => {
      const ref = await sembrarConEstrategia(db)
      const runId = await encolarGrilla(db, ref.organizationId, { slug: 'parcelas', mes: '2026-10' })
      await db
        .update(esquema.pipelineRuns)
        .set({ status: 'en_curso', startedAt: sql`now() - interval '16 minutes'` })
        .where(eq(esquema.pipelineRuns.id, runId))

      await reanudarCorridaEncolada(db, ref.organizationId, runId)

      const [fila] = await db
        .select()
        .from(esquema.pipelineRuns)
        .where(eq(esquema.pipelineRuns.id, runId))
      expect(fila!.status).toBe('pendiente')
    })
  })

  // Mirando solo la marca de tiempo de la corrida, esta parecería abandonada:
  // se encoló hace veinte minutos. La señal viva está en su paso, que se pasó
  // ese rato entre reintentos y llamadas al modelo y acaba de terminar. Sin la
  // subconsulta sobre `pipeline_steps` —o mirando solo el `started_at` del
  // paso— esta corrida se reanudaría con el worker todavía adentro.
  it('no reanuda una corrida vieja cuyo paso terminó hace un momento', async () => {
    await conBaseDeDatosDePrueba(async (db) => {
      const ref = await sembrarConEstrategia(db)
      const runId = await encolarGrilla(db, ref.organizationId, { slug: 'parcelas', mes: '2026-10' })
      await db
        .update(esquema.pipelineRuns)
        .set({ status: 'en_curso', startedAt: sql`now() - interval '20 minutes'` })
        .where(eq(esquema.pipelineRuns.id, runId))
      await db.insert(esquema.pipelineSteps).values({
        organizationId: ref.organizationId,
        runId,
        name: 'proponer_grilla',
        status: 'completado',
        idempotencyKey: `${runId}:proponer_grilla`,
        startedAt: sql`now() - interval '19 minutes'`,
        finishedAt: sql`now() - interval '5 seconds'`,
      })

      await expect(
        reanudarCorridaEncolada(db, ref.organizationId, runId),
      ).rejects.toThrow(/parece estar ejecutándose/)

      const [fila] = await db
        .select()
        .from(esquema.pipelineRuns)
        .where(eq(esquema.pipelineRuns.id, runId))
      expect(fila!.status).toBe('en_curso')
    })
  })

  it('no reanuda una corrida completada', async () => {
    await conBaseDeDatosDePrueba(async (db) => {
      const ref = await sembrarConEstrategia(db)
      const runId = await encolarGrilla(db, ref.organizationId, { slug: 'parcelas', mes: '2026-10' })
      await db
        .update(esquema.pipelineRuns)
        .set({ status: 'completado' })
        .where(eq(esquema.pipelineRuns.id, runId))

      await expect(
        reanudarCorridaEncolada(db, ref.organizationId, runId),
      ).rejects.toThrow(/completado/)
    })
  })

  // `encolarGrilla` ya la deja `pendiente`: no hace falta tocarle el estado.
  // Reanudar aquí no rompería nada, pero el botón mentiría —"la puse en cola"
  // cuando ya estaba— y taparía el diagnóstico real, que es que el worker no
  // está tomando corridas. El mensaje nombra el estado para que se vea.
  it('no reanuda una corrida que ya está pendiente', async () => {
    await conBaseDeDatosDePrueba(async (db) => {
      const ref = await sembrarConEstrategia(db)
      const runId = await encolarGrilla(db, ref.organizationId, { slug: 'parcelas', mes: '2026-10' })

      await expect(
        reanudarCorridaEncolada(db, ref.organizationId, runId),
      ).rejects.toThrow(/pendiente/)
    })
  })

  it('no reanuda la corrida de otra organización', async () => {
    await conBaseDeDatosDePrueba(async (db) => {
      const ref = await sembrarConEstrategia(db)
      const runId = await encolarGrilla(db, ref.organizationId, { slug: 'parcelas', mes: '2026-10' })
      // Fallida (no pendiente): si la operación no distinguiera tenencia y
      // reanudara igual, esta prueba lo vería como un cambio de estado, no
      // como "seguía en el mismo estado en el que ya estaba".
      await db
        .update(esquema.pipelineRuns)
        .set({ status: 'fallido', error: 'lo que sea' })
        .where(eq(esquema.pipelineRuns.id, runId))
      const [otra] = await db
        .insert(esquema.organizations)
        .values({ name: 'Otra', slug: 'otra' })
        .returning({ id: esquema.organizations.id })

      await expect(
        reanudarCorridaEncolada(db, otra!.id, runId),
      ).rejects.toThrow()

      const [fila] = await db
        .select()
        .from(esquema.pipelineRuns)
        .where(eq(esquema.pipelineRuns.id, runId))
      expect(fila!.status).toBe('fallido')
    })
  })
})
