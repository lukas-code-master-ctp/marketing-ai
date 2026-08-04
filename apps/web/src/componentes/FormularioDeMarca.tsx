'use client'

import { useRouter } from 'next/navigation'
import { useState } from 'react'
import { crearMarcaAccion } from '../acciones.js'

/**
 * Crea una marca sin pasar por el CLI, que era el único camino hasta ahora.
 *
 * Los tres campos son estado local y **no se limpian cuando la acción falla**:
 * el fallo más frecuente es un slug ya tomado, y hacer que la persona vuelva a
 * escribir nombre y presupuesto para cambiar una letra es exactamente el
 * detalle que enfurece. Se limpian al crearla, que es cuando ya no sirven.
 *
 * Nada se valida acá. El slug, el nombre y el monto los valida `crearMarca` en
 * el dominio, y su mensaje —en español y nombrando el valor que falló— se
 * muestra tal cual, sin envolverlo. Dos juegos de reglas, uno en el navegador
 * y otro en la base, se separan al primer cambio.
 *
 * Al crearla lleva al perfil de la marca nueva: una marca sin perfil no puede
 * generar ni estrategia ni grilla, así que el perfil es literalmente el
 * siguiente paso y no un destino más.
 */
export function FormularioDeMarca() {
  const router = useRouter()
  const [slug, setSlug] = useState('')
  const [nombre, setNombre] = useState('')
  const [presupuesto, setPresupuesto] = useState('')
  const [ocupado, setOcupado] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function crear() {
    setOcupado(true)
    setError(null)

    const r = await crearMarcaAccion(slug, nombre, presupuesto)
    if (!r.ok) {
      setError(r.mensaje)
      setOcupado(false)
      return
    }

    setSlug('')
    setNombre('')
    setPresupuesto('')
    setOcupado(false)
    router.push(`/${slug}/perfil`)
  }

  return (
    <form
      onSubmit={(e) => {
        e.preventDefault()
        void crear()
      }}
      className="max-w-md space-y-3"
    >
      <div>
        <label htmlFor="campo-slug" className="mb-1 block text-sm font-medium text-gray-700">
          Identificador
        </label>
        <input
          id="campo-slug"
          value={slug}
          onChange={(e) => setSlug(e.target.value)}
          disabled={ocupado}
          autoComplete="off"
          className="w-full rounded border border-gray-300 px-2 py-1 text-sm text-gray-900 disabled:opacity-50"
        />
        <p className="mt-1 text-xs text-gray-500">
          Con minúsculas, números y guiones. Es lo que aparece en la dirección de cada
          pantalla: <code>/mi-marca/grilla/2026-09</code>.
        </p>
      </div>

      <div>
        <label htmlFor="campo-nombre" className="mb-1 block text-sm font-medium text-gray-700">
          Nombre
        </label>
        <input
          id="campo-nombre"
          value={nombre}
          onChange={(e) => setNombre(e.target.value)}
          disabled={ocupado}
          autoComplete="off"
          className="w-full rounded border border-gray-300 px-2 py-1 text-sm text-gray-900 disabled:opacity-50"
        />
      </div>

      <div>
        <label
          htmlFor="campo-presupuesto"
          className="mb-1 block text-sm font-medium text-gray-700"
        >
          Presupuesto mensual en dólares (opcional)
        </label>
        <input
          id="campo-presupuesto"
          value={presupuesto}
          onChange={(e) => setPresupuesto(e.target.value)}
          disabled={ocupado}
          autoComplete="off"
          inputMode="decimal"
          placeholder="25.00"
          className="w-full rounded border border-gray-300 px-2 py-1 text-sm text-gray-900 disabled:opacity-50"
        />
      </div>

      <button
        type="submit"
        disabled={ocupado}
        className="rounded bg-indigo-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-indigo-700 disabled:opacity-50"
      >
        Crear marca
      </button>

      {error && (
        <p
          role="alert"
          className="whitespace-pre-wrap rounded border border-red-300 bg-red-50 p-3 text-sm text-red-800"
        >
          {error}
        </p>
      )}
    </form>
  )
}
