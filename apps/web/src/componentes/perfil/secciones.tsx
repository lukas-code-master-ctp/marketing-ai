'use client'

import { useRef } from 'react'

import { CampoDeTexto, ListaDeTextos, MENSAJE_CAMPO_OBLIGATORIO } from './campos.js'
import { estaVacio } from './conversion.js'
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
 *
 * `mostrarObligatorios` llega desde `EditorDePerfil` y solo se enciende tras
 * un intento de guardar con campos obligatorios vacíos: antes de eso, ningún
 * campo se marca en rojo. Las secciones cuyos campos son todos opcionales
 * —léxico, restricciones— no lo reciben porque no tienen nada que marcar.
 */

export function SeccionPosicionamiento({
  valor,
  alCambiar,
  mostrarObligatorios = false,
}: {
  valor: PerfilEnFormulario['posicionamiento']
  alCambiar: (v: PerfilEnFormulario['posicionamiento']) => void
  mostrarObligatorios?: boolean
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
          error={mostrarObligatorios && estaVacio(valor.categoria) ? MENSAJE_CAMPO_OBLIGATORIO : undefined}
        />
        <CampoDeTexto
          etiqueta="Promesa"
          ayuda={e.promesa.ayuda}
          ejemplo={e.promesa.ejemplo}
          valor={valor.promesa}
          alCambiar={(promesa) => alCambiar({ ...valor, promesa })}
          largo
          error={mostrarObligatorios && estaVacio(valor.promesa) ? MENSAJE_CAMPO_OBLIGATORIO : undefined}
        />
        <ListaDeTextos
          etiqueta="Diferenciadores"
          ayuda={e.diferenciadores.ayuda}
          ejemplo={e.diferenciadores.ejemplo}
          valores={valor.diferenciadores}
          alCambiar={(diferenciadores) => alCambiar({ ...valor, diferenciadores })}
          minimo={1}
          error={
            mostrarObligatorios && valor.diferenciadores.every(estaVacio)
              ? 'Agrega al menos un diferenciador.'
              : undefined
          }
        />
      </div>
    </section>
  )
}

export function SeccionPublicos({
  valor,
  alCambiar,
  mostrarObligatorios = false,
}: {
  valor: PublicoEnFormulario[]
  alCambiar: (v: PublicoEnFormulario[]) => void
  mostrarObligatorios?: boolean
}) {
  const e = EJEMPLOS.publicos
  const refAgregar = useRef<HTMLButtonElement>(null)

  // Se exige al menos UN público completo, no que todos lo estén: mientras
  // ninguno lo esté, se marcan los campos vacíos de todos, para que quede
  // claro qué falta en cada uno.
  const algunPublicoCompleto = valor.some(
    (p) => !estaVacio(p.nombre) && !estaVacio(p.dolor) && !estaVacio(p.objecion),
  )
  const marcarVacios = mostrarObligatorios && !algunPublicoCompleto

  function cambiarPublico(indice: number, cambio: Partial<PublicoEnFormulario>) {
    alCambiar(valor.map((p, i) => (i === indice ? { ...p, ...cambio } : p)))
  }

  function agregar() {
    alCambiar([...valor, { nombre: '', dolor: '', objecion: '' }])
  }

  function quitar(indice: number) {
    alCambiar(valor.filter((_, i) => i !== indice))
    refAgregar.current?.focus()
  }

  return (
    <section>
      <h2 className="text-lg font-semibold text-gray-900">Públicos</h2>
      <div className="mt-2 flex flex-col gap-4">
        {valor.map((publico, indice) => (
          // `fieldset`/`legend` en vez de un `div` pelado: con varios
          // públicos, cada uno repite los mismos nombres de campo (Nombre,
          // Dolor, Objeción), y sin agrupar, un lector de pantalla los
          // anuncia sin decir a cuál público pertenecen.
          <fieldset key={indice} className="rounded border border-gray-200 p-3">
            <legend className="px-1 text-sm font-medium text-gray-700">Público {indice + 1}</legend>
            <div className="flex flex-col gap-2">
              <CampoDeTexto
                etiqueta="Nombre"
                ayuda={e.nombre.ayuda}
                ejemplo={e.nombre.ejemplo}
                valor={publico.nombre}
                alCambiar={(nombre) => cambiarPublico(indice, { nombre })}
                error={marcarVacios && estaVacio(publico.nombre) ? MENSAJE_CAMPO_OBLIGATORIO : undefined}
              />
              <CampoDeTexto
                etiqueta="Dolor"
                ayuda={e.dolor.ayuda}
                ejemplo={e.dolor.ejemplo}
                valor={publico.dolor}
                alCambiar={(dolor) => cambiarPublico(indice, { dolor })}
                error={marcarVacios && estaVacio(publico.dolor) ? MENSAJE_CAMPO_OBLIGATORIO : undefined}
              />
              <CampoDeTexto
                etiqueta="Objeción"
                ayuda={e.objecion.ayuda}
                ejemplo={e.objecion.ejemplo}
                valor={publico.objecion}
                alCambiar={(objecion) => cambiarPublico(indice, { objecion })}
                error={marcarVacios && estaVacio(publico.objecion) ? MENSAJE_CAMPO_OBLIGATORIO : undefined}
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
          </fieldset>
        ))}
      </div>
      <button
        type="button"
        ref={refAgregar}
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
  mostrarObligatorios = false,
}: {
  valor: PerfilEnFormulario['tono']
  alCambiar: (v: PerfilEnFormulario['tono']) => void
  mostrarObligatorios?: boolean
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
          error={
            mostrarObligatorios && valor.atributos.every(estaVacio)
              ? 'Agrega al menos un atributo.'
              : undefined
          }
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
  const refAgregar = useRef<HTMLButtonElement>(null)

  function cambiarOferta(indice: number, cambio: Partial<OfertaEnFormulario>) {
    alCambiar(valor.map((o, i) => (i === indice ? { ...o, ...cambio } : o)))
  }

  function agregar() {
    alCambiar([...valor, { nombre: '', descripcion: '', url: '' }])
  }

  function quitar(indice: number) {
    alCambiar(valor.filter((_, i) => i !== indice))
    refAgregar.current?.focus()
  }

  return (
    <section>
      <h2 className="text-lg font-semibold text-gray-900">Ofertas</h2>
      <div className="mt-2 flex flex-col gap-4">
        {valor.map((oferta, indice) => (
          <fieldset key={indice} className="rounded border border-gray-200 p-3">
            <legend className="px-1 text-sm font-medium text-gray-700">Oferta {indice + 1}</legend>
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
          </fieldset>
        ))}
      </div>
      <button
        type="button"
        ref={refAgregar}
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
