'use client'

import { useState } from 'react'
import { generarPiezasAccion } from '../acciones.js'

/**
 * Encola una corrida de `p3_pieza` por cada slot vigente que todavía no
 * tenga pieza ni corrida viva. Sin confirmación, a diferencia de aprobar o
 * de regenerar la grilla: generar las piezas no reemplaza nada, y
 * `encolarPiezas` ya filtra los candidatos por su cuenta.
 *
 * El disparador se deshabilita mientras la operación está en vuelo. Es la
 * única barrera práctica contra el clic doble: el docstring de
 * `encolarPiezas` (`packages/operaciones/src/corridas.ts`) advierte que dos
 * peticiones que lean el mismo conjunto de candidatos antes de escribir
 * pueden duplicar todas las corridas del mes, y la de la base exigiría una
 * migración que se decidió no hacer. Por lo mismo, a diferencia del
 * «Reintentar» de `BotonAprobarGrilla` y `BotonReabrirGrilla` —registrado
 * como deuda por no llevar `disabled`—, el de aquí sí lo lleva.
 */
export function BotonGenerarPiezas({ marca, mes }: { marca: string; mes: string }) {
  const [ocupado, setOcupado] = useState(false)
  const [error, setError] = useState<{ mensaje: string; reintentable: boolean } | null>(null)

  async function generar() {
    setOcupado(true)
    setError(null)

    const resultado = await generarPiezasAccion(marca, mes)
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
        onClick={() => void generar()}
        className="rounded bg-indigo-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-indigo-700 disabled:opacity-50"
      >
        Generar las piezas
      </button>
      {error && (
        <div className="max-w-xs rounded border border-red-300 bg-red-50 p-2 text-right text-xs text-red-800">
          <p>{error.mensaje}</p>
          {error.reintentable && (
            <button
              type="button"
              // `generar()` limpia `error` en el mismo `setState` que marca
              // `ocupado`, así que este botón desaparece del documento en el
              // instante en que se lo pulsa — no llega a quedar en pantalla
              // deshabilitado. El atributo va igual, por consistencia con el
              // disparador principal y para no dejar este componente nuevo
              // con el mismo hueco que `pendientes.md` ya registró en
              // `BotonAprobarGrilla`, `BotonReabrirGrilla` y `EditorDePerfil`.
              disabled={ocupado}
              onClick={() => void generar()}
              className="font-medium underline disabled:opacity-50"
            >
              Reintentar
            </button>
          )}
        </div>
      )}
    </div>
  )
}
