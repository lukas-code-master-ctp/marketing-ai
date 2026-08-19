import { esquema } from '@gc/db'
import { conBaseDeDatosDePrueba } from '@gc/db/pruebas'
import { sembrarConEstrategia, sembrarConGrilla } from '@gc/operaciones/pruebas'
import { eq } from 'drizzle-orm'
import { afterEach, describe, expect, it, vi } from 'vitest'

// La sesión se sustituye porque lo que se prueba es la guarda, no Auth.js.
vi.mock('./auth.js', () => ({ sesionActual: vi.fn() }))
// `revalidatePath` solo existe dentro del ciclo de petición de Next.
vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }))

// `ejecutar` (en `acciones.ts`) no recibe la conexión de prueba: llama a
// `conexion()` (en `datos.ts`), que lee `DATABASE_URL` la primera vez que se
// invoca y cachea el pool en `globalThis`. Sin este ajuste apuntaría a
// `gestor` (la base de desarrollo) mientras `conBaseDeDatosDePrueba` siembra
// en `gestor_test`: toda escritura fallaría con "no existe el slot/plan",
// sin relación alguna con la sesión, y las cuatro pruebas medirían la base
// equivocada. Tiene que quedar fijado antes de la primera acción invocada.
process.env.DATABASE_URL = process.env.DATABASE_URL_TEST

const { sesionActual } = await import('./auth.js')
const { aprobarGrillaAccion, descartarSlotAccion, guardarPerfilAction, guardarModeloAccion } =
  await import('./acciones.js')

afterEach(() => vi.mocked(sesionActual).mockReset())

