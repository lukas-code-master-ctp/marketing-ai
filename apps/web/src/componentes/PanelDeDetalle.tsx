'use client'

import { useEffect, useRef } from 'react'
import type { SlotDeLaGrilla } from '@gc/operaciones'

/**
 * Panel de solo lectura con el detalle completo de un slot. La Task 5 le
 * agrega botones de acción (aprobar, descartar, etc.); acá solo muestra
 * información.
 *
 * Es un diálogo modal de verdad, no solo visualmente: `role="dialog"` +
 * `aria-modal` para que un lector de pantalla lo anuncie como tal, foco
 * movido adentro al abrirse (y de nuevo cada vez que cambia el slot
 * mostrado, p. ej. al navegar al padre), y Escape para cerrarlo. Devolver
 * el foco a la ficha que lo abrió es responsabilidad de quien controla
 * `onCerrar` (`RejillaDelMes`), porque este componente no sabe qué elemento
 * lo disparó.
 */
export function PanelDeDetalle({
  slot,
  padre,
  onCerrar,
  onVerPadre,
}: {
  slot: SlotDeLaGrilla
  padre?: SlotDeLaGrilla | undefined
  onCerrar: () => void
  onVerPadre: (id: string) => void
}) {
  const contenedorRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    contenedorRef.current?.focus()
  }, [slot.id])

  useEffect(() => {
    function alTecla(e: KeyboardEvent) {
      if (e.key === 'Escape') onCerrar()
    }
    document.addEventListener('keydown', alTecla)
    return () => document.removeEventListener('keydown', alTecla)
  }, [onCerrar])

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4"
      onClick={onCerrar}
    >
      <div
        ref={contenedorRef}
        role="dialog"
        aria-modal="true"
        aria-label={`${slot.canal}: ${slot.pilar}`}
        tabIndex={-1}
        className="max-h-[85vh] w-full max-w-lg overflow-y-auto rounded-lg bg-white p-6 shadow-xl outline-none"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="mb-4 flex items-start justify-between gap-4">
          <div>
            <p className="text-xs font-medium uppercase tracking-wide text-gray-500">
              {slot.canal} · {slot.formato}
            </p>
            <h2 className="text-lg font-semibold text-gray-900">{slot.pilar}</h2>
            <p className="text-sm text-gray-500">
              {slot.fecha} · {slot.hora}
            </p>
          </div>
          <button
            type="button"
            onClick={onCerrar}
            aria-label="Cerrar"
            className="shrink-0 text-gray-400 hover:text-gray-700"
          >
            ✕
          </button>
        </div>

        {slot.descartado && (
          <p className="mb-3 inline-block rounded bg-gray-100 px-2 py-0.5 text-xs font-medium text-gray-500">
            Descartado
          </p>
        )}

        <p className="mb-1 text-sm font-medium text-gray-700">Ángulo</p>
        <p className="mb-4 text-sm text-gray-800">{slot.angulo}</p>

        <p className="mb-1 text-sm font-medium text-gray-700">Brief</p>
        <p className="whitespace-pre-wrap text-sm text-gray-800">{slot.brief}</p>

        {slot.esDerivado && padre && (
          <button
            type="button"
            onClick={() => onVerPadre(padre.id)}
            className="mt-4 text-sm text-indigo-600 underline hover:text-indigo-800"
          >
            Ver publicación original ({padre.canal} · {padre.fecha})
          </button>
        )}
      </div>
    </div>
  )
}
