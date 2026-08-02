import { redirect } from 'next/navigation'
import { conexion, marcasDeLaOrganizacion, organizacionPorDefecto } from '../datos.js'

// Sin esto Next prerenderiza la ruta y congela el mes y la marca en el momento
// del build: despliegas en agosto y en septiembre sigue redirigiendo a agosto.
export const dynamic = 'force-dynamic'

export default async function Inicio() {
  const db = conexion()
  const marcas = await marcasDeLaOrganizacion(db, await organizacionPorDefecto(db))

  if (marcas.length === 0) {
    return <p className="p-8">No hay marcas cargadas. Créalas con <code>pnpm cli marca:crear</code>.</p>
  }

  const ahora = new Date()
  const mes = `${ahora.getUTCFullYear()}-${String(ahora.getUTCMonth() + 1).padStart(2, '0')}`
  redirect(`/${marcas[0]!.slug}/grilla/${mes}`)
}
