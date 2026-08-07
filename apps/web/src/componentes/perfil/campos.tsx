'use client'

import { useId } from 'react'

/**
 * Un campo de texto de una línea o de varias, con etiqueta, ayuda y ejemplo.
 * Cubre la mayoría de los campos sueltos del formulario de perfil —cinco de
 * las siete secciones se arman con esta y con `ListaDeTextos`—.
 *
 * El ejemplo va visible bajo el campo, con el prefijo `Ejemplo: `, y no como
 * `placeholder`: un `placeholder` desaparece en cuanto se escribe la primera
 * letra, y el ejemplo sirve justamente mientras se escribe.
 */
export function CampoDeTexto({
  etiqueta,
  ayuda,
  ejemplo,
  valor,
  alCambiar,
  largo = false,
}: {
  etiqueta: string
  ayuda: string
  ejemplo: string
  valor: string
  alCambiar: (v: string) => void
  largo?: boolean
}) {
  const id = useId()
  const claseControl = 'mt-1 w-full rounded border border-gray-300 p-2 text-sm text-gray-800'

  return (
    <div>
      <label htmlFor={id} className="block text-sm font-medium text-gray-700">
        {etiqueta}
      </label>
      <p className="text-xs text-gray-500">{ayuda}</p>
      {largo ? (
        <textarea
          id={id}
          value={valor}
          onChange={(e) => alCambiar(e.target.value)}
          rows={3}
          className={claseControl}
        />
      ) : (
        <input
          id={id}
          type="text"
          value={valor}
          onChange={(e) => alCambiar(e.target.value)}
          className={claseControl}
        />
      )}
      <p className="mt-1 text-xs text-gray-400">Ejemplo: {ejemplo}</p>
    </div>
  )
}

/**
 * Una lista de campos de texto de una línea, con filas para agregar y
 * quitar. `minimo` evita dejar la lista sin filas cuando el esquema exige al
 * menos una: con `minimo={1}` no se puede quitar la última fila, para no
 * dejar armado un formulario que no se pueda guardar.
 */
export function ListaDeTextos({
  etiqueta,
  ayuda,
  ejemplo,
  valores,
  alCambiar,
  minimo = 0,
}: {
  etiqueta: string
  ayuda: string
  ejemplo: string
  valores: string[]
  alCambiar: (v: string[]) => void
  minimo?: number
}) {
  const idBase = useId()

  function cambiarFila(indice: number, valor: string) {
    alCambiar(valores.map((v, i) => (i === indice ? valor : v)))
  }

  function agregar() {
    alCambiar([...valores, ''])
  }

  function quitar(indice: number) {
    alCambiar(valores.filter((_, i) => i !== indice))
  }

  return (
    <fieldset>
      <legend className="text-sm font-medium text-gray-700">{etiqueta}</legend>
      <p className="text-xs text-gray-500">{ayuda}</p>

      <div className="mt-1 flex flex-col gap-2">
        {valores.map((valor, indice) => (
          <div key={`${idBase}-${indice}`} className="flex items-center gap-2">
            <input
              type="text"
              value={valor}
              onChange={(e) => cambiarFila(indice, e.target.value)}
              aria-label={`${etiqueta} ${indice + 1}`}
              className="w-full rounded border border-gray-300 p-2 text-sm text-gray-800"
            />
            {valores.length > minimo && (
              <button
                type="button"
                onClick={() => quitar(indice)}
                className="shrink-0 text-sm text-red-700 hover:underline"
              >
                Quitar {etiqueta.toLowerCase()} {indice + 1}
              </button>
            )}
          </div>
        ))}
      </div>

      <p className="mt-1 text-xs text-gray-400">Ejemplo: {ejemplo}</p>

      <button
        type="button"
        onClick={agregar}
        className="mt-2 rounded bg-indigo-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-indigo-700"
      >
        Agregar {etiqueta.toLowerCase()}
      </button>
    </fieldset>
  )
}
