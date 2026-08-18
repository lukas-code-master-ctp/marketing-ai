'use client'

import { useEffect, useRef, useState } from 'react'
import type { EstadoDeGrilla, SlotDeLaGrilla } from '@gc/operaciones'
// De `@gc/strategy` y no de `@gc/db`: este es un componente de cliente, y el
// barril de `@gc/db` arrastra el conector de Cloud SQL al bundle del
// navegador (ver la cabecera de `PiezaGenerada.tsx`).
import type { TipoPieza } from '@gc/strategy'
import { descartarSlotAccion, editarSlotAccion } from '../acciones.js'
import { PiezaGenerada } from './PiezaGenerada.js'

/** Para la frase «La grilla de 2026-09 está …», no para una etiqueta suelta. */
const ESTADO_EN_PROSA: Record<EstadoDeGrilla, string> = {
  borrador: 'en borrador',
  aprobada: 'aprobada',
  en_ejecucion: 'en ejecución',
  cerrada: 'cerrada',
}

/**
 * Panel de solo lectura con el detalle completo de un slot, más los botones
 * de acción de la Task 5: editar (ángulo y brief) y descartar.
 *
 * `derivadosVigentes` llega ya calculado por `RejillaDelMes` — un filtro
 * sobre `idDelPadre` de los slots que ya están cargados en la página, sin
 * consulta extra — y solo importa cuando el slot mostrado es un padre no
 * derivado. Si tiene alguno, descartar pide confirmación explícita: dice
 * cuántos quedarán activos y ofrece descartarlos también, lo que dispara una
 * acción por slot en vez de una cascada implícita.
 *
 * Es un diálogo modal de verdad, no solo visualmente: `role="dialog"` +
 * `aria-modal` para que un lector de pantalla lo anuncie como tal, foco
 * movido adentro al abrirse (y de nuevo cada vez que cambia el slot
 * mostrado, p. ej. al navegar al padre), y Escape para cerrarlo. Devolver
 * el foco a la ficha que lo abrió es responsabilidad de quien controla
 * `onCerrar` (`RejillaDelMes`), porque este componente no sabe qué elemento
 * lo disparó.
 *
 * Fuera de `borrador` los botones de acción no se renderizan —no se
 * deshabilitan— porque `descartarSlot` y `editarSlot` ya rechazan esas
 * escrituras: un botón deshabilitado prometería que existe una forma de
 * habilitarlo desde aquí, y no la hay. El panel dice por qué en su lugar.
 */
