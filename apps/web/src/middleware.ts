import NextAuth from 'next-auth'
import { authConfig } from './auth.config.js'

/**
 * Protege las rutas de páginas para que nadie vea datos sin entrar.
 *
 * **No reemplaza a la guarda de las Server Actions** y viceversa: esto impide
 * ver, aquella impide escribir, y una acción llamada directamente no pasa por
 * aquí. Las dos capas hacen falta.
 *
 * Se excluyen las rutas de Auth.js —que tienen que ser alcanzables sin sesión
 * o no habría forma de entrar—, la pantalla de entrada, y los archivos
 * estáticos.
 *
 * Usa `authConfig` (`./auth.config.js`), no el `auth` completo de
 * `./auth.js`: ver el comentario de `auth.config.ts` para el porqué —el
 * choque con el runtime Edge es real y está confirmado con el build, no
 * supuesto.
 */
export const { auth: middleware } = NextAuth(authConfig)

export const config = {
  matcher: ['/((?!api/auth|entrar|_next/static|_next/image|favicon.ico).*)'],
}
