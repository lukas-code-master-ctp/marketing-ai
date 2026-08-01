import { perfilConHistorial } from '@gc/operaciones'
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

  // Sin perfil cargado, `perfilConHistorial` lanza `permanente`: se muestra
  // el mensaje del dominio en vez de una página caída con un 500.
  let datos: Awaited<ReturnType<typeof perfilConHistorial>> | null = null
  let error: string | null = null
  try {
    datos = await perfilConHistorial(db, organizationId, marca)
  } catch (e) {
    error = e instanceof Error ? e.message : String(e)
  }

  return (
    <div className="p-6">
      <h1 className="mb-4 text-xl font-semibold text-gray-900">Perfil de marca</h1>

      {error ? (
        <div className="rounded border border-dashed border-gray-300 p-8 text-center text-gray-600">
          <p>{error}</p>
        </div>
      ) : (
        <EditorDePerfil
          marca={marca}
          version={datos!.version}
          perfil={datos!.perfil}
          versiones={datos!.versiones}
        />
      )}
    </div>
  )
}
