import { ClienteFalso } from '@gc/ai'
import { PERFIL_VALIDO, guardarPerfil } from '@gc/brand'
import { CANALES, esquema } from '@gc/db'
import { conBaseDeDatosDePrueba } from '@gc/db/pruebas'
import { ejecutarFlujo } from '@gc/pipeline'
import { sql } from 'drizzle-orm'
import { readFile } from 'node:fs/promises'
import { randomUUID } from 'node:crypto'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { crearFlujoPieza } from './p3.js'

const ENV = { MODELO_REDACCION: 'proveedor/redactor' }
const SIN_ESPERA = { dormir: async () => {}, aleatorio: () => 0 }

const ESTRATEGIA = {
  objetivos: [{ nombre: 'Autoridad', metrica: 'alcance', meta: '+30% trimestral' }],
  mensajesClave: ['La factibilidad se verifica antes de comprar', 'Trazabilidad legal completa'],
  mixDeCanales: [
    { canal: 'blog', publicacionesPorSemana: 1 },
    { canal: 'linkedin', publicacionesPorSemana: 2 },
  ],
  reciclaje: [{ desde: 'blog', hacia: ['linkedin'], diasDespues: 2 }],
  temasPrioritarios: ['Factibilidad de agua', 'Regularización de roles'],
}

// Deliberadamente larguísimo y específico: la advertencia del brief pide
// afirmar sobre el texto del ángulo sembrado, no sobre un fragmento corto que
// pudiera calzar por accidente con otra parte del mensaje (como pasó con '4'
// y '2026-Q4').
const ANGULO =
  'El certificado de factibilidad de la Dirección General de Aguas es el primer documento ' +
  'que hay que exigir antes de firmar cualquier promesa de compraventa de una parcela.'
const BRIEF =
  'Explica en tono didáctico, sin tecnicismos legales, por qué ese certificado es la única ' +
  'prueba real de que el terreno tiene acceso a agua y qué pasa si el vendedor no lo tiene.'

const PIEZA_LINKEDIN_JSON = JSON.stringify({
  gancho: 'La factibilidad de agua no se negocia: se certifica.',
  cuerpo:
    'Antes de firmar cualquier promesa de compraventa, pide el certificado de factibilidad ' +
    'de la DGA. Es el único documento que prueba que la parcela tiene acceso real a agua.',
  hashtags: ['#factibilidad', '#parcelas', '#trazabilidad'],
})

// Deliberadamente distinta de `PIEZA_LINKEDIN_JSON` en los tres campos —no
// solo el texto, también el arreglo de hashtags—: la prueba de regeneración
// necesita una segunda corrida cuyo resultado sea inconfundible del primero,
// para poder afirmar que la fila se reemplazó y no solo que sigue habiendo
// una sola.
const PIEZA_LINKEDIN_JSON_V2 = JSON.stringify({
  gancho: 'El certificado de factibilidad no es un trámite: es la prueba.',
  cuerpo:
    'Regenerado: sin el certificado de factibilidad de la DGA no hay forma de comprobar que ' +
    'la parcela tiene agua. Exígelo antes de firmar cualquier promesa de compraventa.',
  hashtags: ['#dga', '#agua'],
})

const PIEZA_BLOG_JSON = JSON.stringify({
  titulo: 'El documento que debes exigir antes de comprar una parcela',
  bajada: 'Sin el certificado de factibilidad de la DGA, ninguna promesa de compraventa es segura.',
  cuerpo:
    '## Qué es el certificado de factibilidad\n\nLo emite la Dirección General de Aguas y ' +
    'confirma que el terreno tiene acceso real a agua.\n\n## Por qué pedirlo antes de firmar\n\n' +
    'Sin él, no hay forma de comprobar que el proyecto es viable.',
})

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

