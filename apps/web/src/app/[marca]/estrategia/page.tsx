import { estrategiaDelTrimestre } from '@gc/operaciones'
import { trimestreDe, type TipoEstrategia } from '@gc/strategy'
import { conexion, organizacionPorDefecto } from '../../../datos.js'

// Árbol de rutas propio: el `force-dynamic` de `/` y el de `[marca]/grilla/[mes]`
// no llegan hasta acá. Sin este, Next prerenderiza la estrategia congelada en
// el trimestre vigente al momento del build.
export const dynamic = 'force-dynamic'

const ETIQUETAS_DE_ESTADO: Record<string, string> = {
  borrador: 'Borrador',
  aprobada: 'Aprobada',
  archivada: 'Archivada',
}

function mesActual(): string {
  const ahora = new Date()
  return `${ahora.getUTCFullYear()}-${String(ahora.getUTCMonth() + 1).padStart(2, '0')}`
}

export default async function PaginaDeEstrategia({
  params,
}: {
  params: Promise<{ marca: string }>
}) {
  const { marca } = await params
  const db = conexion()
  const organizationId = await organizacionPorDefecto(db)

  const mes = mesActual()
  const periodo = trimestreDe(mes)
  const resultado = await estrategiaDelTrimestre(db, organizationId, marca, mes)

  return (
    <div className="p-6">
      <h1 className="mb-1 text-xl font-semibold text-gray-900">Estrategia</h1>

      {resultado.tipo === 'ausente' ? (
        <div className="mt-4 rounded border border-dashed border-gray-300 p-8 text-center text-gray-600">
          <p>La marca no tiene estrategia cargada para el trimestre {periodo}.</p>
          <p className="mt-2">
            Genérala con{' '}
            <code className="rounded bg-gray-100 px-1.5 py-0.5 text-sm text-gray-800">
              pnpm cli estrategia:generar --marca {marca} --periodo {periodo}
            </code>
          </p>
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
            <p>
              Regenérala con{' '}
              <code className="rounded bg-red-100 px-1.5 py-0.5 text-xs">
                pnpm cli estrategia:generar --marca {marca} --periodo {resultado.periodo}
              </code>
            </p>
          </div>
        </>
      ) : (
        <ContenidoDeEstrategia
          periodo={resultado.periodo}
          estado={resultado.estado}
          estrategia={resultado.estrategia}
        />
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
