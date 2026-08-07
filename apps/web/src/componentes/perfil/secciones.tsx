'use client'

import { CampoDeTexto, ListaDeTextos } from './campos.js'
import { EJEMPLOS } from './ejemplos.js'
import type { OfertaEnFormulario, PerfilEnFormulario, PublicoEnFormulario } from './conversion.js'

/**
 * Seis de las siete secciones del formulario de perfil de marca. La
 * séptima —pilares— vive aparte porque reparte porcentajes entre filas y
 * esa lógica no encaja en el patrón de las demás.
 *
 * Cada sección recibe su rebanada del formulario y devuelve la rebanada
 * modificada completa: ninguna conoce el perfil entero, así que ninguna
 * puede pisar lo que otra sección editó.
 */

export function SeccionPosicionamiento({
  valor,
  alCambiar,
}: {
  valor: PerfilEnFormulario['posicionamiento']
  alCambiar: (v: PerfilEnFormulario['posicionamiento']) => void
}) {
  const e = EJEMPLOS.posicionamiento

  return (
    <section>
      <h2 className="text-lg font-semibold text-gray-900">Posicionamiento</h2>
      <div className="mt-2 flex flex-col gap-4">
        <CampoDeTexto
          etiqueta="Categoría"
          ayuda={e.categoria.ayuda}
          ejemplo={e.categoria.ejemplo}
          valor={valor.categoria}
          alCambiar={(categoria) => alCambiar({ ...valor, categoria })}
        />
        <CampoDeTexto
          etiqueta="Promesa"
          ayuda={e.promesa.ayuda}
          ejemplo={e.promesa.ejemplo}
          valor={valor.promesa}
          alCambiar={(promesa) => alCambiar({ ...valor, promesa })}
          largo
        />
        <ListaDeTextos
          etiqueta="Diferenciadores"
          ayuda={e.diferenciadores.ayuda}
          ejemplo={e.diferenciadores.ejemplo}
          valores={valor.diferenciadores}
          alCambiar={(diferenciadores) => alCambiar({ ...valor, diferenciadores })}
          minimo={1}
        />
      </div>
    </section>
  )
}

export function SeccionPublicos({
  valor,
  alCambiar,
}: {
  valor: PublicoEnFormulario[]
  alCambiar: (v: PublicoEnFormulario[]) => void
}) {
  const e = EJEMPLOS.publicos

  function cambiarPublico(indice: number, cambio: Partial<PublicoEnFormulario>) {
    alCambiar(valor.map((p, i) => (i === indice ? { ...p, ...cambio } : p)))
  }

  function agregar() {
    alCambiar([...valor, { nombre: '', dolor: '', objecion: '' }])
  }

  function quitar(indice: number) {
    alCambiar(valor.filter((_, i) => i !== indice))
  }

  return (
    <section>
      <h2 className="text-lg font-semibold text-gray-900">Públicos</h2>
      <div className="mt-2 flex flex-col gap-4">
        {valor.map((publico, indice) => (
          <div key={indice} className="rounded border border-gray-200 p-3">
            <div className="flex flex-col gap-2">
              <CampoDeTexto
                etiqueta="Nombre"
                ayuda={e.nombre.ayuda}
                ejemplo={e.nombre.ejemplo}
                valor={publico.nombre}
                alCambiar={(nombre) => cambiarPublico(indice, { nombre })}
              />
              <CampoDeTexto
                etiqueta="Dolor"
                ayuda={e.dolor.ayuda}
                ejemplo={e.dolor.ejemplo}
                valor={publico.dolor}
                alCambiar={(dolor) => cambiarPublico(indice, { dolor })}
              />
              <CampoDeTexto
                etiqueta="Objeción"
                ayuda={e.objecion.ayuda}
                ejemplo={e.objecion.ejemplo}
                valor={publico.objecion}
                alCambiar={(objecion) => cambiarPublico(indice, { objecion })}
              />
            </div>
            {valor.length > 1 && (
              <button
                type="button"
                onClick={() => quitar(indice)}
                className="mt-2 text-sm text-red-700 hover:underline"
              >
                Quitar público {indice + 1}
              </button>
            )}
          </div>
        ))}
      </div>
      <button
        type="button"
        onClick={agregar}
        className="mt-2 rounded bg-indigo-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-indigo-700"
      >
        Agregar público
      </button>
    </section>
  )
}

