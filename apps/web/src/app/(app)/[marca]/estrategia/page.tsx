import { corridaDe, estrategiaDelTrimestre, leerEncargo } from '@gc/operaciones'
// Del submódulo: es el mismo predicado que usa la grilla y no arrastra nada.
import { corridaViva } from '@gc/operaciones/senales'
import type { TipoEstrategia } from '@gc/strategy'
import { mesActual } from '../../../../calendario.js'
import { conexion, organizacionPorDefecto } from '../../../../datos.js'
import { BotonGenerar } from '../../../../componentes/BotonGenerar.js'
import { EditorDeEncargo } from '../../../../componentes/EditorDeEncargo.js'
import { EstadoDeCorrida } from '../../../../componentes/EstadoDeCorrida.js'

// Árbol de rutas propio: el `force-dynamic` de `/` y el de `[marca]/grilla/[mes]`
// no llegan hasta acá. Sin este, Next prerenderiza la estrategia congelada en
// el trimestre vigente al momento del build.
export const dynamic = 'force-dynamic'

const ETIQUETAS_DE_ESTADO: Record<string, string> = {
  borrador: 'Borrador',
  aprobada: 'Aprobada',
  archivada: 'Archivada',
}

export default async function PaginaDeEstrategia({
  params,
}: {
  params: Promise<{ marca: string }>
}) {
  const { marca } = await params
  const db = await conexion()
  const organizationId = await organizacionPorDefecto(db)

  const mes = mesActual()
  const resultado = await estrategiaDelTrimestre(db, organizationId, marca, mes)

  // La corrida más reciente de este trimestre, si la hay. El periodo lo dicta
  // la lectura y no `mes`: `corridaDe` busca por el trimestre tal como quedó
  // guardado en la entrada de la corrida.
  const corrida = await corridaDe(db, organizationId, {
    slug: marca,
    flujo: 'p1_estrategia',
    periodo: resultado.periodo,
  })

  // El motor solo regenera una estrategia en borrador: P1 rechaza una que ya
  // salió de ahí, y no hay forma de devolverla. Por eso el botón se ofrece
  // únicamente en ese estado, en vez de encolar algo que va a fallar en el
  // worker un minuto después.
  const regenerable = resultado.tipo !== 'ausente' && resultado.estado === 'borrador'

  // Con una corrida en vuelo no se ofrece generar: el botón seguía habilitado
  // después del primer clic —la estrategia no cambia hasta que el worker
  // persiste— y encolar una segunda hace que el worker ejecute las dos, cada
  // una pagando el modelo. Se separa de `regenerable` a propósito: aquel habla
  // del estado de la estrategia y este de que ya hay algo corriendo, y la rama
  // de estrategia inválida necesita distinguirlos para no explicar el motivo
  // equivocado.
  const enVuelo = corridaViva(corrida)

  const encargo = await leerEncargo(db, organizationId, {
    slug: marca,
    periodo: resultado.periodo,
  })

  // El encargo se congela con la estrategia: la condición es «el estado no es
  // borrador», no «el estado es aprobada», porque una archivada tampoco se
  // regenera y su encargo tampoco tiene por qué cambiar.
  const encargoCongelado = resultado.tipo !== 'ausente' && resultado.estado !== 'borrador'

  // Sin encargo no se ofrece generar. La barrera real está en
  // `encolarEstrategia`, que falla con un `permanente`; esto solo evita
  // ofrecer un botón que sabemos que va a fallar.
  const hayEncargo = encargo.tipo === 'presente'

  return (
    <div className="p-6">
      <h1 className="mb-1 text-xl font-semibold text-gray-900">Estrategia</h1>

      {corrida && <EstadoDeCorrida corrida={corrida} ruta={`/${marca}/estrategia`} />}

      <section className="mb-6">
        <h2 className="mb-1 text-sm font-semibold text-gray-700">El encargo del trimestre</h2>
        {encargoCongelado ? (
          <p className="mb-2 text-xs text-gray-500">
            La estrategia de este periodo ya salió de borrador, así que el encargo quedó
            congelado con ella. Para editarlo, primero devuelve la estrategia a borrador.
          </p>
        ) : null}
        {encargo.tipo === 'invalido' ? (
          <p role="alert" className="rounded border border-red-300 bg-red-50 p-3 text-sm text-red-800">
            El encargo guardado para este periodo no cumple su esquema, así que no se puede
            mostrar. Vuelve a escribirlo.
          </p>
        ) : null}
        <EditorDeEncargo
          marca={marca}
          periodo={resultado.periodo}
          encargo={encargo.tipo === 'presente' ? encargo.encargo : null}
          soloLectura={encargoCongelado}
        />
      </section>

      {resultado.tipo === 'ausente' ? (
        <div className="mt-4 rounded border border-dashed border-gray-300 p-8 text-center text-gray-600">
          <p className="mb-3">
            La marca no tiene estrategia cargada para el trimestre {resultado.periodo}.
            {!hayEncargo &&
              ' Escribe primero el encargo de arriba: la estrategia se genera a partir de él.'}
          </p>
          {/* El botón encola y devuelve; quien la genera es el worker. El
              avance aparece arriba, en `EstadoDeCorrida`. Mientras esa corrida
              siga viva no se ofrece de nuevo. Sin encargo tampoco: encolar
              fallaría de inmediato en el motor. */}
          {hayEncargo && !enVuelo && (
            <div className="flex justify-center">
              <BotonGenerar
                marca={marca}
                periodo={resultado.periodo}
                que="estrategia"
                etiqueta="Generar estrategia"
              />
            </div>
          )}
        </div>
      ) : resultado.tipo === 'invalida' ? (
        <>
          <p className="mb-6 text-sm text-gray-600">
            Periodo: {resultado.periodo} · Estado:{' '}
            {ETIQUETAS_DE_ESTADO[resultado.estado] ?? resultado.estado}
          </p>
          <div className="rounded border border-red-300 bg-red-50 p-3 text-sm text-red-800">
            <p className="mb-2">
              La estrategia guardada para este periodo no valida contra su esquema, así que no se
              puede mostrar.
            </p>
            {/* Con una corrida en vuelo no se ofrece el botón ni se explica
                por qué no se puede regenerar: el motivo sería el equivocado.
                Lo que hay que mirar está arriba, en `EstadoDeCorrida`. */}
            {enVuelo ? null : regenerable && hayEncargo ? (
              <BotonGenerar
                marca={marca}
                periodo={resultado.periodo}
                que="estrategia"
                etiqueta="Regenerar estrategia"
                advertencia={`Regenerar la estrategia de ${resultado.periodo} reemplaza la que hay guardada.`}
              />
            ) : (
              <p>
                Está en estado «{ETIQUETAS_DE_ESTADO[resultado.estado] ?? resultado.estado}» y el
                motor solo regenera una que esté en borrador.
              </p>
            )}
          </div>
        </>
      ) : (
        <>
          {regenerable && hayEncargo && !enVuelo && (
            <div className="mb-4 flex justify-end">
              <BotonGenerar
                marca={marca}
                periodo={resultado.periodo}
                que="estrategia"
                etiqueta="Regenerar estrategia"
                advertencia={`Regenerar la estrategia de ${resultado.periodo} reemplaza la que hay guardada. Los cambios que le hayas hecho se pierden.`}
              />
            </div>
          )}
          <ContenidoDeEstrategia
            periodo={resultado.periodo}
            estado={resultado.estado}
            estrategia={resultado.estrategia}
          />
        </>
      )}
    </div>
  )
}

