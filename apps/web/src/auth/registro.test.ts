import { esquema } from '@gc/db'
import { conBaseDeDatosDePrueba } from '@gc/db/pruebas'
import { describe, expect, it, vi } from 'vitest'

vi.mock('../datos.js', () => ({ conexion: vi.fn() }))

const { conexion } = await import('../datos.js')
const { registrarPersona } = await import('./registro.js')

describe('registrarPersona', () => {
  it('crea la fila en el primer inicio de sesión', async () => {
    await conBaseDeDatosDePrueba(async (db) => {
      vi.mocked(conexion).mockResolvedValue(db)

      const id = await registrarPersona('lukas@ejemplo.cl', 'Lukas')

      const filas = await db.select().from(esquema.users)
      expect(filas).toHaveLength(1)
      expect(filas[0]!.id).toBe(id)
      expect(filas[0]!.email).toBe('lukas@ejemplo.cl')
    })
  })

  it('el segundo inicio de sesión no duplica y devuelve el mismo id', async () => {
    await conBaseDeDatosDePrueba(async (db) => {
      vi.mocked(conexion).mockResolvedValue(db)

      const primero = await registrarPersona('lukas@ejemplo.cl', 'Lukas')
      const segundo = await registrarPersona('lukas@ejemplo.cl', 'Lukas')

      expect(segundo).toBe(primero)
      expect(await db.select().from(esquema.users)).toHaveLength(1)
    })
  })

  it('refresca el nombre sin cambiar la identidad', async () => {
    await conBaseDeDatosDePrueba(async (db) => {
      vi.mocked(conexion).mockResolvedValue(db)

      const id = await registrarPersona('lukas@ejemplo.cl', 'Lukas')
      const mismo = await registrarPersona('lukas@ejemplo.cl', 'Lukas Rencoret')

      expect(mismo).toBe(id)
      const [fila] = await db.select().from(esquema.users)
      expect(fila!.name).toBe('Lukas Rencoret')
    })
  })
})
