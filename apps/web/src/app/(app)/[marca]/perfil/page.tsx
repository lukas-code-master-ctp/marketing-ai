import { PLANTILLA_DE_PERFIL, perfilConHistorial } from '@gc/operaciones'
import { EditorDePerfil } from '../../../../componentes/EditorDePerfil.js'
import { conexion, organizacionPorDefecto } from '../../../../datos.js'

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
  // y desde que `perfilConHistorial` lo devuelve como `null` no hace falta
  // atraparlo: antes esto iba envuelto en un `catch` que convertía en "no
  // tiene perfil" cualquier error `permanente` de la consulta, incluidos los
  // que no significan eso.
  const datos = await perfilConHistorial(db, organizationId, marca)

  return (
    <div className="p-6">
      <h1 className="mb-4 text-xl font-semibold text-gray-900">Perfil de marca</h1>

      {/*
        Sin perfil no se muestra un estado vacío que remita al CLI, sino el
        mismo editor con la plantilla dentro: es el paso siguiente a crear la
        marca, y sin perfil no se genera ni estrategia ni grilla. La plantilla
        valida contra el esquema —para que editarla no empiece con una lista de
        reglas rotas—, pero guardarla **sin tocar** se rechaza: un perfil de
        relleno se le pasa igual al modelo y esa corrida se paga.
      */}
      {!datos && (
        <p className="mb-3 rounded border border-amber-300 bg-amber-50 p-3 text-sm text-amber-900">
          La marca {marca} todavía no tiene perfil. Reemplaza el texto de la plantilla por
          el de la marca y guarda: eso crea la versión 1. Sin perfil no se puede generar
          ni la estrategia ni la grilla.
        </p>
      )}

      <EditorDePerfil
        marca={marca}
        version={datos?.version ?? 0}
        perfil={datos?.perfil ?? PLANTILLA_DE_PERFIL}
        versiones={datos?.versiones ?? []}
      />
    </div>
  )
}
