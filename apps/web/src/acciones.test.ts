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
const { aprobarGrillaAccion, descartarSlotAccion, guardarPerfilAction } = await import(
  './acciones.js'
)

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
