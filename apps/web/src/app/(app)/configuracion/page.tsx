import { catalogoDeModelos, eleccionesDeModelo } from '@gc/operaciones'
import { SelectorDeModelo } from '../../../componentes/SelectorDeModelo.js'
import { conexion, organizacionPorDefecto } from '../../../datos.js'

// Árbol de rutas propio: el `force-dynamic` de las otras pantallas no llega
// hasta acá. Sin este, Next prerenderizaría la elección de modelos y la
// congelaría en el momento del build.
export const dynamic = 'force-dynamic'

/**
 * Para qué sirve cada nivel, en palabras del usuario y no en jerga. Un nivel
 * nuevo que el catálogo empiece a servir sin entrada acá cae al `??` de
 * `EXPLICACIONES[nivel]` — hoy no hace falta ese respaldo porque solo existen
 * los tres niveles de `NIVELES` (`packages/db/src/esquema.ts`), pero
 * escribirlo así evita que una pantalla completa se caiga el día que se
 * agregue un cuarto nivel sin acordarse de este archivo.
 */
const EXPLICACIONES: Record<string, string> = {
  razonamiento: 'Decide la estrategia del trimestre y arma la grilla del mes.',
  redaccion: 'Escribe el texto de cada pieza.',
  utilitario: 'Tareas auxiliares. Hoy no lo usa nada.',
}

/**
 * La pantalla donde se elige, por nivel, qué modelo usa esta organización.
 * Un bloque por nivel **presente en el catálogo**, no una lista fija: hoy
 * aparecen `razonamiento` y `redaccion`; `utilitario` no aparece porque
 * todavía no tiene candidatos en `model_catalog`. El día que alguien cargue
 * modelos de imágenes, esta pantalla crece sola.
 *
 * `SelectorDeModelo` recibe el catálogo completo —de todos los niveles— y
 * filtra por el suyo adentro (ver el comentario de ese componente); acá se
 * arma una sola vez, aplanando el `Map` que devuelve `catalogoDeModelos`, y
 * se le pasa igual a cada instancia.
 */
export default async function PaginaDeConfiguracion() {
  const db = await conexion()
  const organizationId = await organizacionPorDefecto(db)

  const catalogo = await catalogoDeModelos(db)
  const elecciones = await eleccionesDeModelo(db, organizationId)

  const candidatos = Array.from(catalogo.values()).flat()
  const niveles = Array.from(catalogo.keys())

  return (
    <div className="p-6">
      <h1 className="mb-1 text-xl font-semibold text-gray-900">Modelos</h1>
      <p className="mb-4 text-sm text-gray-600">
        Qué modelo de IA usa esta organización para cada tipo de tarea. El principal es el que
        se intenta primero; el de respaldo, si lo eliges, es al que se recurre cuando el
        principal falla.
      </p>

      {niveles.map((nivel) => (
        <SelectorDeModelo
          key={nivel}
          nivel={nivel}
          explicacion={EXPLICACIONES[nivel] ?? ''}
          candidatos={candidatos}
          eleccion={elecciones.find((e) => e.nivel === nivel) ?? null}
        />
      ))}
    </div>
  )
}
