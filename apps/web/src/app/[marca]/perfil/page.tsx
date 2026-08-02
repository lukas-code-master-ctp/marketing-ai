import { perfilConHistorial } from '@gc/operaciones'
import { ErrorDeDominio } from '@gc/shared'
import { EditorDePerfil } from '../../../componentes/EditorDePerfil.js'
import { conexion, organizacionPorDefecto } from '../../../datos.js'

// Árbol de rutas propio: el `force-dynamic` de `/` y el de `[marca]/grilla/[mes]`
// no llegan hasta acá. Sin este, Next prerenderiza el perfil en el build.
export const dynamic = 'force-dynamic'

export default async function PaginaDePerfil({
  params,
}: {
  params: Promise<{ marca: string }>
}) {
  const { marca } = await params
  const db = conexion()
  const organizationId = await organizacionPorDefecto(db)

  // Que la marca no exista ya no llega hasta acá: lo resuelve
  // `[marca]/layout.tsx` con un 404, igual que para grilla y estrategia. Lo
  // único que queda es el estado vacío —una marca real sin perfil todavía—,
  // que se pinta en la página como el "este mes no tiene grilla" del
  // calendario, no como un error.
  const datos = await perfilConHistorial(db, organizationId, marca).catch(
    (error: unknown) => {
      if (error instanceof ErrorDeDominio && error.clase === 'permanente') return null
      throw error
    },
  )

  return (
    <div className="p-6">
      <h1 className="mb-4 text-xl font-semibold text-gray-900">Perfil de marca</h1>

      {!datos ? (
        <div className="rounded border border-dashed border-gray-300 p-8 text-center text-gray-600">
          <p>La marca {marca} todavía no tiene perfil cargado.</p>
          <p className="mt-2">
            Cárgalo con{' '}
            <code className="rounded bg-gray-100 px-1.5 py-0.5 text-sm text-gray-800">
              pnpm cli perfil:cargar --marca {marca} --archivo perfiles/{marca}.json
            </code>
          </p>
        </div>
      ) : (
        <EditorDePerfil
          marca={marca}
          version={datos.version}
          perfil={datos.perfil}
          versiones={datos.versiones}
        />
      )}
    </div>
  )
}
