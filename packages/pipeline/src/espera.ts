const BASE_MS = 1000
const TECHO_MS = 30_000
const JITTER = 0.25

/** Backoff exponencial con jitter aditivo, en milisegundos. */
export function calcularEspera(intento: number, aleatorio: () => number = Math.random): number {
  const base = Math.min(BASE_MS * 2 ** (intento - 1), TECHO_MS)
  return Math.round(base * (1 + JITTER * aleatorio()))
}
