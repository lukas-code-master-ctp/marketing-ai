import NextAuth from 'next-auth'
import Google from 'next-auth/providers/google'
import { correoPermitido, sesionDeDesarrollo } from './auth/permitidos.js'
import { registrarPersona } from './auth/registro.js'

export const { handlers, auth, signIn, signOut } = NextAuth({
  providers: [Google],
  pages: {
    signIn: '/entrar',
    error: '/entrar',
  },
  callbacks: {
    /**
     * La lista de permitidos es la única autorización del sistema. Devolver
     * `false` manda a la pantalla de entrada con el motivo, en vez de dejar a
     * la persona en un bucle de redirección.
     */
    signIn({ user }) {
      return correoPermitido(user.email, process.env.CORREOS_PERMITIDOS)
    },

    /**
     * El id de la fila de `users` viaja en el token, no se consulta en cada
     * petición: la sesión va en cookie firmada y este callback solo corre al
     * entrar o al refrescar el token.
     */
    async jwt({ token, user }) {
      if (user?.email) {
        token.idDeUsuario = await registrarPersona(user.email, user.name ?? null)
      }
      return token
    },

    session({ session, token }) {
      if (typeof token.idDeUsuario === 'string') {
        session.user.id = token.idDeUsuario
      }
      return session
    },
  },
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
