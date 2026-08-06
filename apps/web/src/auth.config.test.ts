import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { authConfig } from './auth.config.js'

/**
 * `authConfig` es un objeto plano —no construye NextAuth al importarse, a
 * diferencia de `auth.ts`— así que sus callbacks se invocan directo, igual
 * que `auth/callbacks.test.ts` hace con los callbacks hermanos de la mitad
 * servidor. Es la única cobertura de este bloque: antes de este archivo,
 * `authConfig.callbacks.authorized` y su `jwt` de revalidación no tenían
 * ninguna prueba propia.
 */

const LISTA = 'lukas@ejemplo.cl, ana@ejemplo.cl'

beforeEach(() => {
  vi.stubEnv('NODE_ENV', 'test')
  vi.stubEnv('SESION_DE_DESARROLLO', 'false')
  vi.stubEnv('CORREOS_PERMITIDOS', LISTA)
})

afterEach(() => {
  vi.unstubAllEnvs()
})

describe('authConfig.callbacks.authorized', () => {
  it('bloquea al middleware cuando no hay sesión', () => {
    const resultado = authConfig.callbacks.authorized({ auth: null } as never)
    expect(resultado).toBe(false)
  })

  it('deja pasar al middleware cuando hay sesión', () => {
    const resultado = authConfig.callbacks.authorized({
      auth: { user: { email: 'lukas@ejemplo.cl' } },
    } as never)
    expect(resultado).toBe(true)
  })

  it('con la sesión de desarrollo encendida deja pasar sin sesión real', () => {
    vi.stubEnv('NODE_ENV', 'development')
    vi.stubEnv('SESION_DE_DESARROLLO', 'true')

    const resultado = authConfig.callbacks.authorized({ auth: null } as never)
    expect(resultado).toBe(true)
  })
})

describe('authConfig.callbacks.jwt', () => {
  // La misma revalidación que `auth/callbacks.test.ts` prueba sobre la mitad
  // servidor (el `jwt` de `./auth/callbacks.js`), pero acá sobre la mitad
  // edge que usa el middleware. Sin esto, una cookie firmada podía dejar de
  // ser válida en las peticiones que llegan al servidor completo y seguir
  // siendo válida en las que solo pasan por el middleware — justo el agujero
  // que el comentario de `auth.config.ts` advierte.
  it('invalida el token si el correo ya no está en la lista', () => {
    const resultado = authConfig.callbacks.jwt({
      token: { email: 'afuera@ejemplo.cl' },
    } as never)

    expect(resultado).toBeNull()
  })

  it('conserva el token si el correo sigue en la lista', () => {
    const token = { email: 'lukas@ejemplo.cl', idDeUsuario: 'id-1' }

    const resultado = authConfig.callbacks.jwt({ token } as never)

    expect(resultado).not.toBeNull()
    expect((resultado as typeof token).idDeUsuario).toBe('id-1')
  })
})
