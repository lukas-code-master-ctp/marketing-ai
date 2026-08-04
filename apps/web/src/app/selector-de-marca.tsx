'use client'

import Link from 'next/link'
import { usePathname } from 'next/navigation'
import type { MarcaListada } from '../datos.js'

/**
 * Un enlace por marca que reescribe la ruta actual conservando la sección y
 * el mes: si estás en /parcelas/grilla/2026-08, cambiar de marca lleva a
 * /otra-marca/grilla/2026-08, no a su inicio.
 *
 * Al final, el enlace para crear otra. Va acá porque `/` redirige a la grilla
 * en cuanto existe una marca, así que el formulario no tendría cómo alcanzarse
 * a partir de la primera.
 */
export function SelectorDeMarca({ marcas }: { marcas: MarcaListada[] }) {
  const pathname = usePathname()
  const partes = pathname.split('/').filter(Boolean)
  const marcaActiva = partes[0]
  const resto = partes.slice(1)

  return (
    <nav className="flex gap-4">
      {marcas.map((marca) => {
        const activa = marca.slug === marcaActiva
        return (
          <Link
            key={marca.id}
            href={`/${[marca.slug, ...resto].join('/')}`}
            aria-current={activa ? 'page' : undefined}
            className={activa ? 'font-semibold text-gray-900' : 'text-gray-500 hover:text-gray-800'}
          >
            {marca.name}
          </Link>
        )
      })}
      <Link href="/?nueva=1" className="text-gray-500 hover:text-gray-800">
        + Nueva marca
      </Link>
    </nav>
  )
}
