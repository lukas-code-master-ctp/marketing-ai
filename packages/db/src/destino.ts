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
      /**
       * El JSON de la cuenta de servicio, tal cual, sin parsear — o `null`
       * para que el conector tome las credenciales del entorno.
       *
       * `null` solo ocurre dentro de Cloud Run, que adhiere una cuenta de
       * servicio al servicio y la expone por su servidor de metadatos. En
       * Vercel no existe esa identidad, y por eso allá la variable sigue
       * siendo obligatoria: ver la comprobación de `K_SERVICE` más abajo.
       */
      credenciales: string | null
    }

export function destinoDeConexion(env: Record<string, string | undefined>): Destino {
  const instancia = env.CLOUD_SQL_INSTANCIA?.trim()

  if (!instancia) {
    const url = env.DATABASE_URL?.trim()
    if (!url) {
      throw new Error(
        'Falta DATABASE_URL. En local apunta al Postgres de Docker; en Vercel configura CLOUD_SQL_INSTANCIA y sus cuatro variables.',
      )
    }
    return { tipo: 'url', url }
  }

  // Si la instancia está pero le faltan datos, se falla acá. Caer en silencio
  // al camino de URL daría un error sobre `localhost` en producción, y eso
  // manda a diagnosticar la red equivocada.
  //
  // No basta con contar las partes: 'proyecto:us-central1:' y '::' también
  // tienen tres al partir por ':', y las dos dejarían pasar una parte vacía
  // hasta el conector, que responde con un mensaje mucho más oscuro que este.
  const partesDeInstancia = instancia.split(':')
  if (partesDeInstancia.length !== 3 || partesDeInstancia.some((parte) => parte.length === 0)) {
    throw new Error(
      `CLOUD_SQL_INSTANCIA tiene que ser "proyecto:región:instancia", y llegó "${instancia}".`,
    )
  }

  // `K_SERVICE` la define Cloud Run en toda revisión, y no la define ningún
  // otro entorno de los que este repositorio usa. Es la señal de que hay una
  // cuenta de servicio adherida al proceso, y por lo tanto de que el JSON
  // sobra. Donde no está —Vercel, tu máquina— el JSON sigue siendo la única
  // forma de autenticar, así que su ausencia se reporta como error legible en
  // vez de dejar que el conector caiga a unas credenciales por omisión que no
  // existen: ese fallo aparecería recién al desplegar y no menciona variables.
  const dentroDeCloudRun = Boolean(env.K_SERVICE?.trim())
  const credenciales = env.GOOGLE_CREDENCIALES_JSON?.trim() ? env.GOOGLE_CREDENCIALES_JSON! : null

  const requeridas = ['CLOUD_SQL_USUARIO', 'CLOUD_SQL_CLAVE', 'CLOUD_SQL_BASE']
  if (!dentroDeCloudRun) requeridas.push('GOOGLE_CREDENCIALES_JSON')

  const faltantes = requeridas.filter((nombre) => !env[nombre]?.trim())

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
    credenciales,
  }
}
