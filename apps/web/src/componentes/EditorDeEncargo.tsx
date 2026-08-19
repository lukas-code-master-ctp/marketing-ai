'use client'

// Del submódulo `./canales` y no del barril `@gc/db` ni de `@gc/db/esquema`:
// este es un componente de cliente. El barril arrastraría `cliente.ts` —el
// conector de Cloud SQL, con `google-auth-library`—, y `esquema.ts` arrastra
// el DDL de las dieciséis tablas (`@gc/db` no declara `sideEffects: false`, así
// que webpack no puede descartar esos `pgTable(...)`). Mismo motivo por el
// que `EstadoDeCorrida` importa `@gc/operaciones/senales` y no el barril de
// `@gc/operaciones`.
import { CANALES, type Canal } from '@gc/db/canales'
import { useId, useState } from 'react'
import { guardarEncargoAction } from '../acciones.js'
import {
  desdeElEncargo,
  faltanCamposObligatorios,
  haciaElEncargo,
  type EncargoEnFormulario,
} from './encargo/conversion.js'
import { CampoDeTexto, MENSAJE_CAMPO_OBLIGATORIO } from './perfil/campos.js'

const ETIQUETAS_DE_CANAL: Record<Canal, string> = {
  instagram: 'Instagram',
  linkedin: 'LinkedIn',
  facebook: 'Facebook',
  tiktok: 'TikTok',
  blog: 'Blog',
}

/**
 * El encargo del trimestre: nueve campos que la persona responde antes de
 * generar la estrategia, para que el modelo deje de inventarse las métricas y
 * el mix de canales. Es el hermano directo de `EditorDePerfil`, y sigue el
 * mismo patrón de estado y de errores — pero sin la sección avanzada de JSON,
 * que ese formulario necesita y este no.
 */
