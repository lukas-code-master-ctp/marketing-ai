/**
 * Si la URL apunta al agrupador de conexiones de Neon (PgBouncer en modo
 * transacción) y no al punto de conexión directo.
 *
 * Importa porque **PgBouncer en modo transacción no soporta sentencias
 * preparadas**, que es lo que `postgres-js` usa por omisión. Sin apagarlas, la
 * app funciona en local contra Postgres y falla en producción con un error que
 * no dice nada útil — y que nunca se reproduce en desarrollo.
 *
 * Se detecta por el sufijo `-pooler` en la primera etiqueta del nombre del
 * anfitrión (lo que está antes del primer punto), que es la convención de
 * Neon, comparado sin distinguir mayúsculas de minúsculas. Se mira solo el
 * anfitrión y no la cadena entera: un `-pooler` en la contraseña o en el
 * nombre de la base daría un falso positivo que apaga las sentencias
 * preparadas contra un Postgres que sí las soporta. Y se exige que sea
 * sufijo de esa primera etiqueta, no una subcadena en cualquier posición: un
 * anfitrión como `db-poolerless.ejemplo.com` no es el agrupador de Neon.
 *
 * `postgres://` no es un esquema "especial" para el parser WHATWG URL, así
 * que Node no normaliza `hostname` a minúsculas por su cuenta — de ahí el
 * `toLowerCase()` explícito. Sin él, un anfitrión agrupado con cualquier
 * mayúscula dejaría las sentencias preparadas encendidas contra PgBouncer,
 * un fallo que solo se ve en producción.
 *
 * Una cadena que no parsea devuelve `false`: el error de conexión que viene
 * después es mucho más claro que uno de parseo aquí.
 */
export function usaAgrupador(url: string): boolean {
  try {
    const primeraEtiqueta = new URL(url).hostname.toLowerCase().split('.')[0] ?? ''
    return primeraEtiqueta.endsWith('-pooler')
  } catch {
    return false
  }
}
