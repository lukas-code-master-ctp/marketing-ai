import { permanente } from '@gc/shared'

const MES_VALIDO = /^\d{4}-(0[1-9]|1[0-2])$/
const PERIODO_VALIDO = /^\d{4}-Q[1-4]$/

/** `2026-09` → `2026-Q3`. Es el vínculo entre la estrategia trimestral y la grilla mensual. */
export function trimestreDe(mes: string): string {
  if (!MES_VALIDO.test(mes)) {
    throw permanente(`Mes inválido "${mes}": se espera el formato AAAA-MM`)
  }
  const [anio, m] = mes.split('-')
  return `${anio}-Q${Math.ceil(Number(m) / 3)}`
}

export function validarPeriodo(periodo: string): string {
  if (!PERIODO_VALIDO.test(periodo)) {
    throw permanente(
      `Periodo inválido "${periodo}": se espera el formato AAAA-QN con N entre 1 y 4`,
    )
  }
  return periodo
}
