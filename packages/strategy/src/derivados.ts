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
 * consultar al modelo.
 *
 * Lo que sale de aquí se persiste tal cual, así que la expansión no puede
 * producir nada que `validarGrilla` rechazaría. Se descarta un derivado cuando:
 *
 * 1. su canal destino no está en el mix de la estrategia (regla de reciclaje
 *    mal configurada: la estrategia declara qué canales usa);
 * 2. su fecha cae fuera del mes planificado;
 * 3. ya hay un slot en ese mismo `(canal, fecha)`, sea un padre propuesto por
 *    el modelo o un derivado creado antes en esta misma expansión.
 *
 * El orden de recorrido —slots, luego reglas, luego canales destino— fija qué
 * derivado gana un día disputado, de modo que la expansión es determinística.
 */
export function expandirDerivados(
  slots: TipoSlotPropuesto[],
  estrategia: TipoEstrategia,
  mes: string,
): SlotDerivado[] {
  const derivados: SlotDerivado[] = []
  const canalesDelMix = new Set(estrategia.mixDeCanales.map((c) => c.canal))
  const ocupados = new Set(slots.map((s) => `${s.canal}|${s.fecha}`))

  slots.forEach((padre, indiceDelPadre) => {
    for (const regla of estrategia.reciclaje) {
      if (regla.desde !== padre.canal) continue

      for (const canal of regla.hacia) {
        if (!canalesDelMix.has(canal)) continue

        const fecha = sumarDias(padre.fecha, regla.diasDespues)
        if (!fecha.startsWith(`${mes}-`)) continue

        const clave = `${canal}|${fecha}`
        if (ocupados.has(clave)) continue
        ocupados.add(clave)

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
