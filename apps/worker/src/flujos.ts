import { crearFlujoEstrategia, crearFlujoGrilla, type Dependencias } from '@gc/flujos'
import type { DefinicionDeFlujo } from '@gc/pipeline'
import { permanente } from '@gc/shared'

/**
 * Los nombres son los que `pipeline_runs.flow` ya guarda desde que existe el
 * motor, así que este mapa no inventa una taxonomía nueva: la lee.
 *
 * Lo desconocido es `permanente` y no `ambiguo`: la fila viene de una versión
 * más nueva del código o está corrupta, y en los dos casos reintentarla solo
 * repite el fallo con el mismo worker.
 */
export function flujoDe(nombre: string, deps: Dependencias): DefinicionDeFlujo {
  if (nombre === 'p1_estrategia') return crearFlujoEstrategia(deps)
  if (nombre === 'p2_grilla') return crearFlujoGrilla(deps)

  throw permanente(
    `El worker no sabe ejecutar el flujo "${nombre}". Es una fila corrupta o de una ` +
      `versión más nueva del código, y reintentarla solo repetiría el fallo.`,
  )
}
