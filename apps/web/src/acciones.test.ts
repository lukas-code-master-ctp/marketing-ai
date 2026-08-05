import { esquema } from '@gc/db'
import { conBaseDeDatosDePrueba } from '@gc/db/pruebas'
import { sembrarConGrilla } from '@gc/operaciones/pruebas'
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
const { aprobarGrillaAccion, descartarSlotAccion } = await import('./acciones.js')

afterEach(() => vi.mocked(sesionActual).mockReset())

describe('las Server Actions exigen sesión', () => {
  it('sin sesión, aprobar NO escribe en la base', async () => {
    await conBaseDeDatosDePrueba(async (db) => {
      const ref = await sembrarConGrilla(db)
      const [plan] = await db.select().from(esquema.contentPlans)
      vi.mocked(sesionActual).mockResolvedValue(null)

      const r = await aprobarGrillaAccion('parcelas', '2026-09', plan!.id)

      expect(r.ok).toBe(false)

      // Lo que importa: la fila no cambió. Una acción que responde "no" pero
      // escribe igual es peor que una que falla.
      const [despues] = await db
        .select({ status: esquema.contentPlans.status })
        .from(esquema.contentPlans)
        .where(eq(esquema.contentPlans.id, plan!.id))
      expect(despues!.status).toBe('borrador')
      void ref
    })
  })

  it('sin sesión, descartar un slot NO escribe en la base', async () => {
    await conBaseDeDatosDePrueba(async (db) => {
      await sembrarConGrilla(db)
      const [slot] = await db.select().from(esquema.planSlots)
      vi.mocked(sesionActual).mockResolvedValue(null)

      const r = await descartarSlotAccion('parcelas', '2026-09', slot!.id)

      expect(r.ok).toBe(false)
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
