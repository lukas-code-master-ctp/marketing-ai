'use client'

import { useState } from 'react'
import { encolarEstrategiaAccion, encolarGrillaAccion } from '../acciones.js'

/**
 * Encola y devuelve. No espera al modelo: la pantalla se refresca sola y el
 * `EstadoDeCorrida` toma el relevo mostrando el avance.
 *
 * `advertencia`, cuando viene, obliga a confirmar. Lo usa la grilla para decir
 * que regenerar reemplaza los slots y pierde los descartes.
 */
export function BotonGenerar({
  marca,
  periodo,
  que,
  etiqueta,
  advertencia,
}: {
  marca: string
  periodo: string
  que: 'estrategia' | 'grilla'
  etiqueta: string
  advertencia?: string | undefined
}) {
  const [confirmando, setConfirmando] = useState(false)
  const [ocupado, setOcupado] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function generar() {
    setOcupado(true)
    setError(null)
    const r =
      que === 'grilla'
        ? await encolarGrillaAccion(marca, periodo)
        : await encolarEstrategiaAccion(marca, periodo)
    if (!r.ok) setError(r.mensaje)
    setOcupado(false)
    setConfirmando(false)
  }

  if (advertencia && confirmando) {
    return (
      <div className="max-w-sm rounded border border-amber-300 bg-amber-50 p-3 text-left text-sm text-amber-900">
        <p className="mb-2">{advertencia}</p>
        <div className="flex flex-wrap gap-2">
          <button
            type="button"
            disabled={ocupado}
            onClick={() => void generar()}
            className="rounded bg-indigo-600 px-2 py-1 text-xs font-medium text-white hover:bg-indigo-700 disabled:opacity-50"
          >
            Sí, generar
          </button>
          <button
            type="button"
            disabled={ocupado}
            onClick={() => setConfirmando(false)}
            className="rounded px-2 py-1 text-xs font-medium text-amber-700 hover:bg-amber-100 disabled:opacity-50"
          >
            Cancelar
          </button>
        </div>
        {error && <p className="mt-2 text-xs text-red-800">{error}</p>}
      </div>
    )
  }

  return (
    <div className="flex flex-col items-end gap-1">
      <button
        type="button"
        disabled={ocupado}
        onClick={() => (advertencia ? setConfirmando(true) : void generar())}
        className="rounded bg-indigo-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-indigo-700 disabled:opacity-50"
      >
        {etiqueta}
      </button>
      {error && <p className="text-xs text-red-800">{error}</p>}
    </div>
  )
}