function ContenidoDeEstrategia({
  periodo,
  estado,
  estrategia,
}: {
  periodo: string
  estado: string
  estrategia: TipoEstrategia
}) {
  return (
    <>
      <p className="mb-6 text-sm text-gray-600">
        Periodo: {periodo} · Estado: {ETIQUETAS_DE_ESTADO[estado] ?? estado}
      </p>

      <div className="space-y-8">
        <section>
          <h2 className="mb-2 text-sm font-semibold text-gray-700">Objetivos</h2>
          <ul className="space-y-1 text-sm text-gray-800">
            {estrategia.objetivos.map((o, i) => (
              <li key={i}>
                {o.nombre} — {o.metrica}: {o.meta}
              </li>
            ))}
          </ul>
        </section>

        <section>
          <h2 className="mb-2 text-sm font-semibold text-gray-700">Mensajes clave</h2>
          <ul className="list-disc space-y-1 pl-5 text-sm text-gray-800">
            {estrategia.mensajesClave.map((m, i) => (
              <li key={i}>{m}</li>
            ))}
          </ul>
        </section>

        <section>
          <h2 className="mb-2 text-sm font-semibold text-gray-700">Mix de canales</h2>
          <ul className="space-y-1 text-sm text-gray-800">
            {estrategia.mixDeCanales.map((c, i) => (
              <li key={i}>
                {c.canal}: {c.publicacionesPorSemana} / semana
              </li>
            ))}
          </ul>
        </section>

        <section>
          <h2 className="mb-2 text-sm font-semibold text-gray-700">Reglas de reciclaje</h2>
          {estrategia.reciclaje.length === 0 ? (
            <p className="text-sm text-gray-500">Sin reglas de reciclaje.</p>
          ) : (
            <ul className="space-y-1 text-sm text-gray-800">
              {estrategia.reciclaje.map((r, i) => (
                <li key={i}>
                  {r.desde} → {r.hacia.join(', ')} ({r.diasDespues} días después)
                </li>
              ))}
            </ul>
          )}
        </section>

        <section>
          <h2 className="mb-2 text-sm font-semibold text-gray-700">Temas prioritarios</h2>
          <ul className="list-disc space-y-1 pl-5 text-sm text-gray-800">
            {estrategia.temasPrioritarios.map((t, i) => (
              <li key={i}>{t}</li>
            ))}
          </ul>
        </section>
      </div>
    </>
  )
}
