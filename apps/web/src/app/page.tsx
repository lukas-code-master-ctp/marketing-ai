import { redirect } from 'next/navigation'
import { FormularioDeMarca } from '../componentes/FormularioDeMarca.js'
import { conexion, marcasDeLaOrganizacion, organizacionPorDefecto } from '../datos.js'

// Sin esto Next prerenderiza la ruta y congela el mes y la marca en el momento
// del build: despliegas en agosto y en septiembre sigue redirigiendo a agosto.
export const dynamic = 'force-dynamic'

/**
 * `/` es dos cosas según cómo se llegue.
 *
 * Sin marcas, o con `?nueva`, es la pantalla de crear una marca. Con marcas y
 * sin el parámetro, sigue siendo el atajo de siempre a la grilla del mes
 * actual de la primera marca — quitarle el redirect para poner el formulario
 * habría cambiado el destino de todo el mundo por una pantalla que se usa una
 * vez por marca.
 *
 * El parámetro existe porque el redirect deja el formulario inalcanzable en
 * cuanto hay una marca, que es siempre después de la primera. El enlace
 * "Nueva marca" del encabezado apunta acá.
 */
export default async function Inicio({
  searchParams,
}: {
  searchParams: Promise<{ nueva?: string }>
}) {
  const { nueva } = await searchParams
  const db = conexion()
  const marcas = await marcasDeLaOrganizacion(db, await organizacionPorDefecto(db))

  if (marcas.length > 0 && nueva === undefined) {
    const ahora = new Date()
    const mes = `${ahora.getUTCFullYear()}-${String(ahora.getUTCMonth() + 1).padStart(2, '0')}`
    redirect(`/${marcas[0]!.slug}/grilla/${mes}`)
  }

  return (
    <div className="p-8">
      <h1 className="mb-4 text-xl font-semibold text-gray-900">Nueva marca</h1>
      {marcas.length === 0 && (
        <p className="mb-4 text-sm text-gray-600">
          Todavía no hay ninguna marca en esta organización. Crea la primera acá; el paso
          siguiente es cargarle el perfil.
        </p>
      )}
      <FormularioDeMarca />
    </div>
  )
}
