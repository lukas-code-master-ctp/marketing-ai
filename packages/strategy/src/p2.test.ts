import { ClienteFalso } from '@gc/ai'
import { PERFIL_VALIDO, guardarPerfil } from '@gc/brand'
import { esquema } from '@gc/db'
import { conBaseDeDatosDePrueba } from '@gc/db/pruebas'
import { ejecutarFlujo } from '@gc/pipeline'
import { eq, sql } from 'drizzle-orm'
import { describe, expect, it } from 'vitest'
import { crearFlujoGrilla } from './p2.js'

const ENV = { MODELO_RAZONAMIENTO: 'proveedor/fuerte' }
const SIN_ESPERA = { dormir: async () => {}, aleatorio: () => 0 }

const ESTRATEGIA = {
  objetivos: [{ nombre: 'Alcance', metrica: 'alcance', meta: '+10%' }],
  mensajesClave: ['mensaje uno largo', 'mensaje dos largo'],
  mixDeCanales: [
    { canal: 'blog', publicacionesPorSemana: 1 },
    { canal: 'linkedin', publicacionesPorSemana: 1 },
  ],
  reciclaje: [{ desde: 'blog', hacia: ['linkedin'], diasDespues: 2 }],
  temasPrioritarios: ['factibilidad de agua'],
}

const grilla = (slots: unknown[]) => JSON.stringify({ slots })

const SLOT = (fecha: string, pilar: string, canal = 'blog') => ({
  fecha,
  hora: '12:00',
  canal,
  formato: 'articulo',
  pilar,
  angulo: 'guía práctica',
  brief: 'Explicar paso a paso cómo verificar la factibilidad antes de comprar.',
})

const GRILLA_VALIDA = grilla([
  SLOT('2026-09-02', 'educacion'),
  SLOT('2026-09-09', 'educacion'),
  SLOT('2026-09-16', 'confianza'),
  SLOT('2026-09-23', 'producto'),
])

async function sembrar(db: Parameters<Parameters<typeof conBaseDeDatosDePrueba>[0]>[0]) {
  const [org] = await db.insert(esquema.organizations).values({ name: 'X', slug: 'x' }).returning()
  const [marca] = await db
    .insert(esquema.brands)
    .values({ organizationId: org!.id, slug: 'parcelas', name: 'CTP' })
    .returning()
  const ref = { organizationId: org!.id, brandId: marca!.id }
  await guardarPerfil(db, ref, PERFIL_VALIDO)
  await db.insert(esquema.strategies).values({
    organizationId: ref.organizationId,
    brandId: ref.brandId,
    period: '2026-Q3',
    data: ESTRATEGIA,
    brandProfileVersion: 1,
  })
  return ref
}

