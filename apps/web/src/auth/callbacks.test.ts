import { esquema } from '@gc/db'
import { conBaseDeDatosDePrueba } from '@gc/db/pruebas'
import type { Account, Profile, Session, User } from 'next-auth'
import type { JWT } from 'next-auth/jwt'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('../datos.js', () => ({ conexion: vi.fn() }))

const { conexion } = await import('../datos.js')
const { jwt, session, signIn } = await import('./callbacks.js')

const LISTA = 'lukas@ejemplo.cl, ana@ejemplo.cl'

function usuario(campos: Partial<User> = {}): User {
  return { id: 'google-sub-123', email: 'lukas@ejemplo.cl', name: 'Lukas', ...campos }
}

function perfilVerificado(campos: Partial<Profile> = {}): Profile {
  return { email: 'lukas@ejemplo.cl', email_verified: true, ...campos }
}

function token(campos: Partial<JWT> = {}): JWT {
  return { ...campos }
}

beforeEach(() => {
  vi.stubEnv('CORREOS_PERMITIDOS', LISTA)
})

afterEach(() => {
  vi.unstubAllEnvs()
})

describe('signIn', () => {
  it('rechaza un correo fuera de la lista', () => {
    const resultado = signIn({
      user: usuario({ email: 'afuera@ejemplo.cl' }),
      account: null,
      profile: perfilVerificado({ email: 'afuera@ejemplo.cl' }),
    })

    expect(resultado).toBe(false)
  })

  it('acepta un correo dentro de la lista y verificado', () => {
    const resultado = signIn({
      user: usuario(),
      account: null,
      profile: perfilVerificado(),
    })

    expect(resultado).toBe(true)
  })

  // Hallazgo 2: el proveedor de Google no filtra `email_verified` solo. Un
  // correo de la lista con el correo sin verificar tiene que rechazarse igual
  // que uno que no está en la lista.
  it('rechaza un correo de la lista con email_verified en false', () => {
    const resultado = signIn({
      user: usuario(),
      account: null,
      profile: perfilVerificado({ email_verified: false }),
    })

    expect(resultado).toBe(false)
  })

  it('rechaza cuando no hay profile (no debería pasar con Google, pero no debe abrir por su ausencia)', () => {
    const resultado = signIn({
      user: usuario(),
      account: null,
    })

    expect(resultado).toBe(false)
  })
})

describe('jwt', () => {
  // Hallazgo 1: sacar a alguien de CORREOS_PERMITIDOS no debe dejar su cookie
  // firmada válida hasta que expire. La revalidación tiene que ocurrir en la
  // lectura siguiente, donde `user` ya no viene informado.
  it('invalida el token en la lectura siguiente si el correo ya no está en la lista', async () => {
    const resultado = await jwt({
      token: token({ email: 'afuera@ejemplo.cl', idDeUsuario: 'id-1' }),
      user: undefined as unknown as User,
      account: null,
    })

    expect(resultado).toBeNull()
  })

  it('conserva el token en la lectura siguiente si el correo sigue en la lista', async () => {
    const t = token({ email: 'lukas@ejemplo.cl', idDeUsuario: 'id-1' })

    const resultado = await jwt({
      token: t,
      user: undefined as unknown as User,
      account: null,
    })

    expect(resultado).not.toBeNull()
    expect(resultado?.idDeUsuario).toBe('id-1')
  })

  // El id que termina en el token tiene que ser el de la fila de `users`, no
  // el `sub` que entrega Google (aquí, `user.id`).
  it('pone en el token el id de la fila de `users`, no el id que entrega Google', async () => {
    await conBaseDeDatosDePrueba(async (db) => {
      vi.mocked(conexion).mockReturnValue(db)

      const resultado = await jwt({
        token: token({ email: 'lukas@ejemplo.cl' }),
        user: usuario({ id: 'google-sub-999', email: 'lukas@ejemplo.cl', name: 'Lukas' }),
        account: { provider: 'google', type: 'oidc', providerAccountId: 'google-sub-999' } as Account,
        profile: perfilVerificado(),
        trigger: 'signIn',
      })

      const filas = await db.select().from(esquema.users)
      expect(filas).toHaveLength(1)
      expect(resultado?.idDeUsuario).toBe(filas[0]!.id)
      expect(resultado?.idDeUsuario).not.toBe('google-sub-999')
    })
  })
})

describe('session', () => {
  it('arma session.user.id desde idDeUsuario', async () => {
    const resultado = (await session({
      session: { user: {}, expires: '2026-01-01T00:00:00.000Z' } as never,
      token: token({ idDeUsuario: 'id-de-users-1' }),
    } as never)) as Session

    expect(resultado.user?.id).toBe('id-de-users-1')
  })

  // Si `idDeUsuario` falta, `session.user.id` no se inventa: no hay a qué
  // columna de autoría apuntar.
  it('no inventa session.user.id si falta idDeUsuario en el token', async () => {
    const resultado = (await session({
      session: { user: {}, expires: '2026-01-01T00:00:00.000Z' } as never,
      token: token(),
    } as never)) as Session

    expect(resultado.user?.id).toBeUndefined()
  })
})
