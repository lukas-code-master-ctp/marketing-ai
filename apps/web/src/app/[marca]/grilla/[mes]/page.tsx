import Link from 'next/link'
import { notFound } from 'next/navigation'
import { grillaDelMes } from '@gc/operaciones'
import { mesAnterior, mesSiguiente, semanasDelMes } from '../../../../calendario.js'
import { conexion, organizacionPorDefecto } from '../../../../datos.js'
import { BotonAprobarGrilla } from '../../../../componentes/BotonAprobarGrilla.js'
import { RejillaDelMes } from '../../../../componentes/RejillaDelMes.js'

// `[marca]/grilla/[mes]` es un árbol de rutas propio: el `force-dynamic` de
// `/` (Task 2) no llega hasta acá. Sin este, Next prerenderiza la grilla y
// la congela en el mes que estuviera vigente al momento del build.
export const dynamic = 'force-dynamic'

const ETIQUETAS_DE_ESTADO: Record<string, string> = {
  borrador: 'Borrador',
  aprobada: 'Aprobada',
  en_ejecucion: 'En ejecución',
  cerrada: 'Cerrada',
}

export default async function PaginaDeGrilla({
  params,
}: {
  params: Promise<{ marca: string; mes: string }>
}) {
  const { marca, mes } = await params

  // Un mes mal escrito en la URL (`/parcelas/grilla/foo`) no debe tumbar la
  // página con un error 500: se trata como ruta inexistente.
  let semanas: string[][]
  try {
    semanas = semanasDelMes(mes)
  } catch {
    notFound()
  }

  const db = conexion()
  const organizationId = await organizacionPorDefecto(db)
  const grilla = await grillaDelMes(db, organizationId, marca, mes)

  return (
    <div className="p-6">
      <header className="mb-6 flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="flex items-center gap-3 text-xl font-semibold text-gray-900">
            <Link
              href={`/${marca}/grilla/${mesAnterior(mes)}`}
              aria-label="Mes anterior"
              className="text-gray-400 hover:text-gray-800"
            >
              ←
            </Link>
            {mes}
            <Link
              href={`/${marca}/grilla/${mesSiguiente(mes)}`}
              aria-label="Mes siguiente"
              className="text-gray-400 hover:text-gray-800"
            >
              →
            </Link>
          </h1>
          <p className="mt-1 text-sm text-gray-600">
            Estado:{' '}
            {grilla.estado ? (ETIQUETAS_DE_ESTADO[grilla.estado] ?? grilla.estado) : 'Sin grilla'}
          </p>
        </div>

        <div className="flex flex-col items-end gap-3">
          {grilla.estado !== null && Object.keys(grilla.porCanal).length > 0 && (
            <div className="text-sm text-gray-600">
              {Object.entries(grilla.porCanal).map(([canal, cantidad]) => (
                <span key={canal} className="mr-3">
                  {canal}: {cantidad}
                </span>
              ))}
            </div>
          )}

          {grilla.estado === 'borrador' && grilla.contentPlanId && (
            <BotonAprobarGrilla marca={marca} mes={mes} contentPlanId={grilla.contentPlanId} />
          )}
        </div>
      </header>

      {grilla.avisos.length > 0 && (
        <ul className="mb-6 space-y-1 rounded border border-amber-300 bg-amber-50 p-3 text-sm text-amber-800">
          {grilla.avisos.map((aviso, i) => (
            <li key={i}>{aviso.detalle}</li>
          ))}
        </ul>
      )}

      {grilla.estado === null ? (
        <div className="rounded border border-dashed border-gray-300 p-8 text-center text-gray-600">
          <p>Este mes todavía no tiene grilla.</p>
          <p className="mt-2">
            Genérala con{' '}
            <code className="rounded bg-gray-100 px-1.5 py-0.5 text-sm text-gray-800">
              pnpm cli grilla:generar --marca {marca} --mes {mes}
            </code>
          </p>
        </div>
      ) : (
        <RejillaDelMes marca={marca} mes={mes} semanas={semanas} slots={grilla.slots} />
      )}
    </div>
  )
}
