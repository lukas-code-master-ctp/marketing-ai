import { signIn } from '../../auth.js'

// Esta ruta lee el parámetro de error de la URL, así que no puede
// prerenderizarse: sin esto quedaría congelada en el build sin error.
export const dynamic = 'force-dynamic'

export default async function PaginaDeEntrada({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>
}) {
  const { error } = await searchParams
  // Auth.js manda `AccessDenied` cuando el callback de inicio de sesión
  // devuelve false, que aquí significa exactamente una cosa: el correo no está
  // en la lista.
  const rechazado = error === 'AccessDenied'
  // `Configuration` es lo que llega cuando `registrarPersona` falla: `@auth/core`
  // envuelve cualquier error del callback en `CallbackRouteError`, que no expone
  // al cliente. No es un rechazo por lista —es una caída del sistema— así que
  // lleva un color y un mensaje distintos: confundirlo con el rechazo manda a
  // la persona a pedir un permiso que ya tiene.
  const fallaDelSistema = error === 'Configuration'
  // Auth.js manda varios otros códigos —`OAuthCallbackError`, `Verification`,
  // `MissingCSRF` (formulario expirado o cookies bloqueadas), entre otros— que
  // no son ni el rechazo por lista ni una caída del sistema. Sin esta rama la
  // pantalla se quedaba muda ante cualquiera de ellos: la persona veía el
  // botón de siempre sin ninguna pista de por qué no entró. El texto es
  // deliberadamente genérico: no se sabe cuál de los dos motivos fue, así que
  // no se le puede echar la culpa a la cuenta ni prometer un diagnóstico que
  // no se tiene.
  const otroError = error !== undefined && !rechazado && !fallaDelSistema

  return (
    <div className="flex min-h-screen flex-col items-center justify-center gap-6 p-6">
      <h1 className="text-xl font-semibold text-gray-900">Gestor de contenido</h1>

      {rechazado && (
        <div
          role="alert"
          className="max-w-sm rounded border border-amber-300 bg-amber-50 p-3 text-sm text-amber-900"
        >
          Esa cuenta no está en la lista de personas autorizadas. Si crees que debería estarlo,
          pídele a quien administra el sistema que agregue tu correo.
        </div>
      )}

      {fallaDelSistema && (
        <div
          role="alert"
          className="max-w-sm rounded border border-red-300 bg-red-50 p-3 text-sm text-red-900"
        >
          Hubo un problema del sistema al iniciar tu sesión. No es tu cuenta: intenta de nuevo más
          tarde.
        </div>
      )}

      {otroError && (
        <div
          role="alert"
          className="max-w-sm rounded border border-gray-300 bg-gray-50 p-3 text-sm text-gray-700"
        >
          No pudimos completar el inicio de sesión. Intenta de nuevo; si vuelve a pasar, avísale a
          quien administra el sistema.
        </div>
      )}

      <form
        action={async () => {
          'use server'
          await signIn('google', { redirectTo: '/' })
        }}
      >
        <button
          type="submit"
          className="rounded bg-indigo-600 px-4 py-2 text-sm font-medium text-white hover:bg-indigo-700"
        >
          Entrar con Google
        </button>
      </form>
    </div>
  )
}
