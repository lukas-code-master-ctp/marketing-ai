import { ClienteFalso } from '@gc/ai'
import { PERFIL_VALIDO, guardarPerfil } from '@gc/brand'
import { esquema } from '@gc/db'
import { conBaseDeDatosDePrueba } from '@gc/db/pruebas'
import { ejecutarFlujo } from '@gc/pipeline'
import { eq, sql } from 'drizzle-orm'
import { describe, expect, it } from 'vitest'
import { crearFlujoEstrategia } from './p1.js'

const ENV = { MODELO_RAZONAMIENTO: 'proveedor/fuerte' }
const SIN_ESPERA = { dormir: async () => {}, aleatorio: () => 0 }

const ESTRATEGIA_JSON = JSON.stringify({
  objetivos: [{ nombre: 'Autoridad', metrica: 'alcance', meta: '+30% trimestral' }],
  mensajesClave: ['La factibilidad se verifica antes de comprar', 'Trazabilidad legal completa'],
  mixDeCanales: [
    { canal: 'blog', publicacionesPorSemana: 1 },
    { canal: 'linkedin', publicacionesPorSemana: 2 },
  ],
  reciclaje: [{ desde: 'blog', hacia: ['linkedin'], diasDespues: 2 }],
  temasPrioritarios: ['Factibilidad de agua', 'Regularización de roles'],
})

const ENCARGO = {
  objetivo: 'Vender las doce parcelas que quedan del loteo norte',
  comoSeMide: 'Formularios de contacto recibidos',
  publicacionesPorSemana: 4,
  canalesDisponibles: ['instagram', 'blog'],
  queEstaPasando: 'Empieza la temporada alta de visitas',
  queFunciono: '',
  queNoFunciono: 'Los carruseles largos no los vio nadie',
  queEvitar: '',
  algoMas: '',
}

async function sembrarEncargo(
  db: Parameters<Parameters<typeof conBaseDeDatosDePrueba>[0]>[0],
  ref: { organizationId: string; brandId: string },
  period = '2026-Q4',
) {
  await db.insert(esquema.strategyBriefs).values({
    organizationId: ref.organizationId, brandId: ref.brandId, period, data: ENCARGO,
  })
}

// Identificador reconocible a propósito: la prueba «usa el modelo que la
// organización eligió, no uno fijo» necesita distinguir este valor de
// cualquier literal que pudiera quedar escrito a mano en `p1.ts`, y de
// `ENV.MODELO_RAZONAMIENTO` de arriba, que ya no influye en nada.
const MODELO_RAZONAMIENTO_ELEGIDO = 'proveedor/fuerte-elegido'

// `model_catalog` es global y `conBaseDeDatosDePrueba` la vacía entre
// pruebas (el borrado en cascada por organización no la alcanza), así que
// cada archivo necesita su propia siembra. Un solo candidato de
// `razonamiento` alcanza: P1 no elige entre varios, solo necesita que la
// organización tenga UNA elección para no caer en el `permanente` de
// `modelosDelNivel`.
async function sembrarEleccionDeModelo(
  db: Parameters<Parameters<typeof conBaseDeDatosDePrueba>[0]>[0],
  organizationId: string,
) {
  const [modelo] = await db.insert(esquema.modelCatalog).values({
    level: 'razonamiento', modelId: MODELO_RAZONAMIENTO_ELEGIDO,
    label: 'Fuerte', description: 'El elegido para razonamiento en estas pruebas.',
    priceInputUsd: '5.0000', priceOutputUsd: '15.0000',
  }).returning()
  await db.insert(esquema.organizationModels).values({
    organizationId, level: 'razonamiento', principalId: modelo!.id, respaldoId: null,
  })
}

/**
 * `conEleccionDeModelo: false` deja la organización sin elegir el nivel de
 * razonamiento — es lo que necesita la prueba que confirma que P1 se niega,
 * sin llamar al modelo, antes de gastar por una organización sin elección.
 */
async function sembrar(
  db: Parameters<Parameters<typeof conBaseDeDatosDePrueba>[0]>[0],
  opciones: { conEleccionDeModelo?: boolean } = {},
) {
  const [org] = await db.insert(esquema.organizations).values({ name: 'X', slug: 'x' }).returning()
  const [marca] = await db
    .insert(esquema.brands)
    .values({ organizationId: org!.id, slug: 'parcelas', name: 'CTP' })
    .returning()
  const ref = { organizationId: org!.id, brandId: marca!.id }
  await guardarPerfil(db, ref, PERFIL_VALIDO)
  await sembrarEncargo(db, ref)
  if (opciones.conEleccionDeModelo !== false) {
    await sembrarEleccionDeModelo(db, ref.organizationId)
  }
  return ref
}

