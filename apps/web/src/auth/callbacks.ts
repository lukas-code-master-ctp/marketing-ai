import type { NextAuthConfig } from 'next-auth'
import { correoPermitido } from './permitidos.js'
import { registrarPersona } from './registro.js'

/**
 * Los tres callbacks de NextAuth, extraídos aquí y no como funciones anónimas
 * dentro del literal que arma `auth.ts`, para que se puedan invocar desde una
 * prueba: son la única decisión de autorización del sistema, y un módulo que
 * construye NextAuth al cargarse no se puede importar en una prueba sin
 * arrastrar esa construcción (mismo motivo por el que `registrarPersona` vive
 * en `registro.ts` y no en `auth.ts`).
 */
type Callbacks = NonNullable<NextAuthConfig['callbacks']>

/**
 * La lista de permitidos es la única autorización del sistema. Devolver
 * `false` manda a la pantalla de entrada con el motivo, en vez de dejar a
 * la persona en un bucle de redirección.
 *
 * Además de estar en la lista, Google tiene que haber verificado el correo.
 * El proveedor es `type: "oidc"` puro, sin función `profile` que filtre por
 * su cuenta: un token de identidad con el correo de la lista pero con
 * `email_verified: false` pasaría el filtro si no se lo pide aquí.
 */
export const signIn: NonNullable<Callbacks['signIn']> = ({ user, profile }) => {
  if (profile?.email_verified !== true) return false
  return correoPermitido(user.email, process.env.CORREOS_PERMITIDOS)
}

/**
 * El id de la fila de `users` viaja en el token, no se consulta en cada
 * petición: la sesión va en cookie firmada. Pero este callback corre tanto al
 * entrar (`user` presente) como en cada lectura posterior de la sesión
 * (`user` es `undefined` y solo queda el `token` ya emitido).
 *
 * Por eso revalida la lista de permitidos en **cada** invocación, no solo al
 * entrar: sacar a alguien de `CORREOS_PERMITIDOS` y redesplegar no debe dejar
 * su cookie firmada válida hasta que el JWT expire por su cuenta. Devolver
 * `null` aquí invalida el token, y Auth.js limpia la cookie sola en esa misma
 * petición. Esto no exige guardar estado de sesión: sigue siendo la misma
 * variable de entorno, comprobada de nuevo.
 *
 * `../auth.config.ts` tiene un `jwt` gemelo para la mitad edge (la que usa el
 * middleware), con la misma revalidación pero sin `registrarPersona`. Las dos
 * mitades se prueban por separado (`callbacks.test.ts` acá, `auth.config.test.ts`
 * allá) porque una cookie firmada tiene que invalidarse en las dos, no solo en
 * la que llega al servidor completo: si se endurece una revalidación sin la
 * otra, queda un agujero.
 */
export const jwt: NonNullable<Callbacks['jwt']> = async ({ token, user }) => {
  const correo = user?.email ?? token.email
  if (!correoPermitido(correo, process.env.CORREOS_PERMITIDOS)) return null

  if (user?.email) {
    token.idDeUsuario = await registrarPersona(user.email, user.name ?? null)
  }

  return token
}

/**
 * La sesión se arma con el id de la fila de `users` (`idDeUsuario`, puesto en
 * el token por el callback `jwt`), nunca con el `sub` que entrega Google: son
 * identidades distintas, y solo la de `users` tiene a qué apuntar en las
 * columnas de autoría. Si `idDeUsuario` falta —no debería, pero el callback
 * `jwt` no lo garantiza en el tipo—, `session.user.id` no se inventa.
 */
export const session: NonNullable<Callbacks['session']> = ({ session, token }) => {
  if (typeof token.idDeUsuario === 'string') {
    session.user.id = token.idDeUsuario
  }
  return session
}
