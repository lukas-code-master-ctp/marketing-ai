import { conBaseDeDatosDePrueba } from '@gc/db/pruebas'
import { describe, expect, it } from 'vitest'
import { descartarSlot, grillaDelMes, verGrilla } from './grilla.js'
import { sembrarConGrilla } from './pruebas/siembra.js'

describe('verGrilla', () => {
  it('distingue los slots descartados de los vigentes', async () => {
    await conBaseDeDatosDePrueba(async (db) => {
      const ref = await sembrarConGrilla(db)
      const g = await grillaDelMes(db, ref.organizationId, 'parcelas', '2026-09')
      const descartado = g.slots.find((s) => !s.esDerivado)!
      await descartarSlot(db, ref.organizationId, descartado.id)

      // Dos lectores de la misma tabla en el mismo paquete: el de la web ya
      // excluía los descartados de su resumen por canal y este ni siquiera
      // seleccionaba la columna, así que `grilla:ver` los listaba como si
      // siguieran en pie. Evitar exactamente eso es para lo que existe
      // @gc/operaciones.
      const filas = await verGrilla(db, ref.organizationId, { slug: 'parcelas', mes: '2026-09' })

      expect(filas).toHaveLength(12)
      expect(filas.filter((f) => f.descartado)).toHaveLength(1)
      expect(filas.find((f) => f.descartado)!.angulo).toBe(descartado.angulo)
    })
  })
})
