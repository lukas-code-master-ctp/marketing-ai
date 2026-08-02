import Link from 'next/link'

/**
 * Frontera de 404 de toda la app. Sin ella, un `notFound()` caía en la página
 * por defecto de Next, en inglés y sin salida.
 *
 * Vive en la raíz y no bajo `[marca]` a propósito: el `notFound()` que
 * importa lo lanza `[marca]/layout.tsx`, y un `not-found.tsx` del mismo
 * segmento no atrapa lo que lanza su propio layout.
 */
export default function NoEncontrado() {
  return (
    <div className="p-6">
      <h1 className="mb-2 text-xl font-semibold text-gray-900">No encontramos esta página</h1>
      <p className="mb-4 text-sm text-gray-600">
        La marca o el mes de la dirección no existen. Si llegaste desde un marcador, es probable
        que la marca haya cambiado de slug.
      </p>
      <Link href="/" className="text-sm text-indigo-600 underline hover:text-indigo-800">
        Volver al inicio
      </Link>
    </div>
  )
}
