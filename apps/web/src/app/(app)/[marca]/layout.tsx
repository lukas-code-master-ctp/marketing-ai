import { notFound } from 'next/navigation'
import { ErrorDeDominio } from '@gc/shared'
import { resolverMarca } from '@gc/operaciones'
import type { ReactNode } from 'react'
import { conexion, organizacionPorDefecto } from '../../../datos.js'
import { NavDeSeccion } from './nav-de-seccion.js'

// El layout consulta la base para resolver la marca, así que tampoco puede
// prerenderizarse en el build. Las tres páginas de abajo ya lo declaran; esto
// lo deja dicho también en el segmento que introduce la consulta.
export const dynamic = 'force-dynamic'

/**
 * El encabezado con el selector de marca ya vive en el layout del grupo
 * `(app)` (`app/(app)/layout.tsx`): este layout no lo repite, solo agrega la
 * navegación de sección (Grilla / Perfil / Estrategia) por debajo, propia de
 * cualquier ruta bajo `[marca]`.
 *
 * También es donde se resuelve la marca, una sola vez para las tres páginas.
 * Antes cada una hacía lo suyo con un slug que no existe —un marcador viejo
 * después de renombrar una marca alcanza para llegar acá—: la grilla y la
 * estrategia reventaban con la página de error de Next, y el perfil pintaba
 * el mensaje del dominio en la página. Un mismo fallo con tres respuestas en
 * tres pantallas que comparten este layout. Ahora es una: 404.
 */
export default async function LayoutDeMarca({
  children,
  params,
}: {
  children: ReactNode
  params: Promise<{ marca: string }>
}) {
  const { marca } = await params

  const db = conexion()
  try {
    await resolverMarca(db, await organizacionPorDefecto(db), marca)
  } catch (error) {
    // Solo un `permanente` significa "esta marca no existe". Un fallo
    // transitorio de la base se propaga: contestar 404 ahí diría que la marca
    // no existe cuando lo que pasó es que no se pudo comprobar.
    if (error instanceof ErrorDeDominio && error.clase === 'permanente') notFound()
    throw error
  }

  return (
    <div>
      <div className="border-b bg-gray-50 px-4 py-2">
        <NavDeSeccion marca={marca} />
      </div>
      {children}
    </div>
  )
}
