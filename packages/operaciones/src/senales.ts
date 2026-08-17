import type { CorridaEnCurso } from './corridas.js'

/**
 * Lo que hay que saber de una corrida **sin tocar la base**: cuándo se la da
 * por abandonada, cómo se dice su antigüedad en palabras, y si sigue viva.
 *
 * Vive aparte de `corridas.ts` —y con su propia entrada en `exports`— porque
 * quien más lo necesita es la pantalla: `EstadoDeCorrida` es un componente de
 * cliente, e importar el barril de `@gc/operaciones` desde ahí arrastraría
 * drizzle y el driver de Postgres al bundle del navegador. Por eso este módulo
 * no importa nada en tiempo de ejecución: el único `import` es de tipo y se
 * borra al compilar.
 *
 * El punto de que sea uno solo es que la guarda del dominio y el texto de la
 * pantalla no puedan discrepar sobre qué cuenta como "sin señal".
 */

/**
 * Minutos sin dar señales de vida tras los cuales una corrida `en_curso` se
 * considera abandonada: se deja reanudar desde el dominio, y la pantalla
 * ofrece el botón.
 *
 * El número sale del peor turno realista del motor: cinco intentos con espera
 * exponencial de hasta treinta segundos cada uno, más la llamada al modelo de
 * cada intento. Es el mismo razonamiento con el que `docker-compose.yml` fijó
 * el `stop_grace_period` del worker en ciento ochenta segundos. Quince minutos
 * deja margen de sobra por encima de eso, y el reparto de riesgos manda hacia
 * arriba: pasarse de generoso cuesta que quien mira la pantalla espere un rato
 * antes de poder reanudar; quedarse corto cuesta que dos workers ejecuten el
 * mismo paso y **los dos paguen el modelo**, que es justo lo que esta guarda
 * existe para evitar.
 */
export const MINUTOS_SIN_SENAL_PARA_ABANDONO = 15

/** El mismo umbral en segundos, que es la unidad en la que viaja `segundosSinSenal`. */
export const SEGUNDOS_SIN_SENAL_PARA_ABANDONO = MINUTOS_SIN_SENAL_PARA_ABANDONO * 60

/** Antigüedad en palabras, para el mensaje que lee una persona. */
export function describirAntiguedad(segundos: number): string {
  const s = Math.max(0, Math.floor(segundos))
  if (s < 60) return `${s} segundo${s === 1 ? '' : 's'}`
  const m = Math.floor(s / 60)
  return `${m} minuto${m === 1 ? '' : 's'}`
}

/**
 * Duración en palabras, para un contador que se mira avanzar.
 *
 * Difiere de `describirAntiguedad` a propósito, y la diferencia es el motivo
 * de que existan las dos: aquella redondea a minutos, porque habla de un
 * pasado difuso —«no da señales desde hace 15 minutos»—, y ahí «15 min 3 s»
 * sería precisión falsa. Esta muestra los segundos siempre, porque su único
 * trabajo es demostrar que algo sigue vivo: con el refresco de dos segundos
 * del panel, el número se mueve, y un número que se mueve es la diferencia
 * entre «está trabajando» y «se colgó».
 *
 * Por eso los segundos tampoco se omiten cuando son cero: `1 min` a secas
 * quedaría inmóvil sesenta segundos.
 *
 * El recorte de la entrada es el mismo que aplica su vecina —relojes
 * desfasados entre la base y el proceso pueden dar un negativo— y conviene
 * que las dos coincidan en eso.
 */
export function describirDuracion(segundos: number): string {
  const s = Math.max(0, Math.floor(segundos))
  if (s < 60) return `${s} s`
  return `${Math.floor(s / 60)} min ${s % 60} s`
}

/**
 * Los estados en los que una corrida sigue viva: nadie sabe todavía que
 * terminó.
 *
 * Lo leen dos, y por eso está declarado una sola vez: la pantalla, para no
 * ofrecer el botón de generar mientras haya una corrida en vuelo, y la guarda
 * de `encolar`, que rechaza una segunda generación del mismo periodo. Con dos
 * listas, la pantalla podría esconder el botón en un caso que el dominio deja
 * pasar, o al revés.
 */
export const ESTADOS_VIVOS = ['pendiente', 'en_curso'] as const

/**
 * Una corrida está viva mientras nadie sepa que terminó: encolada o
 * ejecutándose.
 *
 * Lo usan las dos pantallas para no ofrecer el botón de generar mientras haya
 * una corrida en vuelo. Encolar una segunda no lo impedía nada, el worker
 * ejecutaba las dos, y **cada una paga el modelo**. Desde la revisión final el
 * dominio también lo rechaza: esto de acá es la mitad amable —no ofrecer lo
 * que va a fallar— y no la barrera.
 */
export function corridaViva(corrida: Pick<CorridaEnCurso, 'estado'> | null): boolean {
  return corrida !== null && (ESTADOS_VIVOS as readonly string[]).includes(corrida.estado)
}
