import { describe, expect, it } from 'vitest'
import { destinoDeConexion } from './destino.js'

const CLOUD = {
  CLOUD_SQL_INSTANCIA: 'mi-proyecto:us-central1:gestor',
  CLOUD_SQL_USUARIO: 'app',
  CLOUD_SQL_CLAVE: 'secreta',
  CLOUD_SQL_BASE: 'gestor',
  GOOGLE_CREDENCIALES_JSON: '{"type":"service_account"}',
}

describe('destinoDeConexion', () => {
  it('sin instancia configurada conecta por URL', () => {
    const d = destinoDeConexion({ DATABASE_URL: 'postgres://x@localhost:5432/gestor' })
    expect(d.tipo).toBe('url')
  })

  it('con la instancia y sus datos conecta por el conector', () => {
    const d = destinoDeConexion({ ...CLOUD, DATABASE_URL: 'postgres://x@localhost:5432/gestor' })
    expect(d.tipo).toBe('cloud-sql')
  })

  it('la instancia gana sobre DATABASE_URL cuando están las dos', () => {
    // En Vercel van a convivir: DATABASE_URL puede quedar de un despliegue
    // anterior. Lo que manda es la instancia, y que sea explícito evita el
    // accidente de conectar a la base equivocada sin que nadie lo note.
    const d = destinoDeConexion({ ...CLOUD, DATABASE_URL: 'postgres://x@otra/base' })
    expect(d.tipo).toBe('cloud-sql')
  })

  it('una instancia incompleta falla en vez de caer a la URL', () => {
    // Es el caso peligroso: caer en silencio al camino de URL daría un error
    // sobre `localhost` en producción, que manda a diagnosticar la red
    // equivocada durante horas.
    expect(() => destinoDeConexion({ CLOUD_SQL_INSTANCIA: CLOUD.CLOUD_SQL_INSTANCIA })).toThrow(
      /CLOUD_SQL_USUARIO/,
    )
  })

  it('con la instancia y sus datos pero sin GOOGLE_CREDENCIALES_JSON también falla nombrando la variable', () => {
    // Mismo caso peligroso que las otras tres: sin esto, el conector caería
    // a las credenciales por omisión, que en Vercel no existen, y el fallo
    // aparecería recién al desplegar.
    const { GOOGLE_CREDENCIALES_JSON: _omitida, ...sinCredenciales } = CLOUD
    expect(() => destinoDeConexion(sinCredenciales)).toThrow(/GOOGLE_CREDENCIALES_JSON/)
  })

  it('sin nada configurado dice qué falta', () => {
    expect(() => destinoDeConexion({})).toThrow(/DATABASE_URL/)
  })

  it('el nombre de instancia tiene que tener las tres partes', () => {
    // `proyecto:región:instancia`. Con dos partes el conector falla con un
    // mensaje mucho más oscuro que este.
    expect(() => destinoDeConexion({ ...CLOUD, CLOUD_SQL_INSTANCIA: 'proyecto:instancia' })).toThrow(
      /proyecto:región:instancia/,
    )
  })

  it('rechaza una instancia con una parte vacía al final', () => {
    // 'proyecto:us-central1:' tiene tres partes al partir por ':', pero la
    // última está vacía. Contar partes no alcanza para atrapar esto.
    expect(() =>
      destinoDeConexion({ ...CLOUD, CLOUD_SQL_INSTANCIA: 'proyecto:us-central1:' }),
    ).toThrow(/proyecto:región:instancia/)
  })

  it('rechaza una instancia con las tres partes vacías', () => {
    expect(() => destinoDeConexion({ ...CLOUD, CLOUD_SQL_INSTANCIA: '::' })).toThrow(
      /proyecto:región:instancia/,
    )
  })
})
