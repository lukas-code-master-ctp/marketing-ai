'use client'

import { useState } from 'react'
import { guardarPerfilAction } from '../acciones.js'
import { desdeElPerfil, haciaElPerfil, type PerfilEnFormulario } from './perfil/conversion.js'
import {
  SeccionLexico,
  SeccionOfertas,
  SeccionPosicionamiento,
  SeccionPublicos,
  SeccionRestricciones,
  SeccionTono,
} from './perfil/secciones.js'
import { SeccionPilares } from './perfil/Pilares.js'

/**
 * El perfil se edita con un formulario guiado, sección por sección: cubre el
 * mismo esquema que el JSON crudo de antes, pero sin exigir conocerlo. El
 * estado del formulario (`formulario`) es estado local del cliente y no se
 * resetea cuando el servidor revalida — el usuario conserva lo que escribió
 * aunque el guardado falle; solo cambia con una edición manual, con la carga
 * desde la sección avanzada, o tras un guardado exitoso, que además hace
 * crecer `versiones` (prop) porque la Server Action revalida la ruta y esta
 * página vuelve a renderizarse con el perfil y el historial ya actualizados.
 * El número que se anuncia tras guardar sale del retorno de la acción y no
 * de `version` (prop): esa prop llega recién con la revalidación y hasta
 * entonces vale la versión anterior.
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
  const [formulario, setFormulario] = useState<PerfilEnFormulario>(() => desdeElPerfil(perfil))
  const [ocupado, setOcupado] = useState(false)
  const [error, setError] = useState<{ mensaje: string; reintentable: boolean } | null>(null)
  const [versionGuardada, setVersionGuardada] = useState<number | null>(null)

  // La sección avanzada muestra el JSON derivado del formulario mientras
  // nadie la haya editado a mano: `null` significa "sin edición propia,
  // seguir reflejando `formulario`". En cuanto la persona escribe ahí, el
  // texto pasa a vivir en este estado y ya no se recalcula solo, para no
  // pisar lo que está escribiendo mientras el resto del formulario cambia.
  const [textoAvanzadoEditado, setTextoAvanzadoEditado] = useState<string | null>(null)
  const [errorAvanzado, setErrorAvanzado] = useState<string | null>(null)
  const textoAvanzado = textoAvanzadoEditado ?? JSON.stringify(haciaElPerfil(formulario), null, 2)

  function actualizar(cambio: Partial<PerfilEnFormulario>) {
    setFormulario((f) => ({ ...f, ...cambio }))
    setVersionGuardada(null)
  }

  function cargarJsonAvanzado() {
    try {
      const nuevo: unknown = JSON.parse(textoAvanzado)
      setFormulario(desdeElPerfil(nuevo))
      setVersionGuardada(null)
      setTextoAvanzadoEditado(null)
      setErrorAvanzado(null)
    } catch (error) {
      setErrorAvanzado(
        `El texto no es JSON válido: ${error instanceof Error ? error.message : String(error)}`,
      )
    }
  }

  async function guardar() {
    setOcupado(true)
    setError(null)
    setVersionGuardada(null)

    const resultado = await guardarPerfilAction(marca, JSON.stringify(haciaElPerfil(formulario), null, 2))
    if (!resultado.ok) {
      setError({ mensaje: resultado.mensaje, reintentable: resultado.reintentable })
      setOcupado(false)
      return
    }

    setVersionGuardada(resultado.datos.version)
    setOcupado(false)
  }

  return (
    <div className="flex flex-col gap-6 lg:flex-row">
      <div className="flex-1">
        <div className="flex flex-col gap-8">
          <SeccionPosicionamiento
            valor={formulario.posicionamiento}
            alCambiar={(posicionamiento) => actualizar({ posicionamiento })}
          />
          <SeccionPublicos
            valor={formulario.publicos}
            alCambiar={(publicos) => actualizar({ publicos })}
          />
          <SeccionTono valor={formulario.tono} alCambiar={(tono) => actualizar({ tono })} />
          <SeccionLexico valor={formulario.lexico} alCambiar={(lexico) => actualizar({ lexico })} />
          <SeccionPilares
            valor={formulario.pilares}
            alCambiar={(pilares) => actualizar({ pilares })}
          />
          <SeccionOfertas
            valor={formulario.ofertas}
            alCambiar={(ofertas) => actualizar({ ofertas })}
          />
          <SeccionRestricciones
            valor={formulario.restricciones}
            alCambiar={(restricciones) => actualizar({ restricciones })}
          />
        </div>

        <div className="mt-6 flex items-center gap-3">
          <button
            type="button"
            disabled={ocupado}
            onClick={() => void guardar()}
            className="rounded bg-indigo-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-indigo-700 disabled:opacity-50"
          >
            Guardar
          </button>
          {versionGuardada !== null && (
            <span className="text-sm text-green-700">
              Perfil guardado como versión {versionGuardada}.
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

        <details className="mt-8">
          <summary className="cursor-pointer text-sm font-medium text-gray-700">
            Avanzado: ver o pegar el JSON
          </summary>
          <div className="mt-2">
            <textarea
              value={textoAvanzado}
              onChange={(e) => setTextoAvanzadoEditado(e.target.value)}
              spellCheck={false}
              rows={20}
              aria-label="Perfil de marca en formato JSON"
              className="w-full rounded border border-gray-300 p-3 font-mono text-xs text-gray-800"
            />
            <button
              type="button"
              onClick={cargarJsonAvanzado}
              className="mt-2 rounded bg-gray-700 px-3 py-1.5 text-sm font-medium text-white hover:bg-gray-800"
            >
              Cargar este JSON en el formulario
            </button>
            {errorAvanzado && (
              <p role="alert" className="mt-2 text-sm text-red-800">
                {errorAvanzado}
              </p>
            )}
          </div>
        </details>
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