export function SeccionTono({
  valor,
  alCambiar,
}: {
  valor: PerfilEnFormulario['tono']
  alCambiar: (v: PerfilEnFormulario['tono']) => void
}) {
  const e = EJEMPLOS.tono

  return (
    <section>
      <h2 className="text-lg font-semibold text-gray-900">Tono</h2>
      <div className="mt-2 flex flex-col gap-4">
        <ListaDeTextos
          etiqueta="Atributos"
          ayuda={e.atributos.ayuda}
          ejemplo={e.atributos.ejemplo}
          valores={valor.atributos}
          alCambiar={(atributos) => alCambiar({ ...valor, atributos })}
          minimo={1}
        />
        <ListaDeTextos
          etiqueta="Hacer"
          ayuda={e.hacer.ayuda}
          ejemplo={e.hacer.ejemplo}
          valores={valor.hacer}
          alCambiar={(hacer) => alCambiar({ ...valor, hacer })}
        />
        <ListaDeTextos
          etiqueta="No hacer"
          ayuda={e.noHacer.ayuda}
          ejemplo={e.noHacer.ejemplo}
          valores={valor.noHacer}
          alCambiar={(noHacer) => alCambiar({ ...valor, noHacer })}
        />
      </div>
    </section>
  )
}

export function SeccionLexico({
  valor,
  alCambiar,
}: {
  valor: PerfilEnFormulario['lexico']
  alCambiar: (v: PerfilEnFormulario['lexico']) => void
}) {
  const e = EJEMPLOS.lexico

  return (
    <section>
      <h2 className="text-lg font-semibold text-gray-900">Léxico</h2>
      <div className="mt-2 flex flex-col gap-4">
        <ListaDeTextos
          etiqueta="Preferido"
          ayuda={e.preferido.ayuda}
          ejemplo={e.preferido.ejemplo}
          valores={valor.preferido}
          alCambiar={(preferido) => alCambiar({ ...valor, preferido })}
        />
        <ListaDeTextos
          etiqueta="Prohibido"
          ayuda={e.prohibido.ayuda}
          ejemplo={e.prohibido.ejemplo}
          valores={valor.prohibido}
          alCambiar={(prohibido) => alCambiar({ ...valor, prohibido })}
        />
      </div>
    </section>
  )
}

export function SeccionOfertas({
  valor,
  alCambiar,
}: {
  valor: OfertaEnFormulario[]
  alCambiar: (v: OfertaEnFormulario[]) => void
}) {
  const e = EJEMPLOS.ofertas

  function cambiarOferta(indice: number, cambio: Partial<OfertaEnFormulario>) {
    alCambiar(valor.map((o, i) => (i === indice ? { ...o, ...cambio } : o)))
  }

  function agregar() {
    alCambiar([...valor, { nombre: '', descripcion: '', url: '' }])
  }

  function quitar(indice: number) {
    alCambiar(valor.filter((_, i) => i !== indice))
  }

  return (
    <section>
      <h2 className="text-lg font-semibold text-gray-900">Ofertas</h2>
      <div className="mt-2 flex flex-col gap-4">
        {valor.map((oferta, indice) => (
          <div key={indice} className="rounded border border-gray-200 p-3">
            <div className="flex flex-col gap-2">
              <CampoDeTexto
                etiqueta="Nombre"
                ayuda={e.nombre.ayuda}
                ejemplo={e.nombre.ejemplo}
                valor={oferta.nombre}
                alCambiar={(nombre) => cambiarOferta(indice, { nombre })}
              />
              <CampoDeTexto
                etiqueta="Descripción"
                ayuda={e.descripcion.ayuda}
                ejemplo={e.descripcion.ejemplo}
                valor={oferta.descripcion}
                alCambiar={(descripcion) => cambiarOferta(indice, { descripcion })}
                largo
              />
              <CampoDeTexto
                etiqueta="URL"
                ayuda={e.url.ayuda}
                ejemplo={e.url.ejemplo}
                valor={oferta.url}
                alCambiar={(url) => cambiarOferta(indice, { url })}
              />
            </div>
            <button
              type="button"
              onClick={() => quitar(indice)}
              className="mt-2 text-sm text-red-700 hover:underline"
            >
              Quitar oferta {indice + 1}
            </button>
          </div>
        ))}
      </div>
      <button
        type="button"
        onClick={agregar}
        className="mt-2 rounded bg-indigo-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-indigo-700"
      >
        Agregar oferta
      </button>
    </section>
  )
}

export function SeccionRestricciones({
  valor,
  alCambiar,
}: {
  valor: PerfilEnFormulario['restricciones']
  alCambiar: (v: PerfilEnFormulario['restricciones']) => void
}) {
  const e = EJEMPLOS.restricciones

  return (
    <section>
      <h2 className="text-lg font-semibold text-gray-900">Restricciones</h2>
      <div className="mt-2 flex flex-col gap-4">
        <ListaDeTextos
          etiqueta="Disclaimers"
          ayuda={e.disclaimers.ayuda}
          ejemplo={e.disclaimers.ejemplo}
          valores={valor.disclaimers}
          alCambiar={(disclaimers) => alCambiar({ ...valor, disclaimers })}
        />
      </div>
    </section>
  )
}
