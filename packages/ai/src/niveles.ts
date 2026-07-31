import { permanente } from '@gc/shared'

export type NivelDeModelo = 'razonamiento' | 'redaccion' | 'utilitario'

export interface ModelosDelNivel {
  principal: string
  respaldo: string
}

const VARIABLE_POR_NIVEL: Record<NivelDeModelo, string> = {
  razonamiento: 'MODELO_RAZONAMIENTO',
  redaccion: 'MODELO_REDACCION',
  utilitario: 'MODELO_UTILITARIO',
}

/**
 * Los identificadores de modelo nunca se escriben en el código: se configuran
 * por entorno y se cambian tras correr los evals.
 */
export function resolverNivel(
  nivel: NivelDeModelo,
  env: Record<string, string | undefined> = process.env,
): ModelosDelNivel {
  const variable = VARIABLE_POR_NIVEL[nivel]
  const principal = env[variable]
  if (!principal) {
    throw permanente(`Falta la variable de entorno ${variable} para el nivel "${nivel}"`)
  }
  return { principal, respaldo: env[`${variable}_RESPALDO`] ?? principal }
}
