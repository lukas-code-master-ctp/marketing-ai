'use client'

import { useState } from 'react'
import { guardarPerfilAction } from '../acciones.js'
import {
  desdeElPerfil,
  faltanCamposObligatorios,
  haciaElPerfil,
  type PerfilEnFormulario,
} from './perfil/conversion.js'
import { promptParaIa } from './perfil/prompt.js'
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
 * Las siete claves que puede traer un perfil de marca. Se usan para
 * distinguir "esto parece un perfil, aunque le falten secciones" de "esto es
 * cualquier otro JSON que la persona pegó por error" — ver `pareceUnPerfil`.
 */
const CLAVES_DE_PERFIL = [
  'posicionamiento',
  'publicos',
  'tono',
  'lexico',
  'pilares',
  'ofertas',
  'restricciones',
] as const

/**
 * `true` si `valor` es un objeto (no `null`, no un arreglo) con al menos una
 * de las siete claves de un perfil de marca.
 *
 * `desdeElPerfil` carga lo que se pueda y nunca lanza — es su contrato, para
 * poder mostrar en el formulario un perfil viejo o parcialmente roto. Pero
 * ese mismo contrato significa que, sin esta guarda, pegar *cualquier* JSON
 * que `JSON.parse` acepte —`{"otra":"cosa"}`, `[]`, `5`— produce un
 * formulario en blanco sin ningún error: `desdeElPerfil` no tiene con qué
 * cargar nada, así que carga nada. Esta función es lo que distingue "no es
 * JSON" (atrapado por el `catch` de `JSON.parse`) de "es JSON pero no
 * describe un perfil" (atrapado acá), para que los dos caminos avisen en vez
 * de vaciar el formulario en silencio.
 */
