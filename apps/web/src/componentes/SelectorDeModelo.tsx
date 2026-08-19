'use client'

import type { EleccionDeNivel, ModeloDelCatalogo } from '@gc/operaciones'
import { useState } from 'react'
import { guardarModeloAccion } from '../acciones.js'

/**
 * Títulos legibles para los niveles conocidos. Un nivel nuevo que el
 * catálogo empiece a servir —el de imágenes, por ejemplo— no tiene por qué
 * romper esta pantalla: se muestra con su nombre crudo hasta que alguien
 * agregue su entrada acá.
 */
const TITULOS_DE_NIVEL: Record<string, string> = {
  razonamiento: 'Razonamiento',
  redaccion: 'Redacción',
  utilitario: 'Utilitario',
}

function formatearPrecio(precio: number): string {
  return precio.toLocaleString('es-CL', { minimumFractionDigits: 2, maximumFractionDigits: 4 })
}

/**
 * Un bloque por nivel: la explicación de para qué sirve, un selector para el
 * modelo principal y otro para el de respaldo (opcional), y el botón de
 * guardar. `page.tsx` renderiza uno de estos por cada nivel presente en el
 * catálogo (Task 5 del bloque de configuración de modelos).
 *
 * Recibe el catálogo **completo** —de todos los niveles, no solo el suyo— y
 * filtra por `nivel` acá adentro. Es lo que permite probar en aislamiento
 * que un selector no ofrezca candidatos de otro nivel: si esta pantalla
 * pasara ya filtrado, ese error solo podría medirse integrando `page.tsx`
 * entero.
 *
 * Sigue el patrón de los cuatro botones que ya existen en `componentes/`:
 * deshabilitado mientras la acción viaja, y el mensaje de error en pantalla
 * si rechaza. El botón «Reintentar» lleva `disabled`, a diferencia de los
 * cuatro botones viejos —eso quedó registrado como deuda por no llevarlo.
 */
export function SelectorDeModelo({
  nivel,
  explicacion,
  candidatos,
  eleccion,
}: {
  nivel: string
  explicacion: string
  candidatos: ModeloDelCatalogo[]
  eleccion: EleccionDeNivel | null
}) {
  const candidatosDelNivel = candidatos.filter((c) => c.nivel === nivel)

  const [principalId, setPrincipalId] = useState(eleccion?.principal.id ?? '')
  const [respaldoId, setRespaldoId] = useState(eleccion?.respaldo?.id ?? '')
  const [ocupado, setOcupado] = useState(false)
  const [error, setError] = useState<{ mensaje: string; reintentable: boolean } | null>(null)
  const [guardado, setGuardado] = useState(false)

  // Un cambio en cualquiera de los dos selectores invalida el aviso de
  // éxito: sin esto, elegir un modelo distinto después de guardar dejaría
  // «Modelo guardado.» en pantalla describiendo una elección que ya no es la
  // que se ve — mismo criterio que `versionGuardada` en `EditorDePerfil`.
  function cambiarPrincipal(id: string) {
    setPrincipalId(id)
    setGuardado(false)
  }

  function cambiarRespaldo(id: string) {
    setRespaldoId(id)
    setGuardado(false)
  }

  async function guardar() {
    setOcupado(true)
    setError(null)
    setGuardado(false)

    const resultado = await guardarModeloAccion(
      nivel,
      principalId,
      respaldoId === '' ? null : respaldoId,
    )
    if (!resultado.ok) {
      setError({ mensaje: resultado.mensaje, reintentable: resultado.reintentable })
      setOcupado(false)
      return
    }

    setGuardado(true)
    setOcupado(false)
  }

  const idPrincipal = `selector-modelo-principal-${nivel}`
  const idRespaldo = `selector-modelo-respaldo-${nivel}`

  return (
    <section
      aria-label={`Nivel: ${TITULOS_DE_NIVEL[nivel] ?? nivel}`}
      className="mb-6 max-w-xl rounded border border-gray-200 p-4"
    >
      <h2 className="mb-1 text-lg font-semibold text-gray-900">
        {TITULOS_DE_NIVEL[nivel] ?? nivel}
      </h2>
      <p className="mb-3 text-sm text-gray-600">{explicacion}</p>

      {!eleccion && (
        <p className="mb-3 rounded border border-amber-300 bg-amber-50 p-2 text-sm text-amber-900">
          Todavía no has elegido un modelo para este nivel.
        </p>
      )}

      <div className="mb-3">
        <label htmlFor={idPrincipal} className="mb-1 block text-sm font-medium text-gray-700">
          Modelo principal
        </label>
        <select
          id={idPrincipal}
          value={principalId}
          onChange={(e) => cambiarPrincipal(e.target.value)}
          disabled={ocupado}
          className="w-full rounded border border-gray-300 px-2 py-1 text-sm text-gray-900 disabled:opacity-50"
        >
          <option value="" disabled>
            Elige un modelo
          </option>
          {candidatosDelNivel.map((c) => (
            <option key={c.id} value={c.id}>
              {c.etiqueta} — US$ {formatearPrecio(c.precioEntradaUsd)} entrada / US${' '}
              {formatearPrecio(c.precioSalidaUsd)} salida por millón de tokens
            </option>
          ))}
        </select>
      </div>

      <div className="mb-3">
        <label htmlFor={idRespaldo} className="mb-1 block text-sm font-medium text-gray-700">
          Modelo de respaldo (opcional)
        </label>
        <select
          id={idRespaldo}
          value={respaldoId}
          onChange={(e) => cambiarRespaldo(e.target.value)}
          disabled={ocupado}
          className="w-full rounded border border-gray-300 px-2 py-1 text-sm text-gray-900 disabled:opacity-50"
        >
          <option value="">Sin respaldo</option>
          {candidatosDelNivel.map((c) => (
            <option key={c.id} value={c.id}>
              {c.etiqueta} — US$ {formatearPrecio(c.precioEntradaUsd)} entrada / US${' '}
              {formatearPrecio(c.precioSalidaUsd)} salida por millón de tokens
            </option>
          ))}
        </select>
      </div>

      <div className="flex items-center gap-3">
        <button
          type="button"
          disabled={ocupado || principalId === ''}
          onClick={() => void guardar()}
          className="rounded bg-indigo-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-indigo-700 disabled:opacity-50"
        >
          Guardar
        </button>
        {guardado && <span className="text-sm text-green-700">Modelo guardado.</span>}
      </div>

      {error && (
        <div className="mt-2 max-w-sm rounded border border-red-300 bg-red-50 p-2 text-sm text-red-800">
          <p>{error.mensaje}</p>
          {error.reintentable && (
            <button
              type="button"
              disabled={ocupado}
              onClick={() => void guardar()}
              className="mt-1 font-medium underline disabled:opacity-50"
            >
              Reintentar
            </button>
          )}
        </div>
      )}
    </section>
  )
}
