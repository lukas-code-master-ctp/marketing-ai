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