function pareceUnPerfil(valor: unknown): valor is Record<string, unknown> {
  if (typeof valor !== 'object' || valor === null || Array.isArray(valor)) return false
  return CLAVES_DE_PERFIL.some((clave) => clave in valor)
}

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

  // Se enciende con el primer intento de guardar que encuentra campos
  // obligatorios vacíos, y desde ahí queda encendido: no hace falta
  // apagarlo, porque cada sección decide si marcar un campo mirando su
  // propio valor actual, así que un campo que se llena deja de marcarse solo.
  const [mostrarObligatorios, setMostrarObligatorios] = useState(false)

  // La sección avanzada muestra el JSON derivado del formulario mientras
  // nadie la haya editado a mano: `null` significa "sin edición propia,
  // seguir reflejando `formulario`". En cuanto la persona escribe ahí, el
  // texto pasa a vivir en este estado y ya no se recalcula solo, para no
  // pisar lo que está escribiendo mientras el resto del formulario cambia.
  const [textoAvanzadoEditado, setTextoAvanzadoEditado] = useState<string | null>(null)
  const [errorAvanzado, setErrorAvanzado] = useState<string | null>(null)
  const [copiado, setCopiado] = useState(false)
  const [errorDeCopia, setErrorDeCopia] = useState<string | null>(null)
  // A diferencia de `guardar()`, acá se conservan las filas y los textos
  // vacíos (`conservarVacios: true`): esta sección muestra el formulario
  // completo, no lo que se guardaría. Sin esto, alguien con una tarjeta
  // «Público 1» delante vería `"publicos": []` y concluiría, razonablemente,
  // que algo se perdió.
  const textoAvanzado =
    textoAvanzadoEditado ?? JSON.stringify(haciaElPerfil(formulario, { conservarVacios: true }), null, 2)

  async function copiarPrompt() {
    setCopiado(false)
    setErrorDeCopia(null)
    try {
      await navigator.clipboard.writeText(promptParaIa(marca, formulario))
      setCopiado(true)
    } catch {
      // `navigator.clipboard` exige contexto seguro y puede estar denegado por
      // permisos; si no existe siquiera, el acceso lanza y cae aquí igual. El
      // texto ya está en pantalla y se puede seleccionar, así que el fallo se
      // informa y no bloquea nada.
      setErrorDeCopia(
        'No se pudo copiar automáticamente. Selecciona el texto de arriba y cópialo a mano.',
      )
    }
  }

  function actualizar(cambio: Partial<PerfilEnFormulario>) {
    setFormulario((f) => ({ ...f, ...cambio }))
    setVersionGuardada(null)
  }

  function cargarJsonAvanzado() {
    let nuevo: unknown
    try {
      nuevo = JSON.parse(textoAvanzado)
    } catch (error) {
      setErrorAvanzado(
        `El texto no es JSON válido: ${error instanceof Error ? error.message : String(error)}`,
      )
      return
    }

    // `JSON.parse` acepta de todo —un arreglo, un número, `{"otra":"cosa"}`—
    // y `desdeElPerfil` "carga lo que se pueda y nunca lanza": con una
    // entrada que no describe un perfil, lo que se puede cargar es nada, y
    // el formulario quedaría en blanco sin ningún aviso. Se rechaza acá,
    // antes de tocar el formulario.
    if (!pareceUnPerfil(nuevo)) {
      setErrorAvanzado(
        'Esto no parece un perfil de marca: tiene que ser un objeto con alguna de sus ' +
          'secciones (posicionamiento, públicos, tono, léxico, pilares, ofertas, restricciones).',
      )
      return
    }

    setFormulario(desdeElPerfil(nuevo))
    setVersionGuardada(null)
    setTextoAvanzadoEditado(null)
    setErrorAvanzado(null)
  }

  async function guardar() {
    // El botón queda deshabilitado mientras esto es cierto (ver más abajo);
    // esta comprobación es una defensa adicional, no la única barrera.
    if (textoAvanzadoEditado !== null) return

    if (faltanCamposObligatorios(formulario)) {
      setMostrarObligatorios(true)
      return
    }

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

  // «Guardar» serializa siempre el FORMULARIO, no el texto de la sección
  // avanzada: si alguien pegó ahí un JSON y no lo cargó, guardar ahora
  // guardaría el perfil viejo mientras la pantalla anuncia éxito, y la
  // edición se perdería sin rastro. Se elige deshabilitar «Guardar» —en vez
  // de aplicar el JSON pegado antes de guardar— porque abrir la sección
  // avanzada no siempre significa "quiero aplicar esto": alguien puede
  // pegar un JSON solo para mirarlo o compararlo, y aplicar de más
  // adivinaría una intención que el clic en «Cargar» no confirmó.
  const hayJsonSinCargar = textoAvanzadoEditado !== null

  return (
    <div className="flex flex-col gap-6 lg:flex-row">
      <div className="flex-1">
        <div className="flex flex-col gap-8">
          <SeccionPosicionamiento
            valor={formulario.posicionamiento}
            alCambiar={(posicionamiento) => actualizar({ posicionamiento })}
            mostrarObligatorios={mostrarObligatorios}
          />
          <SeccionPublicos
            valor={formulario.publicos}
            alCambiar={(publicos) => actualizar({ publicos })}
            mostrarObligatorios={mostrarObligatorios}
          />
          <SeccionTono
            valor={formulario.tono}
            alCambiar={(tono) => actualizar({ tono })}
            mostrarObligatorios={mostrarObligatorios}
          />
          <SeccionLexico valor={formulario.lexico} alCambiar={(lexico) => actualizar({ lexico })} />
          <SeccionPilares
            valor={formulario.pilares}
            alCambiar={(pilares) => actualizar({ pilares })}
            mostrarObligatorios={mostrarObligatorios}
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
            disabled={ocupado || hayJsonSinCargar}
            onClick={() => void guardar()}
            className="rounded bg-indigo-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-indigo-700 disabled:opacity-50"
          >
            Guardar
          </button>
          {hayJsonSinCargar && (
            <span className="text-sm text-amber-700">
              Hay una edición del JSON sin cargar en el formulario. Cárgala, o descarta el
              texto pegado, antes de guardar.
            </span>
          )}
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

            <hr className="my-4 border-gray-200" />

            <h3 className="text-sm font-medium text-gray-700">Prompt para una IA</h3>
            <p className="mt-1 text-xs text-gray-500">
              Pégalo en una herramienta de IA que ya conozca tu empresa para que complete el
              perfil, y trae el resultado de vuelta al área de arriba.
            </p>
            <textarea
              value={promptParaIa(marca, formulario)}
              readOnly
              spellCheck={false}
              rows={20}
              aria-label="Prompt para una IA"
              className="mt-2 w-full rounded border border-gray-300 p-3 font-mono text-xs text-gray-800"
            />
            <button
              type="button"
              onClick={() => void copiarPrompt()}
              className="mt-2 rounded bg-gray-700 px-3 py-1.5 text-sm font-medium text-white hover:bg-gray-800"
            >
              Copiar prompt para IA
            </button>
            {copiado && <span className="ml-2 text-sm text-green-700">Copiado.</span>}
            {errorDeCopia && (
              <p role="alert" className="mt-2 text-sm text-red-800">
                {errorDeCopia}
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
