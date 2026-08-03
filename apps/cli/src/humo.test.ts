import { ClienteDeMuestra } from '@gc/ai'
import { PERFIL_VALIDO } from '@gc/brand'
import { esquema } from '@gc/db'
import { conBaseDeDatosDePrueba } from '@gc/db/pruebas'
import { validarMes } from '@gc/strategy'
import { isNotNull } from 'drizzle-orm'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { generarEstrategia, generarGrilla } from '@gc/flujos'
import {
  cargarPerfilDeObjeto, crearMarca, resolverOrganizacion, verGrilla,
} from '@gc/operaciones'

const MUESTRAS = fileURLToPath(new URL('../../../packages/strategy/muestras', import.meta.url))
const ENV = { MODELO_RAZONAMIENTO: 'proveedor/fuerte' }

describe('marcha en seco de punta a punta', () => {
  it('va del perfil a la grilla sin gastar un solo token', async () => {
    await conBaseDeDatosDePrueba(async (db) => {
      const cliente = new ClienteDeMuestra(MUESTRAS)
      const organizationId = await resolverOrganizacion(db, { env: {} })

      const marca = await crearMarca(db, organizationId, { slug: 'parcelas', nombre: 'Compra Tu Parcela' })
      await cargarPerfilDeObjeto(db, organizationId, { slug: 'parcelas', perfil: PERFIL_VALIDO })

      const estrategia = await generarEstrategia(db, cliente, organizationId, {
        slug: 'parcelas', periodo: '2026-Q3', env: ENV,
      })
      expect(estrategia.strategyId).toBeTruthy()

      const grilla = await generarGrilla(db, cliente, organizationId, {
        slug: 'parcelas', mes: '2026-09', env: ENV,
      })

      // 4 artículos de blog + 2 derivados por cada uno (linkedin e instagram)
      expect(grilla.totalSlots).toBe(12)

      const derivados = await db
        .select()
        .from(esquema.planSlots)
        .where(isNotNull(esquema.planSlots.sourceSlotId))
      expect(derivados).toHaveLength(8)

      const llamadas = await db.select().from(esquema.aiCalls)
      expect(llamadas).toHaveLength(2)
      expect(llamadas.every((l) => Number(l.costUsd) === 0)).toBe(true)

      const filas = await verGrilla(db, organizationId, { slug: 'parcelas', mes: '2026-09' })
      expect(filas).toHaveLength(12)
      expect(filas[0]!.fecha <= filas[1]!.fecha).toBe(true)

      expect(marca.brandId).toBeTruthy()
    })
  })

  it('rechaza generar la grilla de una marca inexistente', async () => {
    await conBaseDeDatosDePrueba(async (db) => {
      const organizationId = await resolverOrganizacion(db, { env: {} })

      await expect(
        generarGrilla(db, new ClienteDeMuestra(MUESTRAS), organizationId, {
          slug: 'no-existe', mes: '2026-09', env: ENV,
        }),
      ).rejects.toMatchObject({ clase: 'permanente' })
    })
  })

  it('rechaza ver la grilla con un mes mal formado', async () => {
    await conBaseDeDatosDePrueba(async (db) => {
      const organizationId = await resolverOrganizacion(db, { env: {} })
      await crearMarca(db, organizationId, { slug: 'parcelas', nombre: 'Compra Tu Parcela' })

      const error = await verGrilla(db, organizationId, {
        slug: 'parcelas', mes: '2026-13',
      }).catch((e: unknown) => e)

      expect(error).toMatchObject({ clase: 'permanente' })

      // El mensaje es el de `validarMes`, no una copia: si `grilla:ver` se
      // quedara con su propio formato, ampliar el aceptado en un comando haría
      // que el otro rechazara nombrando el formato que el usuario acaba de
      // escribir.
      expect(() => validarMes('2026-13')).toThrow((error as Error).message)
    })
  })
})