export function EditorDeEncargo({
  marca,
  periodo,
  encargo,
  soloLectura,
}: {
  marca: string
  periodo: string
  encargo: unknown
  soloLectura: boolean
}) {
  const [formulario, setFormulario] = useState<EncargoEnFormulario>(() => desdeElEncargo(encargo))
  const [ocupado, setOcupado] = useState(false)
  const [error, setError] = useState<{ mensaje: string; reintentable: boolean } | null>(null)
  const [guardado, setGuardado] = useState(false)

  // Se enciende con el primer intento de guardar que encuentra campos
  // obligatorios vacíos, y desde ahí queda encendido: no hace falta
  // apagarlo, porque cada campo decide si marcarse mirando su propio valor
  // actual, así que uno que se llena deja de marcarse solo.
  const [mostrarObligatorios, setMostrarObligatorios] = useState(false)

  const idCapacidad = useId()
  const idCapacidadAyuda = `${idCapacidad}-ayuda`
  const idCapacidadError = `${idCapacidad}-error`
  const idCanales = useId()
  const idCanalesAyuda = `${idCanales}-ayuda`
  const idCanalesError = `${idCanales}-error`

  function actualizar(cambio: Partial<EncargoEnFormulario>) {
    setFormulario((f) => ({ ...f, ...cambio }))
    setGuardado(false)
  }

  function alternarCanal(canal: string, marcado: boolean) {
    // El arreglo se reemplaza, nunca se muta en el sitio: mutarlo en el
    // lugar aliasa el arreglo que `desdeElEncargo` acaba de aislar de
    // `FORMULARIO_VACIO`. Se lee `f` del actualizador funcional de
    // `setFormulario`, no `formulario` del cierre del componente — el mismo
    // motivo por el que `actualizar` ya lo hace así. No es que exista un modo
    // de falla real que esto atrape (dos clics son dos eventos, y React no
    // comparte estado desactualizado entre uno y otro): es disciplina, para
    // no depender de esa garantía y quedar corregido si alguna vez deja de
    // valer.
    setFormulario((f) => ({
      ...f,
      canalesDisponibles: marcado
        ? [...f.canalesDisponibles, canal]
        : f.canalesDisponibles.filter((c) => c !== canal),
    }))
    setGuardado(false)
  }

  async function guardar() {
    if (faltanCamposObligatorios(formulario)) {
      setMostrarObligatorios(true)
      return
    }

    setOcupado(true)
    setError(null)
    setGuardado(false)
    const r = await guardarEncargoAction(marca, periodo, JSON.stringify(haciaElEncargo(formulario)))
    setOcupado(false)
    if (r.ok) setGuardado(true)
    else setError({ mensaje: r.mensaje, reintentable: r.reintentable })
  }

  const faltaObjetivo = mostrarObligatorios && formulario.objetivo.trim() === ''
  const faltaComoSeMide = mostrarObligatorios && formulario.comoSeMide.trim() === ''
  const faltaCapacidad = mostrarObligatorios && formulario.publicacionesPorSemana.trim() === ''
  const faltanCanales = mostrarObligatorios && formulario.canalesDisponibles.length === 0

  return (
    // `CampoDeTexto` (`./perfil/campos.js`) no acepta `disabled` — lo
    // comparten siete secciones del editor de perfil, y extenderlo para esta
    // sola pantalla no vale el riesgo. Un `<fieldset disabled>` sin `<legend>`
    // como hijo directo deshabilita en cascada TODOS los controles de
    // formulario que contiene, nativos y sin JavaScript de por medio — cubre
    // el `<input>`/`<textarea>` de `CampoDeTexto`, el número y las casillas
    // de canal, con una sola bandera.
    <fieldset disabled={soloLectura} className="m-0 min-w-0 border-0 p-0">
      <div className="flex flex-col gap-8">
        <section className="flex flex-col gap-4">
          <h2 className="text-sm font-semibold text-gray-700">Lo que quieres lograr</h2>
          <CampoDeTexto
            etiqueta="Objetivo del trimestre"
            ayuda="Qué quieres que pase en estos tres meses. Una sola cosa, la más importante."
            ejemplo="Vender las doce parcelas que quedan del loteo norte"
            valor={formulario.objetivo}
            alCambiar={(objetivo) => actualizar({ objetivo })}
            largo
            error={faltaObjetivo ? MENSAJE_CAMPO_OBLIGATORIO : undefined}
          />
          <CampoDeTexto
            etiqueta="Cómo sabrás que resultó"
            ayuda="En qué número lo verías, con algo que puedas mirar de verdad."
            ejemplo="Formularios de contacto recibidos por semana"
            valor={formulario.comoSeMide}
            alCambiar={(comoSeMide) => actualizar({ comoSeMide })}
            error={faltaComoSeMide ? MENSAJE_CAMPO_OBLIGATORIO : undefined}
          />
        </section>

        <section className="flex flex-col gap-4">
          <h2 className="text-sm font-semibold text-gray-700">Lo que puedes sostener</h2>
          <div>
            <label htmlFor={idCapacidad} className="block text-sm font-medium text-gray-700">
              Publicaciones por semana que puedes sostener
            </label>
            <p id={idCapacidadAyuda} className="text-xs text-gray-500">
              El total que puedes sostener sumando todos los canales, no por canal. Sé realista: es
              mejor poco y constante.
            </p>
            <input
              id={idCapacidad}
              type="number"
              min="1"
              step="1"
              value={formulario.publicacionesPorSemana}
              onChange={(e) => actualizar({ publicacionesPorSemana: e.target.value })}
              aria-describedby={faltaCapacidad ? `${idCapacidadAyuda} ${idCapacidadError}` : idCapacidadAyuda}
              aria-invalid={faltaCapacidad ? 'true' : undefined}
              className="mt-1 w-full rounded border border-gray-300 p-2 text-sm text-gray-800"
            />
            {faltaCapacidad && (
              <p id={idCapacidadError} role="alert" className="mt-1 text-xs text-red-700">
                {MENSAJE_CAMPO_OBLIGATORIO}
              </p>
            )}
            <p className="mt-1 text-xs text-gray-400">Ejemplo: 4</p>
          </div>

          {/* `aria-invalid` va en el `fieldset`, que es el grupo, y no en cada
              casilla: el error es «falta marcar al menos un canal», una
              condición del grupo entero, no de cada control por separado. No
              es que esto garantice un anuncio de lector de pantalla —
              `aria-invalid` no es una propiedad ARIA global y el rol `group`
              no está entre los que la admiten, así que un lector puede
              ignorarlo—; lo que sí anuncia el error es lo de abajo: cada
              casilla con `aria-describedby` al párrafo con `role="alert"`. */}
          <fieldset aria-invalid={faltanCanales ? 'true' : undefined}>
            <legend className="text-sm font-medium text-gray-700">Canales disponibles este trimestre</legend>
            <p id={idCanalesAyuda} className="text-xs text-gray-500">
              Dónde puedes publicar este trimestre. Marca solo los que vas a atender.
            </p>
            <div className="mt-1 flex flex-col gap-1">
              {CANALES.map((canal) => (
                <label key={canal} className="flex items-center gap-2 text-sm text-gray-800">
                  <input
                    type="checkbox"
                    checked={formulario.canalesDisponibles.includes(canal)}
                    onChange={(e) => alternarCanal(canal, e.target.checked)}
                    aria-describedby={faltanCanales ? `${idCanalesAyuda} ${idCanalesError}` : idCanalesAyuda}
                  />
                  {ETIQUETAS_DE_CANAL[canal]}
                </label>
              ))}
            </div>
            {faltanCanales && (
              <p id={idCanalesError} role="alert" className="mt-1 text-xs text-red-700">
                {MENSAJE_CAMPO_OBLIGATORIO}
              </p>
            )}
          </fieldset>
        </section>

        <section className="flex flex-col gap-4">
          <h2 className="text-sm font-semibold text-gray-700">El momento</h2>
          <CampoDeTexto
            etiqueta="Qué está pasando"
            ayuda="Un lanzamiento, una temporada alta, un evento, algo que cambió en el mercado."
            ejemplo="Empieza la temporada de visitas a terreno y se inaugura el acceso pavimentado"
            valor={formulario.queEstaPasando}
            alCambiar={(queEstaPasando) => actualizar({ queEstaPasando })}
            largo
          />
          <CampoDeTexto
            etiqueta="Qué funcionó"
            ayuda="Lo que sí resultó el trimestre pasado y vale la pena repetir."
            ejemplo="Los recorridos en video por las parcelas fueron lo más visto"
            valor={formulario.queFunciono}
            alCambiar={(queFunciono) => actualizar({ queFunciono })}
            largo
          />
          <CampoDeTexto
            etiqueta="Qué no funcionó"
            ayuda="Lo que no resultó, o lo que quieres dejar de hacer."
            ejemplo="Los carruseles largos de texto no los leyó nadie"
            valor={formulario.queNoFunciono}
            alCambiar={(queNoFunciono) => actualizar({ queNoFunciono })}
            largo
          />
        </section>

        <section className="flex flex-col gap-4">
          <h2 className="text-sm font-semibold text-gray-700">Los límites</h2>
          <CampoDeTexto
            etiqueta="Qué evitar"
            ayuda="Un tema que este trimestre prefieres no tocar. No es el léxico prohibido de la marca, que no caduca."
            ejemplo="No hablar de la ampliación del loteo sur hasta que estén los permisos"
            valor={formulario.queEvitar}
            alCambiar={(queEvitar) => actualizar({ queEvitar })}
            largo
          />
          <CampoDeTexto
            etiqueta="Algo más"
            ayuda="Cualquier cosa que el modelo debería saber y que el formulario no te preguntó."
            ejemplo="El equipo se va de vacaciones las dos primeras semanas de febrero"
            valor={formulario.algoMas}
            alCambiar={(algoMas) => actualizar({ algoMas })}
            largo
          />
        </section>

        {!soloLectura && (
          <div className="flex items-center gap-3">
            <button
              type="button"
              disabled={ocupado}
              onClick={() => void guardar()}
              className="rounded bg-indigo-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-indigo-700 disabled:opacity-50"
            >
              Guardar el encargo
            </button>
            {guardado && (
              <span role="status" className="text-sm text-green-700">
                Encargo guardado.
              </span>
            )}
          </div>
        )}

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
                onClick={() => void guardar()}
                className="mt-1 font-medium underline disabled:opacity-50"
              >
                Reintentar
              </button>
            )}
          </div>
        )}
      </div>
    </fieldset>
  )
}
