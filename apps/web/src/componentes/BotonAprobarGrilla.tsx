'use client'

import { useState } from 'react'
import { aprobarGrillaAccion } from '../acciones.js'

/**
 * Botón de aprobar en la cabecera de la grilla. Solo se renderiza cuando
 * `page.tsx` decide que el estado es `borrador`; tras aprobar, la Server
 * Action revalida la ruta y el servidor vuelve a renderizar la página con
 * `estado === 'aprobada'`, lo que hace desaparecer este botón sin estado
 * local que lo controle.
 *
 * Pide confirmación porque aprobar es una puerta de un solo sentido desde
 * esta pantalla: con la grilla aprobada, editar y descartar dejan de estar
 * disponibles y el motor tampoco la regenera. Volver atrás existe, pero solo
 * por línea de comandos, así que la confirmación lo dice explícitamente en
 * vez de dejar al usuario buscándolo.
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
  const [confirmando, setConfirmando] = useState(false)
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
    setConfirmando(false)
  }

  return (
    <div className="flex flex-col items-end gap-1">
      {!confirmando ? (
        <button
          type="button"
          onClick={() => setConfirmando(true)}
          className="rounded bg-indigo-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-indigo-700"
        >
          Aprobar grilla
        </button>
      ) : (
        <div className="max-w-sm rounded border border-amber-300 bg-amber-50 p-3 text-left text-sm text-amber-900">
          <p className="mb-2">
            Aprobar la grilla de {mes} la deja fija: sus publicaciones dejan de poder editarse o
            descartarse, y el mes ya no se regenera. Desde esta pantalla no se puede deshacer;
            para volver a borrador hay que usar{' '}
            <code className="rounded bg-amber-100 px-1.5 py-0.5 text-xs">
              pnpm cli grilla:reabrir --marca {marca} --mes {mes}
            </code>
          </p>
          <div className="flex flex-wrap gap-2">
            <button
              type="button"
              disabled={ocupado}
              onClick={() => void aprobar()}
              className="rounded bg-indigo-600 px-2 py-1 text-xs font-medium text-white hover:bg-indigo-700 disabled:opacity-50"
            >
              Sí, aprobar
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
            <button type="button" onClick={() => void aprobar()} className="font-medium underline">
              Reintentar
            </button>
          )}
        </div>
      )}
    </div>
  )
}
