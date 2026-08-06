import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('./auth/registro.js', () => ({ registrarPersona: vi.fn() }))

const { registrarPersona } = await import('./auth/registro.js')
const { sesionActual } = await import('./auth.js')

/**
 * Solo se cubre la rama de desarrollo: es la única que no exige una petición
 * HTTP real. `sesionActual()` corta antes de llamar a `auth()` cuando
 * `sesionDeDesarrollo` devuelve algo, así que esta rama se puede probar
 * importando `auth.ts` directamente sin levantar Next ni tener cookies.
 * La rama real (`auth()`) queda sin cubrir aquí: `next-auth` la resuelve leyendo
 * la petición vía `next/headers`, que no existe fuera de una petición real de
 * Next, y simularla sería la contorsión de la que habla el encargo.
 */
describe('sesionActual', () => {
  beforeEach(() => {
    vi.stubEnv('NODE_ENV', 'development')
    vi.stubEnv('SESION_DE_DESARROLLO', 'true')
    vi.mocked(registrarPersona).mockResolvedValue('id-de-desarrollo')
  })

  afterEach(() => {
    vi.unstubAllEnvs()
    vi.mocked(registrarPersona).mockReset()
  })

  it('en desarrollo con la variable encendida devuelve la sesión de mentira registrada', async () => {
    const sesion = await sesionActual()

    expect(sesion).toEqual({ id: 'id-de-desarrollo', email: 'desarrollo@local' })
    expect(registrarPersona).toHaveBeenCalledWith('desarrollo@local', 'Desarrollo')
  })

  // La rama que cae a `auth()` (fuera de desarrollo, o con la variable
  // apagada) queda sin cubrir aquí a propósito: `next-auth` resuelve `auth()`
  // leyendo la petición vía `next/headers`, y llamarlo fuera de una petición
  // real de Next falla con "headers was called outside a request scope" — la
  // contorsión de la que habla el encargo. Simularla exigiría mockear el
  // almacenamiento interno de `next/server`, lo que dejaría de probar el
  // código real de `sesionActual` para probar el mock.
})