/**
 * Una segunda marca de la misma organización, con su propio perfil y su
 * propia estrategia vigente — igual que la organización `principal` real,
 * que tiene `parcelas` y `tapcar`. Con perfil y estrategia propios, y no
 * ausentes: si le faltaran, un `input` con el `brandId` de esta marca fallaría
 * igual con el `brandId` sin revalidar en `cargarSlot` —porque no habría
 * perfil vigente que cargar— y la prueba que usa esto pasaría por la razón
 * equivocada, sin ejercitar la revalidación que dice cubrir.
 */
async function sembrarOtraMarca(
  db: Parameters<Parameters<typeof conBaseDeDatosDePrueba>[0]>[0],
  organizationId: string,
) {
  const [marca] = await db
    .insert(esquema.brands)
    .values({ organizationId, slug: 'tapcar', name: 'TapCar' })
    .returning()
  const ref = { organizationId, brandId: marca!.id }
  await guardarPerfil(db, ref, PERFIL_VALIDO)
  await db.insert(esquema.strategies).values({
    organizationId,
    brandId: ref.brandId,
    period: '2026-Q3',
    data: ESTRATEGIA,
    brandProfileVersion: 1,
  })
  return ref
}

async function sembrarSlot(
  db: Parameters<Parameters<typeof conBaseDeDatosDePrueba>[0]>[0],
  ref: { organizationId: string; brandId: string },
  overrides: {
    channel?: 'linkedin' | 'blog'
    planId?: string
    status?: 'planificado' | 'descartado'
  } = {},
) {
  // `(brand_id, month)` es único en content_plans: si ya se conoce el plan
  // del mes (dos slots del mismo mes, como en la prueba del instructivo por
  // canal) se reutiliza en vez de volver a insertarlo.
  const planId =
    overrides.planId ??
    (
      await db
        .insert(esquema.contentPlans)
        .values({
          organizationId: ref.organizationId,
          brandId: ref.brandId,
          month: '2026-09-01',
          status: 'aprobada',
        })
        .returning()
    )[0]!.id

  const [slot] = await db
    .insert(esquema.planSlots)
    .values({
      organizationId: ref.organizationId,
      contentPlanId: planId,
      scheduledFor: new Date('2026-09-03T13:00:00Z'),
      channel: overrides.channel ?? 'linkedin',
      format: overrides.channel === 'blog' ? 'articulo' : 'post',
      pillar: 'educacion',
      angle: ANGULO,
      brief: BRIEF,
      status: overrides.status ?? 'planificado',
    })
    .returning()

  return { slotId: slot!.id, planId }
}