describe('flujo P2 · grilla', () => {
  it('persiste el plan, los slots y sus derivados enlazados', async () => {
    await conBaseDeDatosDePrueba(async (db) => {
      const ref = await sembrar(db)
      const flujo = crearFlujoGrilla({ cliente: new ClienteFalso([GRILLA_VALIDA]), env: ENV })

      const r = await ejecutarFlujo(
        db, flujo, { brandId: ref.brandId, mes: '2026-09' }, ref, SIN_ESPERA,
      )
      expect(r.estado).toBe('completado')

      const [plan] = await db.select().from(esquema.contentPlans)
      expect(plan!.status).toBe('borrador')

      const slots = await db.select().from(esquema.planSlots)
      expect(slots).toHaveLength(8)

      // No basta con que cada derivado cuelgue de algún padre: los cuatro
      // artículos son idénticos salvo la fecha, así que un mapeo barajado
      // pasaría igual. La fecha del hijo debe ser la del padre + diasDespues.
      const porId = new Map(slots.map((s) => [s.id, s]))
      const derivados = slots.filter((s) => s.sourceSlotId !== null)
      expect(derivados).toHaveLength(4)

      for (const d of derivados) {
        expect(d.channel).toBe('linkedin')
        const padre = porId.get(d.sourceSlotId!)
        expect(padre).toBeDefined()
        expect(padre!.channel).toBe('blog')
        const dias =
          (d.scheduledFor.getTime() - padre!.scheduledFor.getTime()) / 86_400_000
        expect(dias).toBe(2)
      }
    })
  })

  it('repara una sola vez cuando la grilla tiene problemas bloqueantes', async () => {
    await conBaseDeDatosDePrueba(async (db) => {
      const ref = await sembrar(db)
      const invalida = grilla([SLOT('2026-10-05', 'educacion')])
      const cliente = new ClienteFalso([invalida, GRILLA_VALIDA])
      const flujo = crearFlujoGrilla({ cliente, env: ENV })

      await ejecutarFlujo(db, flujo, { brandId: ref.brandId, mes: '2026-09' }, ref, SIN_ESPERA)

      expect(cliente.peticiones).toHaveLength(2)
      const reintento = cliente.peticiones[1]!.mensajes.at(-1)!.texto
      expect(reintento).toContain('fuera_de_mes')
    })
  })

  it('falla de forma permanente si la reparación sigue siendo inválida', async () => {
    await conBaseDeDatosDePrueba(async (db) => {
      const ref = await sembrar(db)
      const invalida = grilla([SLOT('2026-10-05', 'educacion')])
      const flujo = crearFlujoGrilla({
        cliente: new ClienteFalso([invalida, invalida]),
        env: ENV,
      })

      await expect(
        ejecutarFlujo(db, flujo, { brandId: ref.brandId, mes: '2026-09' }, ref, SIN_ESPERA),
      ).rejects.toMatchObject({ clase: 'permanente' })

      expect(await db.select().from(esquema.planSlots)).toHaveLength(0)
    })
  })

  it('no persiste en octubre un slot del 30 de septiembre a las 24:00', async () => {
    await conBaseDeDatosDePrueba(async (db) => {
      const ref = await sembrar(db)
      // 24:00 desbordaba al 1 de octubre: un slot colgado del content_plan de
      // septiembre que `grilla:ver --mes 2026-09` no ve y que aparece en octubre.
      const conHora = (hora: string) => grilla([{ ...SLOT('2026-09-30', 'educacion'), hora }])
      const cliente = new ClienteFalso([conHora('24:00'), conHora('23:00')])
      const flujo = crearFlujoGrilla({ cliente, env: ENV })

      const r = await ejecutarFlujo(
        db, flujo, { brandId: ref.brandId, mes: '2026-09' }, ref, SIN_ESPERA,
      )
      expect(r.estado).toBe('completado')

      // El esquema rechazó la primera respuesta y el modelo tuvo su reparación.
      expect(cliente.peticiones).toHaveLength(2)
      expect(cliente.peticiones[1]!.mensajes.at(-1)!.texto).toContain('hora')

      const slots = await db.select().from(esquema.planSlots)
      expect(slots).toHaveLength(1)
      expect(slots[0]!.scheduledFor.toISOString()).toBe('2026-09-30T23:00:00.000Z')
    })
  })

  it('no persiste un derivado que choca con un slot ya propuesto', async () => {
    await conBaseDeDatosDePrueba(async (db) => {
      const ref = await sembrar(db)
      // El derivado de blog(02) cae en linkedin el 04, donde el modelo ya puso
      // un post: la propuesta no tiene bloqueantes, pero persistir ambos sí.
      const choque = grilla([
        SLOT('2026-09-02', 'educacion'),
        SLOT('2026-09-04', 'educacion', 'linkedin'),
      ])
      const flujo = crearFlujoGrilla({ cliente: new ClienteFalso([choque]), env: ENV })

      const r = await ejecutarFlujo(
        db, flujo, { brandId: ref.brandId, mes: '2026-09' }, ref, SIN_ESPERA,
      )
      expect(r.estado).toBe('completado')

      const slots = await db.select().from(esquema.planSlots)
      expect(slots).toHaveLength(2)
      expect(slots.filter((s) => s.sourceSlotId !== null)).toHaveLength(0)
    })
  })

  it('no genera derivados hacia un canal ausente del mix de la estrategia', async () => {
    await conBaseDeDatosDePrueba(async (db) => {
      const ref = await sembrar(db)
      await db
        .update(esquema.strategies)
        .set({
          data: {
            ...ESTRATEGIA,
            mixDeCanales: [{ canal: 'blog', publicacionesPorSemana: 1 }],
          },
        })
        .where(eq(esquema.strategies.brandId, ref.brandId))

      const flujo = crearFlujoGrilla({ cliente: new ClienteFalso([GRILLA_VALIDA]), env: ENV })
      await ejecutarFlujo(db, flujo, { brandId: ref.brandId, mes: '2026-09' }, ref, SIN_ESPERA)

      const slots = await db.select().from(esquema.planSlots)
      expect(slots).toHaveLength(4)
      expect(slots.every((s) => s.channel === 'blog')).toBe(true)
    })
  })

  it('los avisos describen la grilla expandida, no la propuesta', async () => {
    await conBaseDeDatosDePrueba(async (db) => {
      const ref = await sembrar(db)
      // La propuesta trae 0 publicaciones de linkedin frente a las ~4 que pide
      // la estrategia; la expansión aporta exactamente esas 4. El aviso de
      // cadencia solo desaparece si se valida la grilla final.
      const flujo = crearFlujoGrilla({ cliente: new ClienteFalso([GRILLA_VALIDA]), env: ENV })

      const r = await ejecutarFlujo(
        db, flujo, { brandId: ref.brandId, mes: '2026-09' }, ref, SIN_ESPERA,
      )
      const salida = r.salida as { avisos: Array<{ regla: string; detalle: string }> }
      expect(salida.avisos.filter((a) => a.regla === 'cadencia')).toEqual([])
    })
  })

  it('devuelve los avisos sin bloquear', async () => {
    await conBaseDeDatosDePrueba(async (db) => {
      const ref = await sembrar(db)
      const pocos = grilla([SLOT('2026-09-02', 'educacion')])
      const flujo = crearFlujoGrilla({ cliente: new ClienteFalso([pocos]), env: ENV })

      const r = await ejecutarFlujo(
        db, flujo, { brandId: ref.brandId, mes: '2026-09' }, ref, SIN_ESPERA,
      )
      const salida = r.salida as { avisos: Array<{ regla: string }> }
      expect(salida.avisos.map((a) => a.regla)).toContain('cadencia')
    })
  })

  it('regenerar el mismo mes reemplaza los slots anteriores', async () => {
    await conBaseDeDatosDePrueba(async (db) => {
      const ref = await sembrar(db)
      const entrada = { brandId: ref.brandId, mes: '2026-09' }

      for (const _ of [1, 2]) {
        const flujo = crearFlujoGrilla({ cliente: new ClienteFalso([GRILLA_VALIDA]), env: ENV })
        await ejecutarFlujo(db, flujo, entrada, ref, SIN_ESPERA)
      }

      expect(await db.select().from(esquema.contentPlans)).toHaveLength(1)
      expect(await db.select().from(esquema.planSlots)).toHaveLength(8)
    })
  })

  it('falla si la marca no tiene estrategia', async () => {
    await conBaseDeDatosDePrueba(async (db) => {
      const [org] = await db.insert(esquema.organizations).values({ name: 'X', slug: 'x' }).returning()
      const [marca] = await db
        .insert(esquema.brands)
        .values({ organizationId: org!.id, slug: 'sin', name: 'Sin' })
        .returning()
      const ref = { organizationId: org!.id, brandId: marca!.id }
      await guardarPerfil(db, ref, PERFIL_VALIDO)

      const flujo = crearFlujoGrilla({ cliente: new ClienteFalso([GRILLA_VALIDA]), env: ENV })
      await expect(
        ejecutarFlujo(db, flujo, { brandId: ref.brandId, mes: '2026-09' }, ref, SIN_ESPERA),
      ).rejects.toMatchObject({ clase: 'permanente' })
    })
  })

  it('no regenera una grilla que ya salió de borrador', async () => {
    await conBaseDeDatosDePrueba(async (db) => {
      const ref = await sembrar(db)
      const entrada = { brandId: ref.brandId, mes: '2026-09' }

      const flujo = crearFlujoGrilla({ cliente: new ClienteFalso([GRILLA_VALIDA]), env: ENV })
      await ejecutarFlujo(db, flujo, entrada, ref, SIN_ESPERA)

      await db
        .update(esquema.contentPlans)
        .set({ status: 'aprobada' })
        .where(eq(esquema.contentPlans.brandId, ref.brandId))

      const otro = crearFlujoGrilla({ cliente: new ClienteFalso([GRILLA_VALIDA]), env: ENV })
      await expect(
        ejecutarFlujo(db, otro, entrada, ref, SIN_ESPERA),
      ).rejects.toMatchObject({ clase: 'permanente' })

      // Ni el estado ni los slots se tocan: el throw ocurre antes del delete.
      const [plan] = await db.select().from(esquema.contentPlans)
      expect(plan!.status).toBe('aprobada')
      expect(await db.select().from(esquema.planSlots)).toHaveLength(8)
    })
  })

  it('rechaza regenerar una grilla aprobada nombrando la marca por su slug', async () => {
    await conBaseDeDatosDePrueba(async (db) => {
      const ref = await sembrar(db)
      const entrada = { brandId: ref.brandId, mes: '2026-09' }

      const flujo = crearFlujoGrilla({ cliente: new ClienteFalso([GRILLA_VALIDA]), env: ENV })
      await ejecutarFlujo(db, flujo, entrada, ref, SIN_ESPERA)

      await db
        .update(esquema.contentPlans)
        .set({ status: 'aprobada' })
        .where(eq(esquema.contentPlans.brandId, ref.brandId))

      const otro = crearFlujoGrilla({ cliente: new ClienteFalso([GRILLA_VALIDA]), env: ENV })
      const error = await ejecutarFlujo(
        db, otro, entrada, { ...ref, brandSlug: 'parcelas' }, SIN_ESPERA,
      ).catch((e: unknown) => e)

      expect((error as Error).message).toContain('parcelas')
      expect((error as Error).message).not.toContain(ref.brandId)
    })
  })

  it('no destruye la grilla anterior si falla la inserción de los slots', async () => {
    await conBaseDeDatosDePrueba(async (db) => {
      const ref = await sembrar(db)
      const entrada = { brandId: ref.brandId, mes: '2026-09' }

      const flujo = crearFlujoGrilla({ cliente: new ClienteFalso([GRILLA_VALIDA]), env: ENV })
      await ejecutarFlujo(db, flujo, entrada, ref, SIN_ESPERA)
      expect(await db.select().from(esquema.planSlots)).toHaveLength(8)

      // Falla real de la base al insertar, después de que el delete ya corrió.
      await db.execute(sql`
        create or replace function gc_romper_slots() returns trigger
        language plpgsql as $$ begin raise exception 'caída simulada al insertar'; end; $$
      `)
      await db.execute(sql`
        create trigger gc_romper_slots before insert on plan_slots
        for each row execute function gc_romper_slots()
      `)

      try {
        const otro = crearFlujoGrilla({ cliente: new ClienteFalso([GRILLA_VALIDA]), env: ENV })
        await expect(ejecutarFlujo(db, otro, entrada, ref, SIN_ESPERA)).rejects.toThrow()
      } finally {
        await db.execute(sql`drop trigger if exists gc_romper_slots on plan_slots`)
        await db.execute(sql`drop function if exists gc_romper_slots()`)
      }

      // Borrar lo viejo e insertar lo nuevo es una sola unidad: el mes no puede
      // quedarse con su content_plan y sin un solo slot.
      expect(await db.select().from(esquema.planSlots)).toHaveLength(8)
    })
  })

  it('nombra el estado real de la grilla y no gasta llamadas al modelo', async () => {
    await conBaseDeDatosDePrueba(async (db) => {
      const ref = await sembrar(db)
      const entrada = { brandId: ref.brandId, mes: '2026-09' }

      const flujo = crearFlujoGrilla({ cliente: new ClienteFalso([GRILLA_VALIDA]), env: ENV })
      await ejecutarFlujo(db, flujo, entrada, ref, SIN_ESPERA)

      await db
        .update(esquema.contentPlans)
        .set({ status: 'en_ejecucion' })
        .where(eq(esquema.contentPlans.brandId, ref.brandId))
      await db.delete(esquema.aiCalls)

      const cliente = new ClienteFalso([GRILLA_VALIDA])
      const otro = crearFlujoGrilla({ cliente, env: ENV })

      // El mensaje nombra el estado que de verdad bloquea y el remedio real:
      // content_plans no tiene estado "archivada", así que pedirlo era imposible.
      await expect(
        ejecutarFlujo(db, otro, entrada, ref, SIN_ESPERA),
      ).rejects.toThrow(/"en_ejecucion".*borrador/s)

      expect(cliente.peticiones).toHaveLength(0)
      expect(await db.select().from(esquema.aiCalls)).toHaveLength(0)
    })
  })

  it('exige la estrategia del trimestre que corresponde al mes', async () => {
    await conBaseDeDatosDePrueba(async (db) => {
      const ref = await sembrar(db)

      // sembrar() crea la estrategia de 2026-Q3. Septiembre calza; diciembre no.
      const flujo = crearFlujoGrilla({ cliente: new ClienteFalso([GRILLA_VALIDA]), env: ENV })
      const error = await ejecutarFlujo(
        db, flujo, { brandId: ref.brandId, mes: '2026-12' }, ref, SIN_ESPERA,
      ).catch((e: unknown) => e)

      expect(error).toMatchObject({ clase: 'permanente' })
      expect((error as Error).message).toContain('2026-Q4')
      expect((error as Error).message).toContain('2026-12')
    })
  })

  it('no usa una estrategia archivada', async () => {
    await conBaseDeDatosDePrueba(async (db) => {
      const ref = await sembrar(db)
      await db
        .update(esquema.strategies)
        .set({ status: 'archivada' })
        .where(eq(esquema.strategies.brandId, ref.brandId))

      const flujo = crearFlujoGrilla({ cliente: new ClienteFalso([GRILLA_VALIDA]), env: ENV })
      const fallo = ejecutarFlujo(
        db, flujo, { brandId: ref.brandId, mes: '2026-09' }, ref, SIN_ESPERA,
      )

      // El periodo va en la aserción porque la clase sola se cumple con
      // cualquier otro fallo permanente: un `trimestreDe` roto que buscara
      // 2026-Q4 tampoco encontraría fila y dejaría la prueba en verde.
      await expect(fallo).rejects.toMatchObject({ clase: 'permanente' })
      await expect(fallo).rejects.toThrow(/2026-Q3/)
    })
  })

  it('ignora una estrategia más reciente de otro trimestre', async () => {
    await conBaseDeDatosDePrueba(async (db) => {
      const ref = await sembrar(db)
      const [q3] = await db
        .select()
        .from(esquema.strategies)
        .where(eq(esquema.strategies.period, '2026-Q3'))

      // Estrategia de Q4, creada después, con un mix que excluye blog.
      await db.insert(esquema.strategies).values({
        organizationId: ref.organizationId,
        brandId: ref.brandId,
        period: '2026-Q4',
        data: { ...ESTRATEGIA, mixDeCanales: [{ canal: 'tiktok', publicacionesPorSemana: 1 }] },
        brandProfileVersion: 1,
      })

      const flujo = crearFlujoGrilla({ cliente: new ClienteFalso([GRILLA_VALIDA]), env: ENV })
      const r = await ejecutarFlujo(
        db, flujo, { brandId: ref.brandId, mes: '2026-09' }, ref, SIN_ESPERA,
      )

      // Si hubiera tomado la de Q4, los slots de blog serían canal_fuera_de_mix.
      expect(r.estado).toBe('completado')

      // Pero eso solo se nota mientras canal_fuera_de_mix sea bloqueante: si
      // alguien lo degradara a aviso, la corrida completaría con la estrategia
      // equivocada. `persistir` deja el vínculo escrito, así que se lee.
      const [plan] = await db.select().from(esquema.contentPlans)
      expect(plan!.strategyId).toBe(q3!.id)
    })
  })

  it('reintentar tras un fallo al persistir no vuelve a llamar al modelo', async () => {
    await conBaseDeDatosDePrueba(async (db) => {
      const ref = await sembrar(db)

      // El cliente trae una sola respuesta: si el modelo se llamara dos veces,
      // ClienteFalso lanzaría permanente por quedarse sin respuestas.
      const cliente = new ClienteFalso([GRILLA_VALIDA])
      const flujo = crearFlujoGrilla({ cliente, env: ENV })

      // Un trigger que revienta el primer INSERT en plan_slots con un código
      // transitorio, y se desactiva solo para que el reintento pase. El
      // contador vive en una secuencia y no en una tabla: `persistir` hace
      // todo en una transacción, así que una bandera de tabla se revertiría
      // con el mismo rollback que provoca el fallo y jamás se desarmaría.
      // `nextval` no es transaccional, así que sí sobrevive.
      await db.execute(sql`
        create sequence if not exists fallo_una_vez_seq;
        select setval('fallo_una_vez_seq', 1, false);
        create or replace function romper_una_vez() returns trigger as $$
        begin
          if nextval('fallo_una_vez_seq') = 1 then
            raise exception 'conexión perdida' using errcode = '08006';
          end if;
          return new;
        end $$ language plpgsql;
        create trigger t_romper before insert on plan_slots
          for each row execute function romper_una_vez();
      `)

      try {
        const r = await ejecutarFlujo(
          db, flujo, { brandId: ref.brandId, mes: '2026-09' }, ref,
          { dormir: async () => {}, aleatorio: () => 0 },
        )

        expect(r.estado).toBe('completado')
        // Lo que prueba la tarea: una sola llamada al modelo pese al reintento.
        expect(cliente.peticiones).toHaveLength(1)
        expect(await db.select().from(esquema.aiCalls)).toHaveLength(1)
        expect(await db.select().from(esquema.planSlots)).toHaveLength(8)
      } finally {
        await db.execute(sql`
          drop trigger if exists t_romper on plan_slots;
          drop function if exists romper_una_vez();
          drop sequence if exists fallo_una_vez_seq;
        `)
      }
    })
  })
})
