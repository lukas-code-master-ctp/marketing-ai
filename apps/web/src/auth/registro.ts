import { esquema } from '@gc/db'
import { eq } from 'drizzle-orm'
import { conexion } from '../datos.js'

/**
 * Deja registrada a la persona y devuelve el id de su fila.
 *
 * Es un upsert por correo: la tabla `users` no autoriza a nadie —eso lo decide
 * la lista de permitidos— sino que registra a quien ya pasó ese filtro, para
 * que las columnas de autoría tengan a qué apuntar.
 *
 * Vive en su propio archivo, separado de `auth.ts`, para poder probarse sin
 * arrastrar la construcción de NextAuth: `auth.ts` la ejecuta al cargar el
 * módulo, y eso exige variables de entorno que en pruebas no existen.
 */
export async function registrarPersona(email: string, name: string | null): Promise<string> {
  const db = conexion()

  const [fila] = await db
    .insert(esquema.users)
    .values({ email, name })
    .onConflictDoUpdate({
      target: esquema.users.email,
      // El nombre se refresca: si alguien lo cambia en Google, la próxima
      // entrada lo actualiza. El correo es la identidad y no se toca.
      set: { name },
    })
    .returning({ id: esquema.users.id })

  if (fila) return fila.id

  // `onConflictDoUpdate` siempre devuelve fila, así que esto es defensa en
  // profundidad para un camino que no debería existir.
  const [existente] = await db
    .select({ id: esquema.users.id })
    .from(esquema.users)
    .where(eq(esquema.users.email, email))

  if (!existente) throw new Error(`No se pudo registrar a ${email}`)
  return existente.id
}
