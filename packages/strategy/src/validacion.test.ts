import { PERFIL_VALIDO, validarPerfil } from '@gc/brand'
import { describe, expect, it } from 'vitest'
import type { TipoEstrategia } from './esquemas.js'
import { hayBloqueantes, validarGrilla, type ContextoDeValidacion } from './validacion.js'

const ESTRATEGIA: TipoEstrategia = {
  objetivos: [{ nombre: 'A', metrica: 'alcance', meta: '+10%' }],
  mensajesClave: ['uno que es largo', 'otro que es largo'],
  mixDeCanales: [
    { canal: 'blog', publicacionesPorSemana: 1 },
    { canal: 'linkedin', publicacionesPorSemana: 2 },
  ],
  reciclaje: [],
  temasPrioritarios: ['tema uno'],
}

const CTX: ContextoDeValidacion = {
  mes: '2026-09',
  perfil: validarPerfil(PERFIL_VALIDO),
  estrategia: ESTRATEGIA,
}

const slot = (p: Partial<Parameters<typeof validarGrilla>[0][number]> = {}) => ({
  fecha: '2026-09-03',
  hora: '13:00',
  canal: 'linkedin' as const,
  formato: 'post',
  pilar: 'educacion',
  angulo: 'mito común',
  brief: 'Desmontar el mito de que toda parcela tiene agua asegurada.',
  ...p,
})

describe('validarGrilla', () => {
  it('marca como bloqueante una fecha fuera del mes', () => {
    const p = validarGrilla([slot({ fecha: '2026-10-01' })], CTX)
    expect(p).toContainEqual(expect.objectContaining({ regla: 'fuera_de_mes', severidad: 'bloqueante' }))
  })

  it('marca como bloqueante un día que no existe en el mes', () => {
    const p = validarGrilla([slot({ fecha: '2026-09-31' })], CTX)
    expect(p).toContainEqual(
      expect.objectContaining({ regla: 'fecha_invalida', severidad: 'bloqueante' }),
    )
    // Un solo problema por la fecha: `fuera_de_mes` confundiría al modelo,
    // porque el prefijo AAAA-MM sí es el del mes pedido.
    expect(p.filter((x) => x.regla === 'fuera_de_mes')).toEqual([])
  })

  it('marca como bloqueante un día imposible de interpretar', () => {
    const p = validarGrilla([slot({ fecha: '2026-09-45' })], CTX)
    expect(p).toContainEqual(
      expect.objectContaining({ regla: 'fecha_invalida', severidad: 'bloqueante' }),
    )
  })

  it('acepta un 29 de febrero bisiesto', () => {
    const ctxBisiesto = { ...CTX, mes: '2028-02' }
    const p = validarGrilla([slot({ fecha: '2028-02-29' })], ctxBisiesto)
    expect(p.filter((x) => x.regla === 'fecha_invalida')).toEqual([])
  })

  it('marca como bloqueante un canal ausente del mix', () => {
    const p = validarGrilla([slot({ canal: 'tiktok' })], CTX)
    expect(p).toContainEqual(expect.objectContaining({ regla: 'canal_fuera_de_mix' }))
  })

  it('marca como bloqueante un pilar que no existe en el perfil', () => {
    const p = validarGrilla([slot({ pilar: 'inventado' })], CTX)
    expect(p).toContainEqual(expect.objectContaining({ regla: 'pilar_desconocido' }))
  })

  it('marca como bloqueante dos publicaciones del mismo canal el mismo día', () => {
    const p = validarGrilla([slot(), slot({ hora: '18:00' })], CTX)
    expect(p).toContainEqual(expect.objectContaining({ regla: 'duplicado_por_dia' }))
  })

  it('avisa cuando la cadencia se aleja de la estrategia', () => {
    const p = validarGrilla([slot()], CTX)
    const cadencia = p.filter((x) => x.regla === 'cadencia')
    expect(cadencia.length).toBeGreaterThan(0)
    expect(cadencia.every((x) => x.severidad === 'aviso')).toBe(true)
  })

  it('avisa cuando la distribución de pilares se desvía más de 10 puntos', () => {
    const slots = Array.from({ length: 10 }, (_, i) => ({
      ...slot({ fecha: `2026-09-${String(i + 1).padStart(2, '0')}` }),
      pilar: 'educacion',
    }))
    const p = validarGrilla(slots, CTX)
    expect(p).toContainEqual(
      expect.objectContaining({ regla: 'distribucion_de_pilares', severidad: 'aviso' }),
    )
  })

  it('hayBloqueantes distingue avisos de bloqueantes', () => {
    expect(hayBloqueantes([{ severidad: 'aviso', regla: 'x', detalle: 'y' }])).toBe(false)
    expect(hayBloqueantes([{ severidad: 'bloqueante', regla: 'x', detalle: 'y' }])).toBe(true)
  })
})
