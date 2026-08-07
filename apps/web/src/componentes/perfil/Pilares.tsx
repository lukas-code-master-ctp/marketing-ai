'use client'

import { useEffect, useId, useState } from 'react'

import { CampoDeTexto } from './campos.js'
import { aSnakeCase, type PilarEnFormulario } from './conversion.js'
import { EJEMPLOS } from './ejemplos.js'

/**
 * Los pilares van en archivo propio porque son el único control con lógica
 * de verdad: el total tiene que sumar 100, el nombre se guarda convertido a
 * `snake_case` y no puede repetirse con otro ya convertido. Mezclarlo con
 * las seis secciones simples de `secciones.tsx` haría ese archivo el doble
 * de largo por una sola sección.
 */

const e = EJEMPLOS.pilares

/**
 * Nombres (ya convertidos a `snake_case`) que aparecen en más de una fila.
 * Las filas cuyo nombre no se puede convertir (`aSnakeCase` da `''`) se
 * excluyen: ya tienen su propio aviso, y agruparlas como «repetidas» entre
 * sí sería un aviso redundante y confuso.
 */
function nombresRepetidos(pilares: PilarEnFormulario[]): string[] {
  const conteo = new Map<string, number>()
  for (const pilar of pilares) {
    const snake = aSnakeCase(pilar.nombre.trim())
    if (snake === '') continue
    conteo.set(snake, (conteo.get(snake) ?? 0) + 1)
  }
  return [...conteo.entries()].filter(([, veces]) => veces > 1).map(([nombre]) => nombre)
}

function FilaDePilar({
  pilar,
  indice,
  mostrarQuitar,
  onCambiar,
  onQuitar,
}: {
  pilar: PilarEnFormulario
  indice: number
  mostrarQuitar: boolean
  onCambiar: (cambio: Partial<PilarEnFormulario>) => void
  onQuitar: () => void
}) {
  const idPorcentaje = useId()

  // El nombre necesita eco local: la vista previa en `snake_case` tiene que
  // reflejar lo que la persona va tecleando, no solo lo que el padre decida
  // guardar de vuelta en `valor`. Si se leyera directo de la prop, la vista
  // previa se quedaría atrás mientras se escribe —el padre solo la
  // actualiza cuando decide re-renderizar con la lista nueva.
  const [nombre, setNombre] = useState(pilar.nombre)

  // Con `key={indice}`, quitar una fila que no es la última corre de índice
  // a las que quedan debajo: React reconcilia por key, así que la instancia
  // no se remonta y su estado local queda con el nombre de la fila vieja
  // mientras `pilar` (la prop) ya trae la fila que se corrió. Repone el eco
  // cuando el nombre cambia por una vía distinta a la propia tecla —una fila
  // eliminada más arriba, o (en la tarea siguiente) un JSON pegado entero—.
  // En el flujo normal esto no pelea con lo que se teclea porque `onCambiar`
  // ya deja a `pilar.nombre` igual al eco antes de que el efecto corra.
  useEffect(() => {
    setNombre(pilar.nombre)
  }, [pilar.nombre])

  function cambiarNombre(v: string) {
    setNombre(v)
    onCambiar({ nombre: v })
  }

  const snake = aSnakeCase(nombre.trim())

  return (
    <div className="rounded border border-gray-200 p-3">
      <div className="flex flex-col gap-2">
        <div>
          <CampoDeTexto
            etiqueta="Nombre del pilar"
            ayuda={e.nombre.ayuda}
            ejemplo={e.nombre.ejemplo}
            valor={nombre}
            alCambiar={cambiarNombre}
          />
          {snake === '' ? (
            <p role="alert" className="mt-1 text-xs text-red-700">
              El nombre tiene que empezar con una letra.
            </p>
          ) : (
            <p className="mt-1 text-xs text-gray-400">→ {snake}</p>
          )}
        </div>

        <CampoDeTexto
          etiqueta="Descripción"
          ayuda={e.descripcion.ayuda}
          ejemplo={e.descripcion.ejemplo}
          valor={pilar.descripcion}
          alCambiar={(descripcion) => onCambiar({ descripcion })}
        />

        <div>
          <label htmlFor={idPorcentaje} className="block text-sm font-medium text-gray-700">
            Porcentaje
          </label>
          <p className="text-xs text-gray-500">{e.porcentaje.ayuda}</p>
          <input
            id={idPorcentaje}
            type="number"
            value={pilar.porcentaje}
            onChange={(ev) => {
              const bruto = ev.target.value
              // Un campo vacío (la persona borró todo antes de escribir el
              // número nuevo) se trata como 0 en vez de dejar pasar un
              // `NaN` a la interfaz: mostrar "NaN" sería peor que asumir 0
              // mientras termina de escribir.
              const numero = bruto === '' ? 0 : Number(bruto)
              if (!Number.isNaN(numero)) onCambiar({ porcentaje: numero })
            }}
            className="mt-1 w-full rounded border border-gray-300 p-2 text-sm text-gray-800"
          />
          <p className="mt-1 text-xs text-gray-400">Ejemplo: {e.porcentaje.ejemplo}</p>
        </div>
      </div>

      {mostrarQuitar && (
        <button
          type="button"
          onClick={onQuitar}
          className="mt-2 text-sm text-red-700 hover:underline"
        >
          Quitar pilar {indice + 1}
        </button>
      )}
    </div>
  )
}

export function SeccionPilares({
  valor,
  alCambiar,
}: {
  valor: PilarEnFormulario[]
  alCambiar: (v: PilarEnFormulario[]) => void
}) {
  const total = valor.reduce((acc, p) => acc + p.porcentaje, 0)
  const completo = total === 100
  const diferencia = 100 - total
  const repetidos = nombresRepetidos(valor)

  function cambiarPilar(indice: number, cambio: Partial<PilarEnFormulario>) {
    alCambiar(valor.map((p, i) => (i === indice ? { ...p, ...cambio } : p)))
  }

  function agregar() {
    // No reparte: repartir cambiaría números que la persona ya escribió a
    // mano, y eso es peor que pedirle que ajuste el total ella misma.
    alCambiar([...valor, { nombre: '', descripcion: '', porcentaje: 0 }])
  }

  function quitar(indice: number) {
    alCambiar(valor.filter((_, i) => i !== indice))
  }

  return (
    <section>
      <h2 className="text-lg font-semibold text-gray-900">Pilares</h2>

      <p
        data-testid="total-de-pilares"
        data-completo={completo ? 'true' : 'false'}
        className={`mt-1 text-sm font-medium ${completo ? 'text-green-700' : 'text-amber-700'}`}
      >
        Total: {total}%
        {!completo &&
          (diferencia > 0 ? ` (faltan ${diferencia}%)` : ` (sobran ${-diferencia}%)`)}
      </p>

      {repetidos.length > 0 && (
        <p role="alert" className="mt-1 text-xs text-red-700">
          Nombre repetido: {repetidos.join(', ')}.
        </p>
      )}

      <div className="mt-2 flex flex-col gap-4">
        {valor.map((pilar, indice) => (
          <FilaDePilar
            key={indice}
            pilar={pilar}
            indice={indice}
            mostrarQuitar={valor.length > 2}
            onCambiar={(cambio) => cambiarPilar(indice, cambio)}
            onQuitar={() => quitar(indice)}
          />
        ))}
      </div>

      <button
        type="button"
        onClick={agregar}
        className="mt-2 rounded bg-indigo-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-indigo-700"
      >
        Agregar pilar
      </button>
    </section>
  )
}