describe('las Server Actions exigen sesión', () => {
  it('sin sesión, aprobar NO escribe en la base', async () => {
    await conBaseDeDatosDePrueba(async (db) => {
      await sembrarConGrilla(db)
      const [plan] = await db.select().from(esquema.contentPlans)
      vi.mocked(sesionActual).mockResolvedValue(null)

      const r = await aprobarGrillaAccion('parcelas', '2026-09', plan!.id)

      expect(r.ok).toBe(false)
      // Sin esto, un `TypeError` accidental por invocar `fn` con `sesion.id`
      // sobre `null` (por ejemplo si se borra la guarda) también deja
      // `r.ok === false` y la fila sin cambiar: la prueba pasaría igual
      // aunque la guarda hubiera desaparecido. El motivo del rechazo es lo
      // que distingue "la guarda funcionó" de "el código se cayó antes".
      if (r.ok) throw new Error('inalcanzable')
      expect(r.mensaje).toMatch(/sesión/i)

      // Lo que importa: la fila no cambió. Una acción que responde "no" pero
      // escribe igual es peor que una que falla.
      const [despues] = await db
        .select({ status: esquema.contentPlans.status })
        .from(esquema.contentPlans)
        .where(eq(esquema.contentPlans.id, plan!.id))
      expect(despues!.status).toBe('borrador')
    })
  })

  it('sin sesión, descartar un slot NO escribe en la base', async () => {
    await conBaseDeDatosDePrueba(async (db) => {
      await sembrarConGrilla(db)
      const [slot] = await db.select().from(esquema.planSlots)
      vi.mocked(sesionActual).mockResolvedValue(null)

      const r = await descartarSlotAccion('parcelas', '2026-09', slot!.id)

      expect(r.ok).toBe(false)
      // Misma razón que en la prueba de aprobar: sin esta aserción, un
      // `TypeError` accidental antes de invocar `fn` deja la prueba en verde
      // aunque la guarda ya no exista.
      if (r.ok) throw new Error('inalcanzable')
      expect(r.mensaje).toMatch(/sesión/i)

      const [despues] = await db
        .select({ status: esquema.planSlots.status })
        .from(esquema.planSlots)
        .where(eq(esquema.planSlots.id, slot!.id))
      expect(despues!.status).toBe('planificado')
    })
  })

  it('con sesión, la acción sí escribe', async () => {
    // Sin esta mitad, una guarda que rechazara SIEMPRE también pasaría.
    await conBaseDeDatosDePrueba(async (db) => {
      await sembrarConGrilla(db)
      const [slot] = await db.select().from(esquema.planSlots)
      const [persona] = await db
        .insert(esquema.users)
        .values({ email: 'lukas@ejemplo.cl', name: 'Lukas' })
        .returning({ id: esquema.users.id })
      vi.mocked(sesionActual).mockResolvedValue({ id: persona!.id, email: 'lukas@ejemplo.cl' })

      const r = await descartarSlotAccion('parcelas', '2026-09', slot!.id)

      expect(r.ok).toBe(true)
      const [despues] = await db
        .select({ status: esquema.planSlots.status })
        .from(esquema.planSlots)
        .where(eq(esquema.planSlots.id, slot!.id))
      expect(despues!.status).toBe('descartado')
    })
  })

  it('el mensaje de rechazo le dice a la persona qué hacer', async () => {
    await conBaseDeDatosDePrueba(async (db) => {
      await sembrarConGrilla(db)
      const [slot] = await db.select().from(esquema.planSlots)
      vi.mocked(sesionActual).mockResolvedValue(null)

      const r = await descartarSlotAccion('parcelas', '2026-09', slot!.id)

      expect(r.ok).toBe(false)
      if (r.ok) throw new Error('inalcanzable')
      expect(r.mensaje).toMatch(/sesión/i)
      expect(r.reintentable).toBe(false)
    })
  })

  // Menor F de la revisión de rama: `sesionActual()` se movió dentro del
  // `try` de `ejecutar` para que una excepción suya (en desarrollo,
  // `registrarPersona` puede lanzar si la base está caída) se traduzca a
  // `{ ok: false, mensaje }` como cualquier otra falla, en vez de propagarse
  // sin capturar. Antes de este cambio esta prueba no podía escribirse: la
  // excepción salía de `aprobarGrillaAccion` en vez de resolver.
  it('si sesionActual() lanza, la acción responde en vez de propagar la excepción', async () => {
    await conBaseDeDatosDePrueba(async (db) => {
      await sembrarConGrilla(db)
      const [plan] = await db.select().from(esquema.contentPlans)
      vi.mocked(sesionActual).mockRejectedValue(new Error('la base no responde'))

      const r = await aprobarGrillaAccion('parcelas', '2026-09', plan!.id)

      expect(r.ok).toBe(false)
      if (r.ok) throw new Error('inalcanzable')
      expect(r.mensaje).toBe('la base no responde')
      expect(r.reintentable).toBe(false)

      const [despues] = await db
        .select({ status: esquema.contentPlans.status })
        .from(esquema.contentPlans)
        .where(eq(esquema.contentPlans.id, plan!.id))
      expect(despues!.status).toBe('borrador')
    })
  })
})

