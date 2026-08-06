import type { NextAuthConfig } from 'next-auth'
import { correoPermitido, sesionDeDesarrollo } from './auth/permitidos.js'

/**
 * La mitad de la configuración de Auth.js que puede correr en el runtime
 * Edge: sin proveedores —Google no hace falta para leer una cookie ya
 * firmada— y sin nada que toque la base.
 *
 * Existe porque el middleware no puede importar `auth.ts` completo. Next
 * ejecuta `middleware.ts` en el runtime Edge por omisión, y `auth.ts` arrastra
 * (vía `auth/registro.ts` → `datos.ts` → `@gc/operaciones`) tanto el driver de
 * Postgres como `node:fs/promises` de `perfiles.ts`. Confirmado con el build
 * real: apuntar el middleware a `auth.ts` falla al compilar con
 * `UnhandledSchemeError: Reading from "node:fs/promises" is not handled by
 * plugins`, porque webpack intenta empaquetar esa rama para Edge. La salida
 * documentada de Auth.js para este choque es partir la configuración en dos
 * (https://authjs.dev/guides/edge-compatibility): este archivo es la mitad
 * sin Node, y `auth.ts` la extiende con los proveedores y los callbacks
 * completos para todo lo que sí corre en Node (Server Actions, Server
 * Components, el Route Handler de `/api/auth`).
 */
export const authConfig = {
  pages: {
    signIn: '/entrar',
    error: '/entrar',
  },
  callbacks: {
    /**
     * La misma revalidación que `auth/callbacks.js` hace en el `jwt`
     * completo, sin la parte que registra en la base. Sacar a alguien de
     * `CORREOS_PERMITIDOS` tiene que invalidar su cookie también en las
     * peticiones que solo pasan por el middleware, no nada más en las que
     * llegan al servidor completo — perder esto sería un retroceso de
     * seguridad silencioso.
     */
    jwt({ token }) {
      if (!correoPermitido(token.email, process.env.CORREOS_PERMITIDOS)) return null
      return token
    },
    /**
     * Decide si el middleware deja pasar. `sesionDeDesarrollo` primero, igual
     * que `sesionActual()`: en desarrollo con `SESION_DE_DESARROLLO=true` no
     * hay cookie real de Google, y sin esta rama el middleware mandaría a
     * `/entrar` incluso con la puerta trasera de desarrollo encendida.
     */
    authorized({ auth }) {
      if (sesionDeDesarrollo(process.env)) return true
      return !!auth?.user
    },
  },
  providers: [],
} satisfies NextAuthConfig
