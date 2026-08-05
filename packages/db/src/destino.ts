/**
 * Por dónde conectarse a Postgres.
 *
 * En Vercel la app llega a Cloud SQL por el conector de Google, que autoriza
 * por IAM y deja la lista de redes de la instancia vacía. En cualquier otro
 * lado —tu máquina, el CLI, el worker, las pruebas— se conecta por URL a
 * Docker, como siempre.
 *
 * Recibe el entorno como parámetro en vez de leer `process.env` por dentro,
 * para que la decisión se pueda probar sin ensuciar el proceso de pruebas.
 */
export type Destino =
  | { tipo: 'url'; url: string }
  | {
      tipo: 'cloud-sql'
      instancia: string
      usuario: string
      clave: string
      base: string
      /** El JSON de la cuenta de servicio, tal cual, sin parsear. */
      credenciales: string
    }

export function destinoDeConexion(env: Record<string, string | undefined>): Destino {
  const instancia = env.CLOUD_SQL_INSTANCIA?.trim()

  if (!instancia) {
    const url = env.DATABASE_URL?.trim()
    if (!url) {
      throw new Error(
        'Falta DATABASE_URL. En local apunta al Postgres de Docker; en Vercel configura CLOUD_SQL_INSTANCIA y sus tres variables.',
      )
    }
    return { tipo: 'url', url }
  }

  // Si la instancia está pero le faltan datos, se falla acá. Caer en silencio
  // al camino de URL daría un error sobre `localhost` en producción, y eso
  // manda a diagnosticar la red equivocada.
  if (instancia.split(':').length !== 3) {
    throw new Error(
      `CLOUD_SQL_INSTANCIA tiene que ser "proyecto:región:instancia", y llegó "${instancia}".`,
    )
  }

  const faltantes = (
    [
      'CLOUD_SQL_USUARIO',
      'CLOUD_SQL_CLAVE',
      'CLOUD_SQL_BASE',
      // El JSON de la cuenta de servicio. Va como variable y no como archivo
      // porque en Vercel no hay dónde poner un archivo, y el conector acepta
      // las credenciales como objeto por su opción `auth`.
      'GOOGLE_CREDENCIALES_JSON',
    ] as const
  ).filter((nombre) => !env[nombre]?.trim())

  if (faltantes.length > 0) {
    throw new Error(
      `CLOUD_SQL_INSTANCIA está configurada, así que también hacen falta: ${faltantes.join(', ')}.`,
    )
  }

  return {
    tipo: 'cloud-sql',
    instancia,
    usuario: env.CLOUD_SQL_USUARIO!.trim(),
    clave: env.CLOUD_SQL_CLAVE!,
    base: env.CLOUD_SQL_BASE!.trim(),
    credenciales: env.GOOGLE_CREDENCIALES_JSON!,
  }
}
