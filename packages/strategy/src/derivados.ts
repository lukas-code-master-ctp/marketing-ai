import type { TipoEstrategia, TipoSlotPropuesto } from './esquemas.js'

export interface SlotDerivado extends TipoSlotPropuesto {
  /** Posición del slot padre dentro del arreglo original. */
  indiceDelPadre: number
}

function sumarDias(fecha: string, dias: number): string {
  const d = new Date(`${fecha}T00:00:00Z`)
  d.setUTCDate(d.getUTCDate() + dias)
  return d.toISOString().slice(0, 10)
}

/**
 * Paso determinístico: aplica las reglas de reciclaje de la estrategia sin
 * consultar al modelo. Los derivados que caen fuera del mes se descartan.
 */
export function expandirDerivados(
  slots: TipoSlotPropuesto[],
  estrategia: TipoEstrategia,
  mes: string,
): SlotDerivado[] {
  const derivados: SlotDerivado[] = []

  slots.forEach((padre, indiceDelPadre) => {
    for (const regla of estrategia.reciclaje) {
      if (regla.desde !== padre.canal) continue

      for (const canal of regla.hacia) {
        const fecha = sumarDias(padre.fecha, regla.diasDespues)
        if (!fecha.startsWith(`${mes}-`)) continue

        derivados.push({
          ...padre,
          indiceDelPadre,
          canal,
          formato: 'derivado',
          fecha,
          angulo: `Adaptación para ${canal}: ${padre.angulo}`,
          brief: `Adaptar al formato de ${canal} la pieza original.\n\n${padre.brief}`,
        })
      }
    }
  })

  return derivados
}
