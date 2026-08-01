import type { ReactNode } from 'react'
import { NavDeSeccion } from './nav-de-seccion.js'

/**
 * El encabezado con el selector de marca ya vive en el layout raíz
 * (`app/layout.tsx`, Task 2): este layout no lo repite, solo agrega la
 * navegación de sección (Grilla / Perfil / Estrategia) por debajo, propia de
 * cualquier ruta bajo `[marca]`.
 */
export default async function LayoutDeMarca({
  children,
  params,
}: {
  children: ReactNode
  params: Promise<{ marca: string }>
}) {
  const { marca } = await params

  return (
    <div>
      <div className="border-b bg-gray-50 px-4 py-2">
        <NavDeSeccion marca={marca} />
      </div>
      {children}
    </div>
  )
}
