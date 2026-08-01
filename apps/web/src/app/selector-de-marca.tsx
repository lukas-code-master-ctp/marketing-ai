'use client'

import Link from 'next/link'
import { usePathname } from 'next/navigation'
import type { MarcaListada } from '../datos.js'

/**
 * Un enlace por marca que reescribe la ruta actual conservando la sección y
 * el mes: si estás en /parcelas/grilla/2026-08, cambiar de marca lleva a
 * /otra-marca/grilla/2026-08, no a su inicio.
 */
export function SelectorDeMarca({ marcas }: { marcas: MarcaListada[] }) {
  const pathname = usePathname()
  const resto = pathname.split('/').filter(Boolean).slice(1)

  return (
    <nav className="flex gap-4">
      {marcas.map((marca) => (
        <Link key={marca.id} href={`/${[marca.slug, ...resto].join('/')}`}>
          {marca.name}
        </Link>
      ))}
    </nav>
  )
}