describe('flujo P1 · estrategia', () => {
  it('genera y persiste la estrategia fijando la versión del perfil', async () => {
    await conBaseDeDatosDePrueba(async (db) => {
      const ref = await sembrar(db)
      const cliente = new ClienteFalso([ESTRATEGIA_JSON])
      const flujo = crearFlujoEstrategia({ cliente, env: ENV })

      const r = await ejecutarFlujo(
        db, flujo, { brandId: ref.brandId, period: '2026-Q4' }, ref, SIN_ESPERA,
      )

      expect(r.estado).toBe('completado')
      const [fila] = await db.select().from(esquema.strategies)
      expect(fila!.period).toBe('2026-Q4')
      expect(fila!.status).toBe('borrador')
      expect(fila!.brandProfileVersion).toBe(1)
    })
  })

  it('envía el contexto de marca al modelo', async () => {
    await conBaseDeDatosDePrueba(async (db) => {
      const ref = await sembrar(db)
      const cliente = new ClienteFalso([ESTRATEGIA_JSON])
      const flujo = crearFlujoEstrategia({ cliente, env: ENV })

      await ejecutarFlujo(db, flujo, { brandId: ref.brandId, period: '2026-Q4' }, ref, SIN_ESPERA)

      const enviado = cliente.peticiones[0]!.mensajes.map((m) => m.texto).join('\n')
      expect(enviado).toContain('Pilares de contenido')
      expect(enviado).toContain('PROHIBIDO usar: Rentabilidad garantizada')
      expect(enviado).toContain('2026-Q4')
    })
  })

  it('registra el costo de la llamada', async () => {
    await conBaseDeDatosDePrueba(async (db) => {
      const ref = await sembrar(db)
      const flujo = crearFlujoEstrategia({ cliente: new ClienteFalso([ESTRATEGIA_JSON]), env: ENV })

      await ejecutarFlujo(db, flujo, { brandId: ref.brandId, period: '2026-Q4' }, ref, SIN_ESPERA)

      const llamadas = await db.select().from(esquema.aiCalls)
      expect(llamadas).toHaveLength(1)
      expect(llamadas[0]!.task).toBe('generar_estrategia')
      expect(llamadas[0]!.brandProfileVersion).toBe(1)
    })
  })

  it('se detiene si el presupuesto está agotado', async () => {
    await conBaseDeDatosDePrueba(async (db) => {
      const ref = await sembrar(db)
      await db.insert(esquema.aiCalls).values({
        organizationId: ref.organizationId, brandId: ref.brandId,
        task: 't', model: 'm', costUsd: '999.00', promptHash: 'h',
      })
      const flujo = crearFlujoEstrategia({ cliente: new ClienteFalso([ESTRATEGIA_JSON]), env: ENV })

      await expect(
        ejecutarFlujo(db, flujo, { brandId: ref.brandId, period: '2026-Q4' }, ref, SIN_ESPERA),
      ).rejects.toMatchObject({ clase: 'permanente' })
    })
  })

  it('nombra la marca por su slug al detenerse por presupuesto', async () => {
    await conBaseDeDatosDePrueba(async (db) => {
      const ref = await sembrar(db)
      await db.insert(esquema.aiCalls).values({
        organizationId: ref.organizationId, brandId: ref.brandId,
        task: 't', model: 'm', costUsd: '999.00', promptHash: 'h',
      })
      const flujo = crearFlujoEstrategia({ cliente: new ClienteFalso([ESTRATEGIA_JSON]), env: ENV })

      const error = await ejecutarFlujo(
        db, flujo, { brandId: ref.brandId, period: '2026-Q4' },
        { ...ref, brandSlug: 'parcelas' }, SIN_ESPERA,
      ).catch((e: unknown) => e)

      expect((error as Error).message).toContain('parcelas')
      expect((error as Error).message).not.toContain(ref.brandId)
    })
  })

  it('reejecutar el mismo periodo reemplaza la estrategia en borrador', async () => {
    await conBaseDeDatosDePrueba(async (db) => {
      const ref = await sembrar(db)
      const entrada = { brandId: ref.brandId, period: '2026-Q4' }

      for (const _ of [1, 2]) {
        const flujo = crearFlujoEstrategia({ cliente: new ClienteFalso([ESTRATEGIA_JSON]), env: ENV })
        await ejecutarFlujo(db, flujo, entrada, ref, SIN_ESPERA)
      }

      expect(await db.select().from(esquema.strategies)).toHaveLength(1)
    })
  })

  it('no pisa una estrategia ya aprobada', async () => {
    await conBaseDeDatosDePrueba(async (db) => {
      const ref = await sembrar(db)
      const entrada = { brandId: ref.brandId, period: '2026-Q4' }

      const flujo = crearFlujoEstrategia({ cliente: new ClienteFalso([ESTRATEGIA_JSON]), env: ENV })
      await ejecutarFlujo(db, flujo, entrada, ref, SIN_ESPERA)

      await db
        .update(esquema.strategies)
        .set({ status: 'aprobada', data: { marca: 'revisada a mano' } })
        .where(eq(esquema.strategies.brandId, ref.brandId))

      const otro = crearFlujoEstrategia({ cliente: new ClienteFalso([ESTRATEGIA_JSON]), env: ENV })
      await expect(
        ejecutarFlujo(db, otro, entrada, ref, SIN_ESPERA),
      ).rejects.toMatchObject({ clase: 'permanente' })

      const [fila] = await db.select().from(esquema.strategies)
      expect(fila!.status).toBe('aprobada')
      expect(fila!.data).toEqual({ marca: 'revisada a mano' })
    })
  })

  it('nombra el estado real y no gasta llamadas al reintentar sobre una aprobada', async () => {
    await conBaseDeDatosDePrueba(async (db) => {
      const ref = await sembrar(db)
      await db.insert(esquema.strategies).values({
        organizationId: ref.organizationId,
        brandId: ref.brandId,
        period: '2026-Q4',
        status: 'aprobada',
        data: { marca: 'revisada a mano' },
        brandProfileVersion: 1,
      })

      const cliente = new ClienteFalso([ESTRATEGIA_JSON])
      const flujo = crearFlujoEstrategia({ cliente, env: ENV })

      await expect(
        ejecutarFlujo(db, flujo, { brandId: ref.brandId, period: '2026-Q4' }, ref, SIN_ESPERA),
      ).rejects.toThrow(/"aprobada"/)

      // El estado ya condena la regeneración: ni una llamada al modelo.
      expect(cliente.peticiones).toHaveLength(0)
      expect(await db.select().from(esquema.aiCalls)).toHaveLength(0)
    })
  })

  it('nombra el estado archivada, que el upsert tampoco deja regenerar', async () => {
    await conBaseDeDatosDePrueba(async (db) => {
      const ref = await sembrar(db)
      await db.insert(esquema.strategies).values({
        organizationId: ref.organizationId,
        brandId: ref.brandId,
        period: '2026-Q4',
        status: 'archivada',
        data: { marca: 'vieja' },
        brandProfileVersion: 1,
      })

      const flujo = crearFlujoEstrategia({ cliente: new ClienteFalso([ESTRATEGIA_JSON]), env: ENV })
      await expect(
        ejecutarFlujo(db, flujo, { brandId: ref.brandId, period: '2026-Q4' }, ref, SIN_ESPERA),
      ).rejects.toThrow(/"archivada".*borrador/s)
    })
  })

  it('rechaza un periodo con formato inválido antes de gastar', async () => {
    await conBaseDeDatosDePrueba(async (db) => {
      const ref = await sembrar(db)
      const cliente = new ClienteFalso([ESTRATEGIA_JSON])
      const flujo = crearFlujoEstrategia({ cliente, env: ENV })

      await expect(
        ejecutarFlujo(db, flujo, { brandId: ref.brandId, period: '2026-3' }, ref, SIN_ESPERA),
      ).rejects.toMatchObject({ clase: 'permanente' })

      expect(cliente.peticiones).toHaveLength(0)
      expect(await db.select().from(esquema.aiCalls)).toHaveLength(0)
    })
  })

  it('manda el encargo del trimestre al modelo, aparte del contexto de marca', async () => {
    await conBaseDeDatosDePrueba(async (db) => {
      const ref = await sembrar(db)
      const cliente = new ClienteFalso([ESTRATEGIA_JSON])
      const flujo = crearFlujoEstrategia({ cliente, env: ENV })

      await ejecutarFlujo(
        db, flujo, { brandId: ref.brandId, period: '2026-Q4' }, ref, SIN_ESPERA,
      )

      // Se afirma sobre el mensaje del usuario, no sobre toda la conversación:
      // el instructivo del sistema también habla de canales y de capacidad, y
      // afirmar contra todo pasaría aunque el encargo no viajara.
      const mensajeUsuario = cliente.peticiones[0]!.mensajes.find((m) => m.rol === 'usuario')!.texto
      expect(mensajeUsuario).toContain('## El encargo del trimestre')
      expect(mensajeUsuario).toContain('Vender las doce parcelas que quedan del loteo norte')
      expect(mensajeUsuario).toContain('Formularios de contacto recibidos')
      expect(mensajeUsuario).toContain('4 publicaciones por semana')
      expect(mensajeUsuario).toContain('instagram')
      expect(mensajeUsuario).toContain('Los carruseles largos no los vio nadie')
    })
  })

  it('se niega, sin llamar al modelo, si el trimestre no tiene encargo', async () => {
    await conBaseDeDatosDePrueba(async (db) => {
      const ref = await sembrar(db)
      const cliente = new ClienteFalso([ESTRATEGIA_JSON])
      const flujo = crearFlujoEstrategia({ cliente, env: ENV })

      // `sembrar` escribió el encargo de 2026-Q4; este es otro trimestre.
      // `ejecutarFlujo` no devuelve un resultado con `estado: 'fallido'` para
      // un paso que lanza: relanza el error, como en el resto de las pruebas
      // de este archivo que verifican rechazo (p. ej. la de periodo inválido).
      await expect(
        ejecutarFlujo(db, flujo, { brandId: ref.brandId, period: '2026-Q1' }, ref, SIN_ESPERA),
      ).rejects.toMatchObject({ clase: 'permanente' })

      // Lo que importa no es que falle, sino que falle ANTES de pagar.
      expect(cliente.peticiones).toHaveLength(0)
    })
  })

  it('usa el modelo que la organización eligió, no uno fijo', async () => {
    await conBaseDeDatosDePrueba(async (db) => {
      const ref = await sembrar(db)
      const cliente = new ClienteFalso([ESTRATEGIA_JSON])
      const flujo = crearFlujoEstrategia({ cliente, env: ENV })

      await ejecutarFlujo(db, flujo, { brandId: ref.brandId, period: '2026-Q4' }, ref, SIN_ESPERA)

      // `modelos` viaja como arreglo (principal, y respaldo si difiere) a
      // `ClienteLlm.completar`; sin respaldo elegido, `modelosDelNivel`
      // devuelve el principal en los dos y `ejecutarTarea` lo deduplica a un
      // solo elemento. El identificador sembrado tiene que ser el que llegó,
      // no un modelo fijo escrito a mano en `p1.ts` ni el de `ENV`.
      expect(cliente.peticiones[0]!.modelos).toEqual([MODELO_RAZONAMIENTO_ELEGIDO])
    })
  })

  it('sin elección para razonamiento falla sin llamar al modelo', async () => {
    await conBaseDeDatosDePrueba(async (db) => {
      const ref = await sembrar(db, { conEleccionDeModelo: false })
      const cliente = new ClienteFalso([ESTRATEGIA_JSON])
      const flujo = crearFlujoEstrategia({ cliente, env: ENV })

      await expect(
        ejecutarFlujo(db, flujo, { brandId: ref.brandId, period: '2026-Q4' }, ref, SIN_ESPERA),
      ).rejects.toThrow(/\/configuracion/)

      // Lo que importa no es solo que falle, sino que falle ANTES de pagar:
      // resolver tiene que ocurrir antes de gastar, igual que la
      // comprobación del encargo y la de presupuesto.
      expect(cliente.peticiones).toHaveLength(0)
    })
  })

  it('reintentar tras un fallo al persistir no vuelve a llamar al modelo', async () => {
    await conBaseDeDatosDePrueba(async (db) => {
      const ref = await sembrar(db)
      const cliente = new ClienteFalso([ESTRATEGIA_JSON])
      const flujo = crearFlujoEstrategia({ cliente, env: ENV })

      // Una secuencia y no una tabla de bandera: el UPDATE de una tabla se
      // revertiría junto con la transacción cuyo fallo provoca, y el trigger
      // dispararía para siempre. `nextval` no es transaccional, así que sí
      // sobrevive al rollback y el reintento pasa.
      //
      // Se borra y se vuelve a crear en vez de reutilizarla: una secuencia
      // recién creada arranca en 1 y no hay que razonar sobre en qué valor
      // pudo dejarla una corrida anterior.
      await db.execute(sql`
        drop sequence if exists fallo_una_vez_seq;
        create sequence fallo_una_vez_seq;
        create or replace function romper_una_vez() returns trigger as $$
        begin
          if nextval('fallo_una_vez_seq') = 1 then
            raise exception 'conexión perdida' using errcode = '08006';
          end if;
          return new;
        end $$ language plpgsql;
        create trigger t_romper before insert on strategies
          for each row execute function romper_una_vez();
      `)

      try {
        const r = await ejecutarFlujo(
          db, flujo, { brandId: ref.brandId, period: '2026-Q4' }, ref,
          { dormir: async () => {}, aleatorio: () => 0 },
        )

        expect(r.estado).toBe('completado')
        expect(cliente.peticiones).toHaveLength(1)
        expect(await db.select().from(esquema.aiCalls)).toHaveLength(1)
      } finally {
        await db.execute(sql`
          drop trigger if exists t_romper on strategies;
          drop function if exists romper_una_vez();
          drop sequence if exists fallo_una_vez_seq;
        `)
      }
    })
  })
})
