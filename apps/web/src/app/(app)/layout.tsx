import type { ReactNode } from 'react'
import { conexion, marcasDeLaOrganizacion, organizacionPorDefecto } from '../../datos.js'
import { SelectorDeMarca } from '../selector-de-marca.js'

// El layout consulta la base para armar el selector de marcas, así que este
// árbol tampoco puede prerenderizarse. `/entrar` queda fuera de este grupo de
// rutas a propósito (ver el comentario de `../layout.tsx`), así que no hereda
// esta directiva ni la consulta que la exige.
export const dynamic = 'force-dynamic'

/**
 * Layout de las rutas del dominio: `/`, `/[marca]/...`. Vive en el grupo de
 * rutas `(app)` — no agrega segmento a la URL— para que `/entrar` quede fuera
 * de su árbol. Antes este encabezado vivía en el layout raíz
 * (`app/layout.tsx`), que por eso envolvía también a `/entrar`: la pantalla
 * de entrada terminaba consultando la base para armar un selector de marcas
 * que nunca muestra, y exponía el nombre de las tres marcas de la
 * organización a cualquiera sin sesión que la pidiera. Ver el comentario de
 * `../layout.tsx` para el resto del razonamiento.
 */
export default async function LayoutDeApp({ children }: { children: ReactNode }) {
  const db = await conexion()
  const marcas = await marcasDeLaOrganizacion(db, await organizacionPorDefecto(db))

  return (
    <>
      <header className="p-4 border-b">
        <SelectorDeMarca marcas={marcas} />
      </header>
      {children}
    </>
  )
}
