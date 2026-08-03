import type { SlotDeLaGrilla } from '@gc/operaciones'
// `@gc/strategy/periodos` y no `@gc/strategy`: desde que `derivadosVigentesDe`
// vive acá, este módulo lo importa `RejillaDelMes`, que es un componente de
// cliente. El barril del paquete arrastra @gc/db al bundle del navegador —vía
// `esquemas.ts`, y desde la unificación de lectura de estrategia también vía
// los constructores de consulta de drizzle de `estrategias.ts`— y ahí
// `node:crypto` y `net` no existen: el build de Next falla. La subruta trae
// solo las funciones de periodo, que no dependen de nada de eso. El tipo de
// `@gc/operaciones` es `import type` y se borra al compilar, así que no
// arrastra nada.
import { validarMes } from '@gc/strategy/periodos'

const DIA_EN_MS = 24 * 60 * 60 * 1000

function aFecha(anio: number, mes: number, dia: number): Date {
  return new Date(Date.UTC(anio, mes - 1, dia))
}

function comoISO(fecha: Date): string {
  return fecha.toISOString().slice(0, 10)
}

/**
 * Devuelve el mes partido en semanas de siete días AAAA-MM-DD, empezando en
 * lunes, con los días de relleno de los meses vecinos que hagan falta para
 * completar la primera y la última semana. Todo en UTC, como el resto del
 * sistema.
 */
export function semanasDelMes(mes: string): string[][] {
  validarMes(mes)
  const [anioStr, mesStr] = mes.split('-')
  const anio = Number(anioStr)
  const numeroMes = Number(mesStr)

  const primerDia = aFecha(anio, numeroMes, 1)
  const ultimoDia = aFecha(anio, numeroMes + 1, 0)

  // getUTCDay(): 0 = domingo … 6 = sábado. Distancia hasta el lunes anterior
  // o igual, tratando el domingo como 7 para que el lunes quede en 0.
  const diaDeLaSemana = (primerDia.getUTCDay() + 6) % 7
  const inicio = new Date(primerDia.getTime() - diaDeLaSemana * DIA_EN_MS)

  const semanas: string[][] = []
  let cursor = inicio
  while (cursor.getTime() <= ultimoDia.getTime()) {
    const semana: string[] = []
    for (let i = 0; i < 7; i++) {
      semana.push(comoISO(new Date(cursor.getTime() + i * DIA_EN_MS)))
    }
    semanas.push(semana)
    cursor = new Date(cursor.getTime() + 7 * DIA_EN_MS)
  }

  return semanas
}

function desplazarMes(mes: string, delta: number): string {
  validarMes(mes)
  const [anioStr, mesStr] = mes.split('-')
  const anio = Number(anioStr)
  const numeroMes = Number(mesStr)

  const fecha = new Date(Date.UTC(anio, numeroMes - 1 + delta, 1))
  const anioResultado = fecha.getUTCFullYear()
  const mesResultado = String(fecha.getUTCMonth() + 1).padStart(2, '0')
  return `${anioResultado}-${mesResultado}`
}

export function mesAnterior(mes: string): string {
  return desplazarMes(mes, -1)
}

export function mesSiguiente(mes: string): string {
  return desplazarMes(mes, 1)
}

/**
 * Los derivados vigentes de un slot: los que cuelgan de `idDelPadre` y no
 * están descartados. Un filtro sobre los slots que la página ya tiene
 * cargados, sin consulta extra.
 *
 * Vive aquí y no dentro de `RejillaDelMes` porque de esta derivación depende
 * qué filas escribe el flujo de "descartar también los N derivados": con la
 * comparación invertida, la confirmación cuenta unos slots y descarta otros,
 * en silencio y sin vuelta atrás. El renderizado sigue sin pruebas por
 * decisión de diseño; esto no puede seguir ahí adentro.
 */
export function derivadosVigentesDe(
  slots: SlotDeLaGrilla[],
  idDelPadre: string,
): SlotDeLaGrilla[] {
  return slots.filter((s) => s.idDelPadre === idDelPadre && !s.descartado)
}

/**
 * Los slots cuya fecha no aparece en ninguna de las semanas renderizadas.
 *
 * Un slot así no se muestra pero sí cuenta —en `porCanal` y en los problemas
 * que calcula `grillaDelMes`— y esa es la peor combinación: la cabecera dice
 * que hay algo que la rejilla no enseña. La rejilla los pinta aparte.
 *
 * Vive aquí y no dentro del componente por el mismo motivo que
 * `derivadosVigentesDe`: es una derivación sobre los datos cargados, y el
 * renderizado tiene arnés pero la lógica que decide qué se muestra merece su
 * propia prueba, independiente de cómo se pinte.
 */
export function slotsFueraDeLaRejilla(
  slots: SlotDeLaGrilla[],
  semanas: string[][],
): SlotDeLaGrilla[] {
  const renderizadas = new Set(semanas.flat())
  return slots.filter((s) => !renderizadas.has(s.fecha))
}
