import NextAuth from 'next-auth'
import Google from 'next-auth/providers/google'
import { authConfig } from './auth.config.js'
import { jwt, session, signIn as autorizarInicioDeSesion } from './auth/callbacks.js'
import { sesionDeDesarrollo } from './auth/permitidos.js'
import { registrarPersona } from './auth/registro.js'

// `signIn` (de `NextAuth(...)`, más abajo) es la función que dispara el flujo
// de inicio de sesión con un proveedor. El callback del mismo nombre en
// `./auth/callbacks.js` es la decisión de autorización. Se renombra al
// importarlo para que no choquen.
//
// Extiende `authConfig` (la mitad sin Node, que usa el middleware) con el
// proveedor de Google y los tres callbacks completos. `jwt` sobrescribe al
// de `authConfig`: este es el que además registra en la base con
// `registrarPersona`, seguro acá porque este módulo solo corre en Node
// (Server Actions, Server Components, el Route Handler de `/api/auth`), nunca
// en el runtime Edge del middleware.
export const { handlers, auth, signIn, signOut } = NextAuth({
  ...authConfig,
  providers: [Google],
  // Los tres callbacks viven en `./auth/callbacks.js`, exportados y con
  // nombre: es la única forma de invocarlos desde una prueba, porque este
  // módulo construye NextAuth al cargarse.
  callbacks: { ...authConfig.callbacks, signIn: autorizarInicioDeSesion, jwt, session },
})

/**
 * La sesión efectiva: la real, o la de desarrollo si corresponde.
 *
 * Es el único punto por el que el resto de la app pregunta quién está
 * conectado. Que la puerta trasera viva aquí y no repartida significa que
 * `sesionDeDesarrollo` —que ya está probada— es la que decide, en un solo
 * lugar.
 */
export async function sesionActual(): Promise<{ id: string; email: string } | null> {
  const deDesarrollo = sesionDeDesarrollo(process.env)
  if (deDesarrollo) {
    const id = await registrarPersona(deDesarrollo.email, deDesarrollo.name)
    return { id, email: deDesarrollo.email }
  }

  const sesion = await auth()
  if (!sesion?.user?.id || !sesion.user.email) return null

  return { id: sesion.user.id, email: sesion.user.email }
}
