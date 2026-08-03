import type { SlotDeLaGrilla } from '@gc/operaciones'
import { describe, expect, it } from 'vitest'
import {
  derivadosVigentesDe, mesAnterior, mesSiguiente, semanasDelMes, slotsFueraDeLaRejilla,
} from './calendario.js'

describe('semanasDelMes', () => {
  it('siempre devuelve semanas completas de siete días', () => {
    for (const mes of ['2026-01', '2026-02', '2026-09', '2026-12', '2028-02']) {
      for (const semana of semanasDelMes(mes)) {
        expect(semana).toHaveLength(7)
      }
    }
  })

  it('empieza en lunes y cubre el mes entero', () => {
    // Septiembre de 2026 empieza en martes.
    const semanas = semanasDelMes('2026-09')
    expect(semanas[0]![0]).toBe('2026-08-31') // lunes de relleno
    expect(semanas[0]![1]).toBe('2026-09-01')
    expect(semanas.flat()).toContain('2026-09-30')
  })

  it('no agrega semanas de relleno de más', () => {
    // Junio de 2026 empieza lunes: la primera semana no necesita relleno.
    const semanas = semanasDelMes('2026-06')
    expect(semanas[0]![0]).toBe('2026-06-01')
  })

  it('cubre febrero bisiesto', () => {
    expect(semanasDelMes('2028-02').flat()).toContain('2028-02-29')
  })

  it('rechaza un mes mal formado', () => {
    expect(() => semanasDelMes('2026-13')).toThrow(/mes inválido/i)
  })
})

describe('derivadosVigentesDe', () => {
  function slot(id: string, idDelPadre: string | null, descartado = false): SlotDeLaGrilla {
    return {
      id,
      fecha: '2026-09-02',
      hora: '13:00',
      canal: 'blog',
      formato: 'articulo',
      pilar: 'educacion',
      angulo: 'guía práctica',
      brief: 'Explicar paso a paso cómo verificar la factibilidad antes de comprar.',
      descartado,
      esDerivado: idDelPadre !== null,
      idDelPadre,
    }
  }

  const padre = slot('padre', null)
  const otroPadre = slot('otro-padre', null)
  const hijoA = slot('hijo-a', 'padre')
  const hijoB = slot('hijo-b', 'padre')
  const hijoDeOtro = slot('hijo-de-otro', 'otro-padre')

  it('devuelve los derivados que cuelgan del padre pedido', () => {
    const todos = [padre, hijoA, otroPadre, hijoB, hijoDeOtro]
    expect(derivadosVigentesDe(todos, padre.id).map((s) => s.id)).toEqual(['hijo-a', 'hijo-b'])
  })

  it('un padre sin derivados no devuelve ninguno', () => {
    expect(derivadosVigentesDe([padre, otroPadre, hijoDeOtro], padre.id)).toEqual([])
  })

  // La comparación es `idDelPadre === id`, no `id === idDelPadre`: invertirla
  // haría que un derivado devolviera a su propio padre y la confirmación
  // ofreciera descartar la publicación original. Esta prueba es la que
  // distingue una dirección de la otra.
  it('un derivado pasado por error no arrastra a su padre', () => {
    expect(derivadosVigentesDe([padre, hijoA, hijoB], hijoA.id)).toEqual([])
  })

  it('no cuenta los derivados ya descartados', () => {
    const todos = [padre, hijoA, slot('hijo-b', 'padre', true)]
    expect(derivadosVigentesDe(todos, padre.id).map((s) => s.id)).toEqual(['hijo-a'])
  })
})

describe('slotsFueraDeLaRejilla', () => {
  const base = {
    hora: '10:00',
    canal: 'instagram',
    formato: 'carrusel',
    pilar: 'educativo',
    angulo: 'Un ángulo',
    brief: 'Un brief cualquiera con largo suficiente.',
    descartado: false,
    esDerivado: false,
    idDelPadre: null,
  }

  it('devuelve vacío cuando todos los slots caen en una celda', () => {
    const semanas = semanasDelMes('2026-09')
    const slots = [
      { ...base, id: 'a', fecha: '2026-09-01' },
      { ...base, id: 'b', fecha: '2026-09-30' },
      // Un día de relleno del mes vecino sí se renderiza, así que no está fuera.
      { ...base, id: 'c', fecha: semanas[0]![0]! },
    ]

    expect(slotsFueraDeLaRejilla(slots, semanas)).toEqual([])
  })

  it('encuentra el slot cuya fecha no aparece en ninguna semana', () => {
    const semanas = semanasDelMes('2026-09')
    const perdido = { ...base, id: 'perdido', fecha: '2026-11-15' }

    const dentro = { ...base, id: 'a', fecha: '2026-09-10' }
    const fuera = slotsFueraDeLaRejilla([dentro, perdido], semanas)

    expect(fuera).toEqual([perdido])
  })

  it('conserva el orden de entrada', () => {
    const semanas = semanasDelMes('2026-09')
    const uno = { ...base, id: 'uno', fecha: '2026-11-15' }
    const dos = { ...base, id: 'dos', fecha: '2026-01-02' }

    expect(slotsFueraDeLaRejilla([uno, dos], semanas).map((s) => s.id)).toEqual(['uno', 'dos'])
  })
})

describe('navegación', () => {
  it.each([
    ['2026-09', '2026-08', '2026-10'],
    ['2026-01', '2025-12', '2026-02'],
    ['2026-12', '2026-11', '2027-01'],
  ])('%s ← y →', (mes, anterior, siguiente) => {
    expect(mesAnterior(mes)).toBe(anterior)
    expect(mesSiguiente(mes)).toBe(siguiente)
  })
})
