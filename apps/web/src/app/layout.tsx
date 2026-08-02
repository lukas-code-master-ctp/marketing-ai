import type { ReactNode } from 'react'
import { conexion, marcasDeLaOrganizacion, organizacionPorDefecto } from '../datos.js'
import './globals.css'
import { SelectorDeMarca } from './selector-de-marca.js'

export default async function RaizLayout({ children }: { children: ReactNode }) {
  const db = conexion()
  const marcas = await marcasDeLaOrganizacion(db, await organizacionPorDefecto(db))

  return (
    <html lang="es">
      <body>
        <header className="p-4 border-b">
          <SelectorDeMarca marcas={marcas} />
        </header>
        {children}
      </body>
    </html>
  )
}
