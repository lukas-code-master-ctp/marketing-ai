'use client'

import { useState } from 'react'
import { guardarPerfilAction } from '../acciones.js'

/**
 * El perfil se edita como JSON crudo en un textarea, a propósito: cubre el
 * mismo esquema que un formulario por campo por una fracción del esfuerzo, y
 * el perfil cambia con poca frecuencia. `texto` es estado local del cliente
 * y no se resetea cuando el servidor revalida — el usuario conserva lo que
 * escribió aunque el guardado falle; solo cambia con una edición manual o
 * tras un guardado exitoso, que además hace crecer `versiones` (prop) porque
 * la Server Action revalida la ruta y esta página vuelve a renderizarse con
 * el perfil y el historial ya actualizados.
 */
export function EditorDePerfil({
  marca,
  version,
  perfil,
  versiones,
}: {
  marca: string
  version: number
  perfil: unknown
  versiones: { version: number; createdAt: Date }[]
}) {
  const [texto, setTexto] = useState(() => JSON.stringify(perfil, null, 2))
  const [ocupado, setOcupado] = useState(false)
  const [error, setError] = useState<{ mensaje: string; reintentable: boolean } | null>(null)
  const [guardadoOk, setGuardadoOk] = useState(false)

  async function guardar() {
    setOcupado(true)
    setError(null)
    setGuardadoOk(false)

    const resultado = await guardarPerfilAction(marca, texto)
    if (!resultado.ok) {
      setError({ mensaje: resultado.mensaje, reintentable: resultado.reintentable })
      setOcupado(false)
      return
    }

    setGuardadoOk(true)
    setOcupado(false)
  }

  return (
    <div className="flex flex-col gap-6 lg:flex-row">
      <div className="flex-1">
        <textarea
          value={texto}
          onChange={(e) => {
            setTexto(e.target.value)
            setGuardadoOk(false)
          }}
          spellCheck={false}
          rows={32}
          aria-label="Perfil de marca en formato JSON"
          className="w-full rounded border border-gray-300 p-3 font-mono text-xs text-gray-800"
        />

        <div className="mt-3 flex items-center gap-3">
          <button
            type="button"
            disabled={ocupado}
            onClick={() => void guardar()}
            className="rounded bg-indigo-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-indigo-700 disabled:opacity-50"
          >
            Guardar
          </button>
          {guardadoOk && (
            <span className="text-sm text-green-700">
              Perfil guardado como versión {version}.
            </span>
          )}
        </div>

        {error && (
          <div
            role="alert"
            className="mt-3 whitespace-pre-wrap rounded border border-red-300 bg-red-50 p-3 text-sm text-red-800"
          >
            <p>{error.mensaje}</p>
            {error.reintentable && (
              <button type="button" onClick={() => void guardar()} className="mt-1 font-medium underline">
                Reintentar
              </button>
            )}
          </div>
        )}
      </div>

      <aside className="w-full shrink-0 lg:w-64">
        <h2 className="mb-2 text-sm font-semibold text-gray-700">Historial de versiones</h2>
        <ul className="space-y-1 text-sm">
          {versiones.map((v) => (
            <li
              key={v.version}
              className={v.version === version ? 'font-semibold text-gray-900' : 'text-gray-600'}
            >
              v{v.version} · {new Date(v.createdAt).toLocaleString('es-CL')}
            </li>
          ))}
        </ul>
      </aside>
    </div>
  )
}
