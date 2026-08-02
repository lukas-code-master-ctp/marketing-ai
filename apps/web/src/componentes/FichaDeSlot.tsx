'use client'

import type { SlotDeLaGrilla } from '@gc/operaciones'

/**
 * Ficha de un slot dentro de un día de la grilla. Es un componente de
 * cliente porque abre el panel de detalle al pulsarla; el estado de qué
 * slot está seleccionado vive en `RejillaDelMes`, que es quien pasa
 * `onSeleccionar`.
 */
export function FichaDeSlot({
  slot,
  onSeleccionar,
}: {
  slot: SlotDeLaGrilla
  onSeleccionar: (id: string, elemento: HTMLButtonElement) => void
}) {
  const base = 'w-full rounded border px-1.5 py-1 text-left text-xs leading-tight transition-colors'
  const estilo = slot.descartado
    ? `${base} border-gray-200 bg-gray-50 text-gray-400 line-through`
    : slot.esDerivado
      ? `${base} border-indigo-200 bg-indigo-50 text-indigo-900 hover:bg-indigo-100`
      : `${base} border-blue-200 bg-blue-50 text-blue-900 hover:bg-blue-100`

  return (
    <button
      type="button"
      onClick={(e) => onSeleccionar(slot.id, e.currentTarget)}
      className={estilo}
    >
      <span className="block truncate font-semibold">
        {slot.esDerivado ? '↳ ' : ''}
        {slot.canal}
      </span>
      <span className="block truncate opacity-80">{slot.pilar}</span>
      <span className="block truncate opacity-70">{slot.angulo}</span>
    </button>
  )
}
