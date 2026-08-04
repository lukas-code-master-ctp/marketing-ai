'use client'

import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { mesActual } from '../calendario.js'
import type { MarcaListada } from '../datos.js'

/**
 * Un enlace por marca que reescribe la ruta actual conservando la sección y
 * el mes: si estás en /parcelas/grilla/2026-08, cambiar de marca lleva a
 * /otra-marca/grilla/2026-08, no a su inicio.
 *
 * Cuando la ruta actual **no tiene sección** —`/` y `/?nueva`— el enlace cae a
 * la grilla del mes de hoy, que es lo mismo a lo que redirige `/`. Antes se
 * armaba solo con el slug y quedaba `/{slug}`, que no existe: no hay
 * `app/[marca]/page.tsx`, así que respondía 404. Era un defecto viejo pero
 * inalcanzable —con marcas, `/` redirigía antes de pintar el selector; sin
 * marcas, no había enlaces— hasta que `?nueva` puso esa ruta en el camino
 * feliz, y es justo la pantalla desde la que hay que poder volver.
 *
 * Al final, el enlace para crear otra. Va acá porque `/` redirige a la grilla
 * en cuanto existe una marca, así que el formulario no tendría cómo alcanzarse
 * a partir de la primera.
 */
export function SelectorDeMarca({ marcas }: { marcas: MarcaListada[] }) {
  const pathname = usePathname()
  const partes = pathname.split('/').filter(Boolean)
  const marcaActiva = partes[0]
  const seccion = partes.slice(1)
  const resto = seccion.length > 0 ? seccion : ['grilla', mesActual()]

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
