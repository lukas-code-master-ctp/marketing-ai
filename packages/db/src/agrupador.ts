/**
 * Si la URL apunta al agrupador de conexiones de Neon (PgBouncer en modo
 * transacción) y no al punto de conexión directo.
 *
 * Importa porque **PgBouncer en modo transacción no soporta sentencias
 * preparadas**, que es lo que `postgres-js` usa por omisión. Sin apagarlas, la
 * app funciona en local contra Postgres y falla en producción con un error que
 * no dice nada útil — y que nunca se reproduce en desarrollo.
 *
 * Se detecta por el sufijo `-pooler` en el nombre del anfitrión, que es la
 * convención de Neon. Se mira solo el anfitrión y no la cadena entera: un
 * `-pooler` en la contraseña o en el nombre de la base daría un falso positivo
 * que apaga las sentencias preparadas contra un Postgres que sí las soporta.
 *
 * Una cadena que no parsea devuelve `false`: el error de conexión que viene
 * después es mucho más claro que uno de parseo aquí.
 */
export function usaAgrupador(url: string): boolean {
  try {
    return new URL(url).hostname.includes('-pooler')
  } catch {
    return false
  }
}
