import type { TipoPerfilDeMarca } from '@gc/brand'
import type { TipoEstrategia, TipoSlotPropuesto } from './esquemas.js'

export interface Problema {
  severidad: 'bloqueante' | 'aviso'
  regla: string
  detalle: string
}

export interface ContextoDeValidacion {
  /** Mes objetivo en formato AAAA-MM. */
  mes: string
  perfil: TipoPerfilDeMarca
  estrategia: TipoEstrategia
}

const TOLERANCIA_DE_CADENCIA = 1
const TOLERANCIA_DE_PILAR = 0.1

export function hayBloqueantes(problemas: Problema[]): boolean {
  return problemas.some((p) => p.severidad === 'bloqueante')
}

function diasDelMes(mes: string): number {
  const [anio, m] = mes.split('-').map(Number)
  return new Date(Date.UTC(anio!, m!, 0)).getUTCDate()
}

/**
 * El esquema solo exige la forma AAAA-MM-DD, así que un día que no existe
 * llega hasta aquí. `new Date` lo desborda en silencio al mes siguiente
 * ("2026-09-31" → 1 de octubre) o devuelve Invalid Date ("2026-09-45"), y en
 * ambos casos el slot terminaría persistido con una fecha que nadie pidió.
 * Solo se acepta la fecha que sobrevive al ida y vuelta.
 */
function esFechaReal(fecha: string): boolean {
  const d = new Date(`${fecha}T00:00:00Z`)
  if (Number.isNaN(d.getTime())) return false
  return d.toISOString().slice(0, 10) === fecha
}

export function validarGrilla(
  slots: TipoSlotPropuesto[],
  ctx: ContextoDeValidacion,
): Problema[] {
  const problemas: Problema[] = []
  const bloqueante = (regla: string, detalle: string) =>
    problemas.push({ severidad: 'bloqueante', regla, detalle })
  const aviso = (regla: string, detalle: string) =>
    problemas.push({ severidad: 'aviso', regla, detalle })

  const canalesDelMix = new Set(ctx.estrategia.mixDeCanales.map((c) => c.canal))
  const pilaresConocidos = new Set(ctx.perfil.pilares.map((p) => p.nombre))
  const vistos = new Set<string>()

  for (const s of slots) {
    // La fecha se revisa primero y `fuera_de_mes` se salta si ya falló: una
    // fecha imposible con el prefijo correcto daría dos problemas que se
    // contradicen, y el modelo necesita uno solo y accionable.
    const fechaReal = esFechaReal(s.fecha)
    if (!fechaReal) {
      bloqueante('fecha_invalida', `La fecha ${s.fecha} no existe en el calendario`)
    } else if (!s.fecha.startsWith(`${ctx.mes}-`)) {
      bloqueante('fuera_de_mes', `El slot del ${s.fecha} no pertenece al mes ${ctx.mes}`)
    }
    if (!canalesDelMix.has(s.canal)) {
      bloqueante('canal_fuera_de_mix', `El canal "${s.canal}" no está en el mix de la estrategia`)
    }
    if (!pilaresConocidos.has(s.pilar)) {
      bloqueante(
        'pilar_desconocido',
        `El pilar "${s.pilar}" no existe en el perfil (válidos: ${[...pilaresConocidos].join(', ')})`,
      )
    }
    const clave = `${s.canal}|${s.fecha}`
    if (vistos.has(clave)) {
      bloqueante('duplicado_por_dia', `Hay dos publicaciones de ${s.canal} el ${s.fecha}`)
    }
    vistos.add(clave)
  }

  const semanas = diasDelMes(ctx.mes) / 7
  for (const c of ctx.estrategia.mixDeCanales) {
    const esperado = Math.round(c.publicacionesPorSemana * semanas)
    const real = slots.filter((s) => s.canal === c.canal).length
    if (Math.abs(real - esperado) > TOLERANCIA_DE_CADENCIA) {
      aviso(
        'cadencia',
        `${c.canal}: se planificaron ${real} publicaciones y la estrategia espera ~${esperado}`,
      )
    }
  }

  if (slots.length > 0) {
    for (const pilar of ctx.perfil.pilares) {
      const real = slots.filter((s) => s.pilar === pilar.nombre).length / slots.length
      if (Math.abs(real - pilar.proporcion) > TOLERANCIA_DE_PILAR) {
        aviso(
          'distribucion_de_pilares',
          `${pilar.nombre}: ${Math.round(real * 100)}% de la grilla frente al ${Math.round(pilar.proporcion * 100)}% esperado`,
        )
      }
    }
  }

  return problemas
}