describe('flujo P3 · pieza', () => {
  it('genera y persiste la pieza del slot', async () => {
    await conBaseDeDatosDePrueba(async (db) => {
      const ref = await sembrar(db)
      const { slotId } = await sembrarSlot(db, ref, { channel: 'linkedin' })
      const cliente = new ClienteFalso([PIEZA_LINKEDIN_JSON])
      const flujo = crearFlujoPieza({ cliente, env: ENV })

      const r = await ejecutarFlujo(
        db, flujo, { slotId, mes: '2026-09', brandId: ref.brandId }, ref, SIN_ESPERA,
      )

      expect(r.estado).toBe('completado')
      const [fila] = await db.select().from(esquema.contentPieces)
      expect(fila).toBeDefined()
      expect(fila!.planSlotId).toBe(slotId)
      expect(fila!.channel).toBe('linkedin')
    })
  })

  it('manda al modelo el contexto de marca, la estrategia y el ángulo y el brief del slot', async () => {
    await conBaseDeDatosDePrueba(async (db) => {
      const ref = await sembrar(db)
      const { slotId } = await sembrarSlot(db, ref, { channel: 'linkedin' })
      const cliente = new ClienteFalso([PIEZA_LINKEDIN_JSON])
      const flujo = crearFlujoPieza({ cliente, env: ENV })

      await ejecutarFlujo(db, flujo, { slotId, mes: '2026-09', brandId: ref.brandId }, ref, SIN_ESPERA)

      const mensajeUsuario = cliente.peticiones[0]!.mensajes.find((m) => m.rol === 'usuario')!.texto
      expect(mensajeUsuario).toContain('Pilares de contenido')
      expect(mensajeUsuario).toContain('PROHIBIDO usar: Rentabilidad garantizada')
      expect(mensajeUsuario).toContain('Factibilidad de agua')
      expect(mensajeUsuario).toContain(ANGULO)
      expect(mensajeUsuario).toContain(BRIEF)
    })
  })

  it('usa el instructivo del canal del slot', async () => {
    await conBaseDeDatosDePrueba(async (db) => {
      const ref = await sembrar(db)

      const { slotId: slotBlog, planId } = await sembrarSlot(db, ref, { channel: 'blog' })
      const clienteBlog = new ClienteFalso([PIEZA_BLOG_JSON])
      const flujoBlog = crearFlujoPieza({ cliente: clienteBlog, env: ENV })
      await ejecutarFlujo(
        db, flujoBlog, { slotId: slotBlog, mes: '2026-09', brandId: ref.brandId }, ref, SIN_ESPERA,
      )

      const { slotId: slotLinkedin } = await sembrarSlot(db, ref, { channel: 'linkedin', planId })
      const clienteLinkedin = new ClienteFalso([PIEZA_LINKEDIN_JSON])
      const flujoLinkedin = crearFlujoPieza({ cliente: clienteLinkedin, env: ENV })
      await ejecutarFlujo(
        db, flujoLinkedin, { slotId: slotLinkedin, mes: '2026-09', brandId: ref.brandId }, ref, SIN_ESPERA,
      )

      const sistemaBlog = clienteBlog.peticiones[0]!.mensajes.find((m) => m.rol === 'sistema')!.texto
      const sistemaLinkedin =
        clienteLinkedin.peticiones[0]!.mensajes.find((m) => m.rol === 'sistema')!.texto

      // No basta con que difieran: dos instructivos podrían diferir en una
      // sola coma y esta prueba seguiría verde. Se ata cada uno a una regla
      // que solo tiene sentido en su propio canal —el `gancho` no existe en
      // el esquema del blog, el Markdown con `##` no existe en el de
      // LinkedIn— para confirmar que cada corrida usó el instructivo que le
      // corresponde y no el del otro canal por accidente.
      expect(sistemaBlog).toContain('redactor de contenido para el blog')
      expect(sistemaBlog).toContain('con subtítulos que organicen el artículo')
      expect(sistemaBlog).not.toContain('gancho')

      expect(sistemaLinkedin).toContain('redactor de contenido para LinkedIn')
      expect(sistemaLinkedin).toContain('gancho')
      expect(sistemaLinkedin).not.toContain('Markdown')
    })
  })

  it('un fallo al persistir no vuelve a llamar al modelo', async () => {
    await conBaseDeDatosDePrueba(async (db) => {
      const ref = await sembrar(db)
      const { slotId } = await sembrarSlot(db, ref, { channel: 'linkedin' })
      const cliente = new ClienteFalso([PIEZA_LINKEDIN_JSON])
      const flujo = crearFlujoPieza({ cliente, env: ENV })

      // Igual que en p1.test.ts/p2.test.ts: un trigger que revienta el primer
      // INSERT en content_pieces con un código transitorio, y se desactiva solo
      // para que el reintento pase. El contador vive en una secuencia y no en
      // una tabla porque `nextval` no es transaccional y sí sobrevive al
      // rollback que el propio fallo provoca.
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
        create trigger t_romper before insert on content_pieces
          for each row execute function romper_una_vez();
      `)

      try {
        const r = await ejecutarFlujo(
          db, flujo, { slotId, mes: '2026-09', brandId: ref.brandId }, ref,
          { dormir: async () => {}, aleatorio: () => 0 },
        )

        expect(r.estado).toBe('completado')
        expect(cliente.peticiones).toHaveLength(1)
        expect(await db.select().from(esquema.contentPieces)).toHaveLength(1)
      } finally {
        await db.execute(sql`
          drop trigger if exists t_romper on content_pieces;
          drop function if exists romper_una_vez();
          drop sequence if exists fallo_una_vez_seq;
        `)
      }
    })
  })

  it('regenerar reemplaza la pieza en vez de duplicarla', async () => {
    await conBaseDeDatosDePrueba(async (db) => {
      const ref = await sembrar(db)
      const { slotId } = await sembrarSlot(db, ref, { channel: 'linkedin' })
      const entrada = { slotId, mes: '2026-09', brandId: ref.brandId }

      const flujo1 = crearFlujoPieza({ cliente: new ClienteFalso([PIEZA_LINKEDIN_JSON]), env: ENV })
      await ejecutarFlujo(db, flujo1, entrada, ref, SIN_ESPERA)

      // Una segunda versión del perfil, para que la segunda corrida resuelva
      // un `brandProfileVersion` distinto de la primera: sin este cambio,
      // `channel` y `brandProfileVersion` valdrían lo mismo en las dos
      // corridas, y una aserción sobre ellos no distinguiría un `set` que sí
      // actualiza de uno que no hace nada.
      await guardarPerfil(db, ref, PERFIL_VALIDO)

      // `PIEZA_LINKEDIN_JSON_V2` es deliberadamente distinto del primero: con
      // `onConflictDoNothing` —o un `set: {}`— seguiría habiendo una sola
      // fila, pero con el contenido del primer intento. `toHaveLength(1)`
      // sola no distingue "reemplaza" de "ignora la segunda"; lo que sigue,
      // sobre `fila.data`, `fila.channel` y `fila.brandProfileVersion`, sí.
      const flujo2 = crearFlujoPieza({ cliente: new ClienteFalso([PIEZA_LINKEDIN_JSON_V2]), env: ENV })
      await ejecutarFlujo(db, flujo2, entrada, ref, SIN_ESPERA)

      const filas = await db.select().from(esquema.contentPieces)
      expect(filas).toHaveLength(1)

      const [fila] = filas
      expect(fila!.channel).toBe('linkedin')
      expect(fila!.brandProfileVersion).toBe(2)
      expect(fila!.data).toEqual({ canal: 'linkedin', ...JSON.parse(PIEZA_LINKEDIN_JSON_V2) })
    })
  })

  it('se niega, sin llamar al modelo, si el slot no existe', async () => {
    await conBaseDeDatosDePrueba(async (db) => {
      const ref = await sembrar(db)
      const cliente = new ClienteFalso([PIEZA_LINKEDIN_JSON])
      const flujo = crearFlujoPieza({ cliente, env: ENV })

      await expect(
        ejecutarFlujo(
          db, flujo, { slotId: randomUUID(), mes: '2026-09', brandId: ref.brandId }, ref, SIN_ESPERA,
        ),
      ).rejects.toMatchObject({ clase: 'permanente' })

      expect(cliente.peticiones).toHaveLength(0)
    })
  })

  // Los tres casos que siguen son la revalidación que `cargarSlot` hace
  // dentro de la misma consulta: lo mismo que `slotsVigentesDelMes`
  // (`@gc/operaciones`) ya filtra al armar los candidatos que `encolarPiezas`
  // encola, pero que `id` + `organization_id` no vuelven a comprobar entre
  // que la corrida se encola y el worker la ejecuta, minutos después.

  it('se niega, sin llamar al modelo, si el slot está descartado', async () => {
    await conBaseDeDatosDePrueba(async (db) => {
      const ref = await sembrar(db)
      // Alcanzable hoy: descartar un slot es una acción de la web, y puede
      // pasar con la corrida ya `pendiente` en la cola.
      const { slotId } = await sembrarSlot(db, ref, { channel: 'linkedin', status: 'descartado' })
      const cliente = new ClienteFalso([PIEZA_LINKEDIN_JSON])
      const flujo = crearFlujoPieza({ cliente, env: ENV })

      await expect(
        ejecutarFlujo(
          db, flujo, { slotId, mes: '2026-09', brandId: ref.brandId }, ref, SIN_ESPERA,
        ),
      ).rejects.toMatchObject({ clase: 'permanente' })

      expect(cliente.peticiones).toHaveLength(0)
    })
  })

  it('se niega, sin llamar al modelo, si el slot pertenece a otra marca', async () => {
    await conBaseDeDatosDePrueba(async (db) => {
      const ref = await sembrar(db)
      const { slotId } = await sembrarSlot(db, ref, { channel: 'linkedin' })

      // Con perfil y estrategia propios: la organización `principal` real
      // tiene dos marcas, `parcelas` y `tapcar`, así que un `input` con el
      // `brandId` de la otra no es hipotético. Si esta marca no tuviera
      // perfil ni estrategia, la corrida fallaría igual sin pasar por la
      // revalidación de `cargarSlot` —fallaría antes, al cargar el perfil—,
      // así que esta prueba no probaría lo que dice probar.
      const refOtraMarca = await sembrarOtraMarca(db, ref.organizationId)

      const cliente = new ClienteFalso([PIEZA_LINKEDIN_JSON])
      const flujo = crearFlujoPieza({ cliente, env: ENV })

      await expect(
        ejecutarFlujo(
          db, flujo, { slotId, mes: '2026-09', brandId: refOtraMarca.brandId }, refOtraMarca,
          SIN_ESPERA,
        ),
      ).rejects.toMatchObject({ clase: 'permanente' })

      expect(cliente.peticiones).toHaveLength(0)
    })
  })

  it('se niega, sin llamar al modelo, si el mes no coincide con el del plan del slot', async () => {
    await conBaseDeDatosDePrueba(async (db) => {
      const ref = await sembrar(db)
      // `sembrarSlot` cuelga el slot de un plan de `2026-09`.
      const { slotId } = await sembrarSlot(db, ref, { channel: 'linkedin' })
      const cliente = new ClienteFalso([PIEZA_LINKEDIN_JSON])
      const flujo = crearFlujoPieza({ cliente, env: ENV })

      // `2026-08` y no `2026-10`: los dos son un mes distinto del `2026-09`
      // del plan, pero `2026-08` cae en el mismo trimestre —`2026-Q3`— que sí
      // tiene estrategia sembrada. Con un mes de otro trimestre, sin la
      // revalidación esta corrida fallaría igual, solo que por «no hay
      // estrategia vigente» en vez de por el mes desalineado, y la prueba
      // pasaría por la razón equivocada.
      await expect(
        ejecutarFlujo(
          db, flujo, { slotId, mes: '2026-08', brandId: ref.brandId }, ref, SIN_ESPERA,
        ),
      ).rejects.toMatchObject({ clase: 'permanente' })

      expect(cliente.peticiones).toHaveLength(0)
    })
  })

  it('el título de sección que arma el mensaje coincide con el que nombran los cinco instructivos', async () => {
    const TITULO = 'El slot a escribir'

    await conBaseDeDatosDePrueba(async (db) => {
      const ref = await sembrar(db)
      const { slotId } = await sembrarSlot(db, ref, { channel: 'linkedin' })
      const cliente = new ClienteFalso([PIEZA_LINKEDIN_JSON])
      const flujo = crearFlujoPieza({ cliente, env: ENV })
      await ejecutarFlujo(db, flujo, { slotId, mes: '2026-09', brandId: ref.brandId }, ref, SIN_ESPERA)

      const mensajeUsuario = cliente.peticiones[0]!.mensajes.find((m) => m.rol === 'usuario')!.texto
      expect(mensajeUsuario).toContain(`## ${TITULO}`)
    })

    // El mismo defecto ya se materializó una vez en P1: el título que arma
    // el mensaje y el que nombran los instructivos se desalinearon sin que
    // nada avisara. Acá se comprueba contra los cinco `.md`, no solo contra
    // el de LinkedIn que ya corrió arriba.
    for (const canal of CANALES) {
      const ruta = fileURLToPath(new URL(`./prompts/pieza-${canal}.md`, import.meta.url))
      const contenido = await readFile(ruta, 'utf8')
      expect(contenido).toContain(TITULO)
    }
  })
})
