/** El correo de mentira con que se entra en desarrollo. Se inserta en `users`
 *  como cualquier otro, para que el camino de autoría se ejercite en local en
 *  vez de existir solo en producción, que es donde nadie lo prueba. */
const CORREO_DE_DESARROLLO = 'desarrollo@local'

/**
 * Si este correo puede entrar.
 *
 * **Cerrado por omisión**: sin lista configurada no entra nadie. Una variable
 * que falta en producción no puede significar "que pase cualquiera" — ese es
 * exactamente el modo de falla que uno no descubre hasta que ya pasó.
 *
 * Recibe la lista como parámetro en vez de leer el entorno, para que se pueda
 * probar sin ensuciar el proceso de pruebas.
 */
export function correoPermitido(
  correo: string | null | undefined,
  lista: string | undefined,
): boolean {
  if (!correo) return false

  const permitidos = (lista ?? '')
    .split(',')
    .map((c) => c.trim().toLowerCase())
    .filter((c) => c !== '')

  if (permitidos.length === 0) return false

  return permitidos.includes(correo.trim().toLowerCase())
}

/**
 * La sesión de mentira de desarrollo, o `null` si no corresponde.
 *
 * Exige **las dos cosas**: que el entorno sea de desarrollo y que la variable
 * esté encendida. La primera condición es la que hace que esto no sea un
 * agujero: no depende de que alguien se acuerde de apagar la variable antes de
 * desplegar.
 *
 * Recibe el entorno como parámetro y no lee `process.env` por dentro,
 * precisamente para que la prueba de que en producción no se activa sea
 * posible sin manipular el entorno del proceso.
 */
export function sesionDeDesarrollo(env: {
  NODE_ENV?: string | undefined
  SESION_DE_DESARROLLO?: string | undefined
}): { email: string; name: string } | null {
  if (env.NODE_ENV !== 'development') return null
  if (env.SESION_DE_DESARROLLO !== 'true') return null

  return { email: CORREO_DE_DESARROLLO, name: 'Desarrollo' }
}
