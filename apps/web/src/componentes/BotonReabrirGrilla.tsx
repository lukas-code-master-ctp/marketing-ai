'use client'

import { useState } from 'react'
import { reabrirGrillaAccion } from '../acciones.js'

/**
 * La puerta de vuelta de la aprobación. Solo se renderiza cuando `page.tsx`
 * decide que el estado es `aprobada`; tras reabrir, la Server Action revalida
 * la ruta y el servidor vuelve a renderizar con `estado === 'borrador'`, lo
 * que hace desaparecer este botón sin estado local que lo controle.
 *
 * Pide confirmación por simetría con `BotonAprobarGrilla`, no porque reabrir
 * sea destructivo: no lo es. Lo que dice la confirmación es lo que sí importa
 * —que la grilla vuelve a ser regenerable por el motor— porque regenerar sí
 * reemplaza los slots, y con ellos cualquier pieza que colgara de ellos (el
 * `ON DELETE CASCADE` de la migración `0008`). `piezasEscritas` —el
 * `resumenPiezas.listas` que `page.tsx` ya calculó— es lo que permite
 * nombrar ese costo aquí: reabrir por sí solo no borra nada, pero deja la
 * puerta abierta a un "Regenerar grilla" que sí lo hace, y quien reabre
 * necesita saberlo antes, no después.
 */
export function BotonReabrirGrilla({
  marca,
  mes,
  piezasEscritas,
}: {
  marca: string
  mes: string
  piezasEscritas: number
}) {
  const [confirmando, setConfirmando] = useState(false)
  const [ocupado, setOcupado] = useState(false)
  const [error, setError] = useState<{ mensaje: string; reintentable: boolean } | null>(null)

  async function reabrir() {
    setOcupado(true)
    setError(null)

    const resultado = await reabrirGrillaAccion(marca, mes)
    if (!resultado.ok) {
      setError({ mensaje: resultado.mensaje, reintentable: resultado.reintentable })
      setOcupado(false)
      return
    }

    setOcupado(false)
    setConfirmando(false)
  }

  return (
    <div className="flex flex-col items-end gap-1">
      {!confirmando ? (
        <button
          type="button"
          onClick={() => setConfirmando(true)}
          className="rounded border border-gray-300 px-3 py-1.5 text-sm font-medium text-gray-700 hover:bg-gray-50"
        >
          Reabrir grilla
        </button>
      ) : (
        <div className="max-w-sm rounded border border-amber-300 bg-amber-50 p-3 text-left text-sm text-amber-900">
          <p className="mb-2">
            Reabrir la grilla de {mes} la devuelve a borrador: sus publicaciones vuelven a poder
            editarse y descartarse, y el motor vuelve a poder regenerar el mes — lo que reemplaza
            los slots que haya
            {piezasEscritas > 0
              ? ` y borra ${
                  piezasEscritas === 1
                    ? 'la pieza que ya escribiste'
                    : `las ${piezasEscritas} piezas que ya escribiste`
                }, que volver a generar paga otra vez`
              : ''}
            .
          </p>
          <div className="flex flex-wrap gap-2">
            <button
              type="button"
              disabled={ocupado}
              onClick={() => void reabrir()}
              className="rounded bg-indigo-600 px-2 py-1 text-xs font-medium text-white hover:bg-indigo-700 disabled:opacity-50"
            >
              Sí, reabrir
            </button>
            <button
              type="button"
              disabled={ocupado}
              onClick={() => {
                setConfirmando(false)
                setError(null)
              }}
              className="rounded px-2 py-1 text-xs font-medium text-amber-700 hover:bg-amber-100 disabled:opacity-50"
            >
              Cancelar
            </button>
          </div>
        </div>
      )}
      {error && (
        <div className="max-w-xs rounded border border-red-300 bg-red-50 p-2 text-right text-xs text-red-800">
          <p>{error.mensaje}</p>
          {error.reintentable && (
            <button type="button" onClick={() => void reabrir()} className="font-medium underline">
              Reintentar
            </button>
          )}
        </div>
      )}
    </div>
  )
}
