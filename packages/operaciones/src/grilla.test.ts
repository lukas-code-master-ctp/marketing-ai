import { esquema } from '@gc/db'
import { conBaseDeDatosDePrueba } from '@gc/db/pruebas'
import { eq } from 'drizzle-orm'
import { describe, expect, it } from 'vitest'
import { grillaDelMes } from './grilla.js'
import { sembrarConEstrategia, sembrarConGrilla } from './pruebas/siembra.js'

describe('grillaDelMes', () => {
  it('devuelve el mes vacío cuando no hay plan', async () => {
    await conBaseDeDatosDePrueba(async (db) => {
      const ref = await sembrarConEstrategia(db)
      const g = await grillaDelMes(db, ref.organizationId, 'parcelas', '2026-10')

      expect(g.contentPlanId).toBeNull()
      expect(g.estado).toBeNull()
      expect(g.slots).toEqual([])
      expect(g.avisos).toEqual([])
    })
  })

  it('marca los derivados y su padre', async () => {
    await conBaseDeDatosDePrueba(async (db) => {
      const ref = await sembrarConGrilla(db)
      const g = await grillaDelMes(db, ref.organizationId, 'parcelas', '2026-09')

      expect(g.slots).toHaveLength(12)

      const derivados = g.slots.filter((s) => s.esDerivado)
      expect(derivados).toHaveLength(8)
      for (const d of derivados) {
        const padre = g.slots.find((s) => s.id === d.idDelPadre)
        expect(padre).toBeDefined()
        expect(padre!.esDerivado).toBe(false)
      }
    })
  })

  it('no cuenta los descartados en el resumen por canal', async () => {
    await conBaseDeDatosDePrueba(async (db) => {
      const ref = await sembrarConGrilla(db)
      const antes = await grillaDelMes(db, ref.organizationId, 'parcelas', '2026-09')
      const unBlog = antes.slots.find((s) => s.canal === 'blog')!

      await db
        .update(esquema.planSlots)
        .set({ status: 'descartado' })
        .where(eq(esquema.planSlots.id, unBlog.id))

      const despues = await grillaDelMes(db, ref.organizationId, 'parcelas', '2026-09')

      // Sigue apareciendo, marcado, pero deja de contar.
      expect(despues.slots).toHaveLength(12)
      expect(despues.slots.find((s) => s.id === unBlog.id)!.descartado).toBe(true)
      expect(despues.porCanal['blog']).toBe(antes.porCanal['blog']! - 1)
    })
  })

  it('recalcula los avisos sobre los slots vigentes, no sobre los originales', async () => {
    await conBaseDeDatosDePrueba(async (db) => {
      const ref = await sembrarConGrilla(db)
      const antes = await grillaDelMes(db, ref.organizationId, 'parcelas', '2026-09')

      // Descartar todos los de un canal cambia su cadencia.
      await db
        .update(esquema.planSlots)
        .set({ status: 'descartado' })
        .where(eq(esquema.planSlots.channel, 'blog'))

      const despues = await grillaDelMes(db, ref.organizationId, 'parcelas', '2026-09')

      const cadenciaBlogAntes = antes.avisos.filter(
        (a) => a.regla === 'cadencia' && a.detalle.includes('blog'),
      )
      const cadenciaBlogDespues = despues.avisos.filter(
        (a) => a.regla === 'cadencia' && a.detalle.includes('blog'),
      )
      expect(cadenciaBlogDespues.length).toBeGreaterThan(cadenciaBlogAntes.length)
    })
  })
})
