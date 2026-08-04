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
 *
 * Un error transitorio ofrece "Reintentar", como en `EditorDePerfil`. Acá es
 * incluso más seguro que allá: el intento que falló no escribió nada, así que
 * repetirlo no puede dejar dos marcas ni pisar nada.
 */
export function FormularioDeMarca() {
  const router = useRouter()
  const [slug, setSlug] = useState('')
  const [nombre, setNombre] = useState('')
  const [presupuesto, setPresupuesto] = useState('')
  const [ocupado, setOcupado] = useState(false)
  const [error, setError] = useState<{ mensaje: string; reintentable: boolean } | null>(null)

  async function crear() {
    setOcupado(true)
    setError(null)

    const r = await crearMarcaAccion(slug, nombre, presupuesto)
    if (!r.ok) {
      setError({ mensaje: r.mensaje, reintentable: r.reintentable })
      setOcupado(false)
      return
    }

    // El slug se recorta para navegar porque `crearMarca` recorta antes de
    // validar y guarda lo recortado: con el estado crudo, escribir
    // `"  tercera  "` creaba la marca `tercera` y navegaba a
    // `/  tercera  /perfil`, o sea un 404 justo después de una operación que
    // salió bien. Lo que se **envía** sigue siendo el valor crudo, para que las
    // reglas del identificador vivan en un solo lugar y no en dos.
    const destino = `/${slug.trim()}/perfil`
    setSlug('')
    setNombre('')
    setPresupuesto('')
    // `ocupado` se queda en `true`: la navegación tarda, y devolver el botón
    // habilitado mientras tanto deja pasar un segundo clic que pide crear la
    // misma marca otra vez. Esta pantalla se abandona al navegar, así que no
    // hay a qué volver a habilitarlo.
    router.push(destino)
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
        <div
          role="alert"
          className="whitespace-pre-wrap rounded border border-red-300 bg-red-50 p-3 text-sm text-red-800"
        >
          <p>{error.mensaje}</p>
          {error.reintentable && (
            <button
              type="button"
              disabled={ocupado}
              onClick={() => void crear()}
              className="mt-1 font-medium underline disabled:opacity-50"
            >
              Reintentar
            </button>
          )}
        </div>
      )}
    </form>
  )
}