describe('las Server Actions pasan el id de la sesión al dominio', () => {
  // `ejecutar` le pasa `usuarioId` a `fn`, y `aprobarGrillaAccion`,
  // `reabrirGrillaAccion` y `guardarPerfilAction` lo reenvían como tercer
  // argumento a la operación de dominio. Sin esta prueba nada se pone rojo si
  // alguien quita ese argumento: las pruebas de "exige sesión" de más arriba
  // solo comprueban que la sesión exista, no que su id llegue hasta la
  // columna de autoría. Este es el único tramo end-to-end —desde la sesión
  // simulada hasta la fila en la base— de lo que esta rama entrega.
  it('aprobar deja approved_by con el id de la sesión activa', async () => {
    await conBaseDeDatosDePrueba(async (db) => {
      await sembrarConGrilla(db)
      const [plan] = await db.select().from(esquema.contentPlans)
      const [persona] = await db
        .insert(esquema.users)
        .values({ email: 'lukas@ejemplo.cl', name: 'Lukas' })
        .returning({ id: esquema.users.id })
      vi.mocked(sesionActual).mockResolvedValue({ id: persona!.id, email: 'lukas@ejemplo.cl' })

      const r = await aprobarGrillaAccion('parcelas', '2026-09', plan!.id)

      expect(r.ok).toBe(true)
      const [despues] = await db
        .select({ approvedBy: esquema.contentPlans.approvedBy })
        .from(esquema.contentPlans)
        .where(eq(esquema.contentPlans.id, plan!.id))
      expect(despues!.approvedBy).toBe(persona!.id)
    })
  })

  // Hallazgo Importante 4 de la revisión de rama: `guardarModeloAccion`
  // declaraba `async (db, organizationId) => …` y descartaba el tercer
  // argumento que `ejecutar` le pasa, así que `organization_models.updated_by`
  // nunca se llenaba pese a que `guardarEleccionDeModelo` sabe escribirla y la
  // migración crea la foránea a `users`. Confirmado en la base con las dos
  // filas de la organización real: las dos tenían `updated_by` nulo.
  it('guardar el modelo deja updated_by con el id de la sesión activa', async () => {
    await conBaseDeDatosDePrueba(async (db) => {
      await sembrarConEstrategia(db)
      const [persona] = await db
        .insert(esquema.users)
        .values({ email: 'lukas@ejemplo.cl', name: 'Lukas' })
        .returning({ id: esquema.users.id })
      vi.mocked(sesionActual).mockResolvedValue({ id: persona!.id, email: 'lukas@ejemplo.cl' })

      const [modelo] = await db.insert(esquema.modelCatalog).values({
        level: 'redaccion', modelId: 'proveedor/redactor',
        label: 'Redactor', description: 'El elegido para redacción en esta prueba.',
        priceInputUsd: '1.0000', priceOutputUsd: '3.0000',
      }).returning()

      const r = await guardarModeloAccion('redaccion', modelo!.id, null)

      expect(r.ok).toBe(true)
      const [fila] = await db
        .select({ updatedBy: esquema.organizationModels.updatedBy })
        .from(esquema.organizationModels)
        .where(eq(esquema.organizationModels.level, 'redaccion'))
      expect(fila!.updatedBy).toBe(persona!.id)
    })
  })
})

describe('guardarPerfilAction parsea el JSON dentro de la guarda de sesión', () => {
  it('sin sesión, un JSON inválido rechaza por falta de sesión y no por el JSON', async () => {
    // Si el parseo ocurriera antes de la guarda (como antes de este cambio),
    // esto respondería "El texto no es JSON válido" sin que importara la
    // sesión: un llamador anónimo tendría un oráculo gratis para saber si su
    // texto es JSON válido, además de CPU gratis sobre entrada arbitraria.
    await conBaseDeDatosDePrueba(async (db) => {
      await sembrarConEstrategia(db)
      vi.mocked(sesionActual).mockResolvedValue(null)

      const r = await guardarPerfilAction('parcelas', '{ esto no es JSON')

      expect(r.ok).toBe(false)
      if (r.ok) throw new Error('inalcanzable')
      expect(r.mensaje).toMatch(/sesión/i)
      expect(r.mensaje).not.toMatch(/JSON/i)
    })
  })

  it('con sesión, un JSON inválido sigue mostrando el mensaje del dominio', async () => {
    // El parseo se movió de lugar (hallazgo B de la revisión), pero el
    // mensaje que ve la persona con sesión activa y JSON malformado no tiene
    // que cambiar: `EditorDePerfil` ya depende de este texto exacto.
    await conBaseDeDatosDePrueba(async (db) => {
      await sembrarConEstrategia(db)
      const [persona] = await db
        .insert(esquema.users)
        .values({ email: 'lukas@ejemplo.cl', name: 'Lukas' })
        .returning({ id: esquema.users.id })
      vi.mocked(sesionActual).mockResolvedValue({ id: persona!.id, email: 'lukas@ejemplo.cl' })

      const r = await guardarPerfilAction('parcelas', '{ esto no es JSON')

      expect(r.ok).toBe(false)
      if (r.ok) throw new Error('inalcanzable')
      expect(r.mensaje).toMatch(/^El texto no es JSON válido: /)
      expect(r.reintentable).toBe(false)
    })
  })
})
