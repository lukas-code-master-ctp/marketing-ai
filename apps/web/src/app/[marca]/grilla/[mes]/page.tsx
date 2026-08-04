import Link from 'next/link'
import { notFound } from 'next/navigation'
import { corridaDe, grillaDelMes } from '@gc/operaciones'
import { mesAnterior, mesSiguiente, semanasDelMes } from '../../../../calendario.js'
import { conexion, organizacionPorDefecto } from '../../../../datos.js'
import { BotonAprobarGrilla } from '../../../../componentes/BotonAprobarGrilla.js'
import { BotonGenerar } from '../../../../componentes/BotonGenerar.js'
import { BotonReabrirGrilla } from '../../../../componentes/BotonReabrirGrilla.js'
import { EstadoDeCorrida } from '../../../../componentes/EstadoDeCorrida.js'
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

  // La corrida más reciente de este mes, si la hay. Va después de
  // `grillaDelMes` a propósito: las dos resuelven la marca, y así una marca
  // inexistente sigue fallando por donde ya fallaba.
  const corrida = await corridaDe(db, organizationId, {
    slug: marca,
    flujo: 'p2_grilla',
    periodo: mes,
  })

  const bloqueantes = grilla.problemas.filter((p) => p.severidad === 'bloqueante')
  const avisos = grilla.problemas.filter((p) => p.severidad === 'aviso')

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

          {/* Regenerar solo se ofrece en borrador porque es lo único que el
              motor acepta: P2 rechaza una grilla que ya salió de borrador. */}
          {grilla.estado === 'borrador' && (
            <div className="flex flex-wrap items-start justify-end gap-2">
              <BotonGenerar
                marca={marca}
                periodo={mes}
                que="grilla"
                etiqueta="Regenerar grilla"
                advertencia={`Regenerar la grilla de ${mes} reemplaza todas sus publicaciones. Las que hayas descartado o editado se pierden.`}
              />
              {grilla.contentPlanId && (
                <BotonAprobarGrilla marca={marca} mes={mes} contentPlanId={grilla.contentPlanId} />
              )}
            </div>
          )}
          {grilla.estado === 'aprobada' && <BotonReabrirGrilla marca={marca} mes={mes} />}
        </div>
      </header>

      {corrida && <EstadoDeCorrida corrida={corrida} ruta={`/${marca}/grilla/${mes}`} />}

      {/* Bloqueantes y avisos son dos clases distintas de problema y se
          muestran distinto: un pilar que ya no existe en el perfil rompe la
          grilla, un desvío de cadencia solo la desafina. Antes los
          bloqueantes se filtraban antes de llegar aquí. */}
      {bloqueantes.length > 0 && (
        <div className="mb-4 rounded border-2 border-red-400 bg-red-50 p-3 text-sm text-red-900">
          <p className="mb-1 font-semibold">
            {bloqueantes.length === 1
              ? 'Esta grilla tiene un problema que hay que resolver'
              : `Esta grilla tiene ${bloqueantes.length} problemas que hay que resolver`}
          </p>
          <ul className="list-disc space-y-1 pl-5">
            {bloqueantes.map((p, i) => (
              <li key={i}>{p.detalle}</li>
            ))}
          </ul>
        </div>
      )}

      {avisos.length > 0 && (
        <ul className="mb-6 space-y-1 rounded border border-amber-300 bg-amber-50 p-3 text-sm text-amber-800">
          {avisos.map((aviso, i) => (
            <li key={i}>{aviso.detalle}</li>
          ))}
        </ul>
      )}

      {grilla.estado === null ? (
        <div className="rounded border border-dashed border-gray-300 p-8 text-center text-gray-600">
          <p className="mb-3">Este mes todavía no tiene grilla.</p>
          {/* El botón encola y devuelve; quien la genera es el worker. El
              avance aparece arriba, en `EstadoDeCorrida`. */}
          <div className="flex justify-center">
            <BotonGenerar marca={marca} periodo={mes} que="grilla" etiqueta="Generar grilla" />
          </div>
        </div>
      ) : (
        <RejillaDelMes
          marca={marca}
          mes={mes}
          estado={grilla.estado}
          semanas={semanas}
          slots={grilla.slots}
        />
      )}
    </div>
  )
}
