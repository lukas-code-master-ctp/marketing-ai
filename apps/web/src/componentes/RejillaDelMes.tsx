'use client'

import { useRef, useState } from 'react'
import type { EstadoDeGrilla, SlotDeLaGrilla } from '@gc/operaciones'
import { derivadosVigentesDe, slotsFueraDeLaRejilla } from '../calendario.js'
import { FichaDeSlot } from './FichaDeSlot.js'
import { PanelDeDetalle } from './PanelDeDetalle.js'

const DIAS_DE_LA_SEMANA = ['Lun', 'Mar', 'Mié', 'Jue', 'Vie', 'Sáb', 'Dom']

/**
 * Grilla mensual: una celda por día, con las fichas que le corresponden.
 * Los días de relleno de meses vecinos (los que no empiezan con `${mes}-`)
 * van apagados. Guarda qué slot está seleccionado para mostrar su
 * `PanelDeDetalle`, incluida la navegación al padre de un derivado.
 */
export function RejillaDelMes({
  marca,
  mes,
  estado,
  semanas,
  slots,
}: {
  marca: string
  mes: string
  estado: EstadoDeGrilla
  semanas: string[][]
  slots: SlotDeLaGrilla[]
}) {
  const [seleccionadoId, setSeleccionadoId] = useState<string | null>(null)
  // La ficha que abrió el panel, para devolverle el foco al cerrarlo. Navegar
  // al padre desde dentro del panel no la cambia: el disparador sigue siendo
  // la ficha original que el usuario pulsó.
  const disparadorRef = useRef<HTMLButtonElement | null>(null)

  function abrir(id: string, elemento: HTMLButtonElement) {
    disparadorRef.current = elemento
    setSeleccionadoId(id)
  }

  function cerrar() {
    setSeleccionadoId(null)
    disparadorRef.current?.focus()
    disparadorRef.current = null
  }

  const porId = new Map(slots.map((s) => [s.id, s]))
  const porFecha = new Map<string, SlotDeLaGrilla[]>()
  for (const s of slots) {
    const lista = porFecha.get(s.fecha) ?? []
    lista.push(s)
    porFecha.set(s.fecha, lista)
  }

  const seleccionado = seleccionadoId ? porId.get(seleccionadoId) : undefined
  const padreDelSeleccionado = seleccionado?.idDelPadre
    ? porId.get(seleccionado.idDelPadre)
    : undefined
  // La derivación vive en `calendario.ts` y tiene pruebas propias: de ella
  // depende qué filas escribe el "descartar también los derivados", y el
  // renderizado no se prueba.
  const derivadosVigentesDelSeleccionado = seleccionado
    ? derivadosVigentesDe(slots, seleccionado.id)
    : []

  // Un slot cuya fecha no cae en ninguna celda existía y contaba en la
  // cabecera, pero no se veía por ningún lado. No debería ocurrir —la
  // generación valida que las fechas caigan en el mes— pero si ocurre, es
  // preferible verlo que perderlo.
  const fueraDeLaRejilla = slotsFueraDeLaRejilla(slots, semanas)

  return (
    <div>
      <div className="grid grid-cols-7 gap-px overflow-hidden rounded border border-gray-200 bg-gray-200 text-sm">
        {DIAS_DE_LA_SEMANA.map((dia) => (
          <div key={dia} className="bg-gray-100 px-2 py-1 text-center font-medium text-gray-600">
            {dia}
          </div>
        ))}
        {semanas.flat().map((fecha) => {
          const esDelMes = fecha.startsWith(`${mes}-`)
          const slotsDelDia = porFecha.get(fecha) ?? []
          return (
            // `data-fecha` además de `key`: React no emite la `key` al DOM, así
            // que sin él no hay forma de afirmar en qué celda cayó cada ficha y
            // una rejilla que ignorara la fecha pasaría las pruebas.
            <div
              key={fecha}
              data-fecha={fecha}
              className={`min-h-28 p-1.5 ${esDelMes ? 'bg-white' : 'bg-gray-50'}`}
            >
              <div className={`mb-1 text-xs ${esDelMes ? 'text-gray-500' : 'text-gray-300'}`}>
                {Number(fecha.slice(-2))}
              </div>
              <div className="flex flex-col gap-1">
                {slotsDelDia.map((slot) => (
                  <FichaDeSlot key={slot.id} slot={slot} onSeleccionar={abrir} />
                ))}
              </div>
            </div>
          )
        })}
      </div>

      {fueraDeLaRejilla.length > 0 && (
        <section className="mt-4 rounded border border-amber-300 bg-amber-50 p-3">
          <h2 className="mb-2 text-sm font-semibold text-amber-900">
            {fueraDeLaRejilla.length === 1
              ? '1 publicación cae fuera de '
              : `${fueraDeLaRejilla.length} publicaciones caen fuera de `}
            {mes}
          </h2>
          <p className="mb-2 text-xs text-amber-800">
            Su fecha no corresponde a ningún día de este calendario, así que no aparece arriba. Si
            no está descartada, sí cuenta en los totales de la cabecera.
          </p>
          <div className="flex flex-col gap-2">
            {fueraDeLaRejilla.map((s) => (
              <div key={s.id} className="flex flex-col gap-0.5">
                <span className="text-xs text-amber-900">{s.fecha}</span>
                <FichaDeSlot slot={s} onSeleccionar={abrir} />
              </div>
            ))}
          </div>
        </section>
      )}

      {seleccionado && (
        <PanelDeDetalle
          slot={seleccionado}
          padre={padreDelSeleccionado}
          marca={marca}
          mes={mes}
          estado={estado}
          derivadosVigentes={derivadosVigentesDelSeleccionado}
          onCerrar={cerrar}
          onVerPadre={setSeleccionadoId}
        />
      )}
    </div>
  )
}
