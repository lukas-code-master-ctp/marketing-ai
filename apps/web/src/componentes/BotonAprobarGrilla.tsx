'use client'

import { useState } from 'react'
import { aprobarGrillaAccion } from '../acciones.js'

/**
 * Botón de aprobar en la cabecera de la grilla. Solo se renderiza cuando
 * `page.tsx` decide que el estado es `borrador`; tras aprobar, la Server
 * Action revalida la ruta y el servidor vuelve a renderizar la página con
 * `estado === 'aprobada'`, lo que hace desaparecer este botón sin estado
 * local que lo controle.
 */
export function BotonAprobarGrilla({
  marca,
  mes,
  contentPlanId,
}: {
  marca: string
  mes: string
  contentPlanId: string
}) {
  const [ocupado, setOcupado] = useState(false)
  const [error, setError] = useState<{ mensaje: string; reintentable: boolean } | null>(null)

  async function aprobar() {
    setOcupado(true)
    setError(null)

    const resultado = await aprobarGrillaAccion(marca, mes, contentPlanId)
    if (!resultado.ok) {
      setError({ mensaje: resultado.mensaje, reintentable: resultado.reintentable })
      setOcupado(false)
      return
    }

    setOcupado(false)
  }

  return (
    <div className="flex flex-col items-end gap-1">
      <button
        type="button"
        disabled={ocupado}
        onClick={() => void aprobar()}
        className="rounded bg-indigo-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-indigo-700 disabled:opacity-50"
      >
        Aprobar grilla
      </button>
      {error && (
        <div className="max-w-xs rounded border border-red-300 bg-red-50 p-2 text-right text-xs text-red-800">
          <p>{error.mensaje}</p>
          {error.reintentable && (
            <button type="button" onClick={() => void aprobar()} className="font-medium underline">
              Reintentar
            </button>
          )}
        </div>
      )}
    </div>
  )
}