export function PanelDeDetalle({
  slot,
  padre,
  marca,
  mes,
  estado,
  derivadosVigentes,
  pieza,
  onCerrar,
  onVerPadre,
}: {
  slot: SlotDeLaGrilla
  padre?: SlotDeLaGrilla | undefined
  marca: string
  mes: string
  estado: EstadoDeGrilla
  derivadosVigentes: SlotDeLaGrilla[]
  pieza?: TipoPieza | undefined
  onCerrar: () => void
  onVerPadre: (id: string) => void
}) {
  const contenedorRef = useRef<HTMLDivElement>(null)
  const editable = estado === 'borrador'

  const [modo, setModo] = useState<'ver' | 'editar'>('ver')
  const [angulo, setAngulo] = useState(slot.angulo)
  const [brief, setBrief] = useState(slot.brief)
  const [confirmandoDescarte, setConfirmandoDescarte] = useState(false)
  const [ocupado, setOcupado] = useState(false)
  const [error, setError] = useState<{ mensaje: string; reintentable: boolean } | null>(null)
  // Qué se pidió en el intento que falló, para que "Reintentar" repita
  // exactamente eso — incluidos los derivados si el usuario los había pedido —
  // en vez de degradar silenciosamente a "descartar solo este".
  const [ultimoIntentoIncluyoDerivados, setUltimoIntentoIncluyoDerivados] = useState(false)

  useEffect(() => {
    contenedorRef.current?.focus()
  }, [slot.id])

  // Cambiar de slot (p. ej. al navegar al padre) descarta cualquier edición
  // o confirmación pendiente del anterior — `ultimoIntentoIncluyoDerivados`
  // incluido: hoy no queda accesible porque el error se limpia junto con él,
  // pero es memoria del slot anterior y pertenece a este barrido por el mismo
  // motivo que sus hermanos.
  useEffect(() => {
    setModo('ver')
    setAngulo(slot.angulo)
    setBrief(slot.brief)
    setConfirmandoDescarte(false)
    setError(null)
    setUltimoIntentoIncluyoDerivados(false)
  }, [slot.id, slot.angulo, slot.brief])

  useEffect(() => {
    function alTecla(e: KeyboardEvent) {
      if (e.key === 'Escape') onCerrar()
    }
    document.addEventListener('keydown', alTecla)
    return () => document.removeEventListener('keydown', alTecla)
  }, [onCerrar])

  async function descartar(incluirDerivados: boolean) {
    setOcupado(true)
    setError(null)
    setUltimoIntentoIncluyoDerivados(incluirDerivados)

    const resultado = await descartarSlotAccion(marca, mes, slot.id)
    if (!resultado.ok) {
      setError({ mensaje: resultado.mensaje, reintentable: resultado.reintentable })
      setOcupado(false)
      return
    }

    if (incluirDerivados) {
      for (const derivado of derivadosVigentes) {
        const r = await descartarSlotAccion(marca, mes, derivado.id)
        if (!r.ok) {
          setError({ mensaje: r.mensaje, reintentable: r.reintentable })
          setOcupado(false)
          return
        }
      }
    }

    setOcupado(false)
    setConfirmandoDescarte(false)
  }

  // Único punto de entrada al descarte desde el botón simple. Mientras la
  // confirmación de derivados está abierta, este botón queda oculto (ver más
  // abajo): la única forma de disparar un descarte en ese estado es a través
  // de los botones de la propia confirmación o de "Reintentar", que ya sabe
  // qué pidió el intento anterior. Así el estado no tiene una segunda puerta
  // que pueda tirar por la borda el "también los derivados" que el usuario
  // ya pidió.
  function alPulsarDescartar() {
    if (!slot.esDerivado && derivadosVigentes.length > 0) {
      setConfirmandoDescarte(true)
      return
    }
    void descartar(false)
  }

  async function guardarEdicion() {
    setOcupado(true)
    setError(null)

    const resultado = await editarSlotAccion(marca, mes, slot.id, { angulo, brief })
    if (!resultado.ok) {
      setError({ mensaje: resultado.mensaje, reintentable: resultado.reintentable })
      setOcupado(false)
      return
    }

    setOcupado(false)
    setModo('ver')
  }

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

        {modo === 'ver' ? (
          <>
            <p className="mb-1 text-sm font-medium text-gray-700">Ángulo</p>
            <p className="mb-4 text-sm text-gray-800">{slot.angulo}</p>

            <p className="mb-1 text-sm font-medium text-gray-700">Brief</p>
            <p className="whitespace-pre-wrap text-sm text-gray-800">{slot.brief}</p>

            {pieza && <PiezaGenerada pieza={pieza} />}
          </>
        ) : (
          <div className="mb-4 space-y-3">
            <div>
              <label htmlFor="campo-angulo" className="mb-1 block text-sm font-medium text-gray-700">
                Ángulo
              </label>
              {/* `minLength` es cortesía del navegador: la garantía es la
                  validación de `editarSlot` contra `SlotPropuesto`, que
                  también cubre al CLI. */}
              <input
                id="campo-angulo"
                type="text"
                minLength={5}
                value={angulo}
                onChange={(e) => setAngulo(e.target.value)}
                className="w-full rounded border border-gray-300 px-2 py-1 text-sm text-gray-800"
              />
              <p className="mt-1 text-xs text-gray-500">Mínimo 5 caracteres.</p>
            </div>
            <div>
              <label htmlFor="campo-brief" className="mb-1 block text-sm font-medium text-gray-700">
                Brief
              </label>
              <textarea
                id="campo-brief"
                minLength={20}
                value={brief}
                onChange={(e) => setBrief(e.target.value)}
                rows={4}
                className="w-full rounded border border-gray-300 px-2 py-1 text-sm text-gray-800"
              />
              <p className="mt-1 text-xs text-gray-500">Mínimo 20 caracteres.</p>
            </div>
          </div>
        )}

        {slot.esDerivado && padre && (
          <button
            type="button"
            onClick={() => onVerPadre(padre.id)}
            className="mb-4 block text-sm text-indigo-600 underline hover:text-indigo-800"
          >
            Ver publicación original ({padre.canal} · {padre.fecha})
          </button>
        )}

        {error && (
          <div className="mb-4 rounded border border-red-300 bg-red-50 p-2 text-sm text-red-800">
            <p>{error.mensaje}</p>
            {error.reintentable && (
              <button
                type="button"
                onClick={() =>
                  modo === 'editar'
                    ? void guardarEdicion()
                    : void descartar(ultimoIntentoIncluyoDerivados)
                }
                className="mt-1 font-medium underline"
              >
                Reintentar
              </button>
            )}
          </div>
        )}

        {confirmandoDescarte && (
          <div className="mb-4 rounded border border-amber-300 bg-amber-50 p-3 text-sm text-amber-900">
            <p className="mb-2">
              Esta publicación tiene {derivadosVigentes.length}{' '}
              {derivadosVigentes.length === 1 ? 'derivado activo' : 'derivados activos'}.
              Descartarla no los descarta a ellos: quedarán activos salvo que los descartes también.
            </p>
            <div className="flex flex-wrap gap-2">
              <button
                type="button"
                disabled={ocupado}
                onClick={() => void descartar(false)}
                className="rounded border border-amber-400 px-2 py-1 text-xs font-medium hover:bg-amber-100 disabled:opacity-50"
              >
                Descartar solo esta
              </button>
              <button
                type="button"
                disabled={ocupado}
                onClick={() => void descartar(true)}
                className="rounded border border-amber-400 px-2 py-1 text-xs font-medium hover:bg-amber-100 disabled:opacity-50"
              >
                Descartar también los {derivadosVigentes.length}
              </button>
              <button
                type="button"
                disabled={ocupado}
                onClick={() => setConfirmandoDescarte(false)}
                className="rounded px-2 py-1 text-xs font-medium text-amber-700 hover:bg-amber-100"
              >
                Cancelar
              </button>
            </div>
          </div>
        )}

        {!editable ? (
          <p className="border-t border-gray-100 pt-4 text-sm text-gray-500">
            La grilla de {mes} está {ESTADO_EN_PROSA[estado]} y sus publicaciones ya no se editan
            ni se descartan.
            {estado === 'aprobada' && (
              <> Para volver a editarla, usa «Reabrir grilla» en la cabecera del mes.</>
            )}
          </p>
        ) : (
          <div className="flex gap-2 border-t border-gray-100 pt-4">
            {modo === 'ver' ? (
              <>
                <button
                  type="button"
                  onClick={() => setModo('editar')}
                  className="rounded border border-gray-300 px-3 py-1.5 text-sm font-medium text-gray-700 hover:bg-gray-50"
                >
                  Editar
                </button>
                {!slot.descartado && !confirmandoDescarte && (
                  <button
                    type="button"
                    disabled={ocupado}
                    onClick={alPulsarDescartar}
                    className="rounded border border-red-300 px-3 py-1.5 text-sm font-medium text-red-700 hover:bg-red-50 disabled:opacity-50"
                  >
                    Descartar
                  </button>
                )}
              </>
            ) : (
              <>
                <button
                  type="button"
                  disabled={ocupado}
                  onClick={() => void guardarEdicion()}
                  className="rounded bg-indigo-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-indigo-700 disabled:opacity-50"
                >
                  Guardar
                </button>
                <button
                  type="button"
                  disabled={ocupado}
                  onClick={() => {
                    setModo('ver')
                    setAngulo(slot.angulo)
                    setBrief(slot.brief)
                    setError(null)
                  }}
                  className="rounded border border-gray-300 px-3 py-1.5 text-sm font-medium text-gray-700 hover:bg-gray-50 disabled:opacity-50"
                >
                  Cancelar
                </button>
              </>
            )}
          </div>
        )}
      </div>
    </div>
  )
}
