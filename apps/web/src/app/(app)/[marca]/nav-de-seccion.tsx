'use client'

import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { mesActual } from '../../../calendario.js'

const SECCIONES = [
  { segmento: 'grilla', etiqueta: 'Grilla' },
  { segmento: 'perfil', etiqueta: 'Perfil' },
  { segmento: 'estrategia', etiqueta: 'Estrategia' },
] as const

/**
 * Navegación entre las secciones de una marca. Solo Grilla existe hoy;
 * Perfil y Estrategia quedan enlazadas para cuando las tareas siguientes las
 * implementen. Como este layout solo recibe el segmento `marca` (Perfil y
 * Estrategia no llevan mes en la ruta), el enlace a Grilla reutiliza el mes
 * de la URL actual cuando ya estás ahí, y cae al mes de hoy en cualquier
 * otra sección.
 */
export function NavDeSeccion({ marca }: { marca: string }) {
  const pathname = usePathname()
  const partes = pathname.split('/').filter(Boolean)
  const seccionActiva = partes[1]
  const mes = seccionActiva === 'grilla' && partes[2] ? partes[2] : mesActual()

  return (
    <nav className="flex gap-4 text-sm">
      {SECCIONES.map((s) => {
        const href = s.segmento === 'grilla' ? `/${marca}/grilla/${mes}` : `/${marca}/${s.segmento}`
        const activa = seccionActiva === s.segmento
        return (
          <Link
            key={s.segmento}
            href={href}
            aria-current={activa ? 'page' : undefined}
            className={activa ? 'font-semibold text-gray-900' : 'text-gray-500 hover:text-gray-800'}
          >
            {s.etiqueta}
          </Link>
        )
      })}
    </nav>
  )
}
