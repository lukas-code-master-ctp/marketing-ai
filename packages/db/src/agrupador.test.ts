import { describe, expect, it } from 'vitest'
import { usaAgrupador } from './agrupador.js'

describe('usaAgrupador', () => {
  it('reconoce el punto de conexión agrupado de Neon', () => {
    expect(
      usaAgrupador('postgres://u:p@ep-cool-name-123456-pooler.us-east-2.aws.neon.tech/gestor'),
    ).toBe(true)
  })

  it('no confunde el punto de conexión directo de Neon', () => {
    expect(
      usaAgrupador('postgres://u:p@ep-cool-name-123456.us-east-2.aws.neon.tech/gestor'),
    ).toBe(false)
  })

  it('el Postgres local no usa agrupador', () => {
    expect(usaAgrupador('postgres://postgres:postgres@localhost:5432/gestor')).toBe(false)
  })

  it('no se deja engañar por un "-pooler" en la base o en la contraseña', () => {
    // El sufijo solo cuenta en el nombre del anfitrión. Buscarlo en la cadena
    // entera daría falsos positivos que apagarían las sentencias preparadas
    // contra un Postgres que sí las soporta, y eso es una pérdida de
    // rendimiento silenciosa.
    expect(usaAgrupador('postgres://u:mi-pooler@localhost:5432/gestor')).toBe(false)
    expect(usaAgrupador('postgres://u:p@localhost:5432/base-pooler')).toBe(false)
  })

  it('una cadena que no es una URL no revienta', () => {
    expect(usaAgrupador('esto no es una url')).toBe(false)
  })
})
