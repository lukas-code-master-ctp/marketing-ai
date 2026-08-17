import type { Canal } from '@gc/db'
import { z } from 'zod'

/**
 * El texto de una pieza, con una forma por canal.
 *
 * Cinco formas y no una común, a propósito: un prompt que sabe que está
 * escribiendo para LinkedIn escribe mejor que uno genérico, y los campos que
 * importan difieren de verdad —el `gancho` de LinkedIn es la primera línea, lo
 * único que se ve antes de «ver más»; el blog necesita título y bajada—.
 *
 * El costo aceptado: cinco esquemas y cinco prompts que mantener.
 *
 * **Ningún campo lleva límite superior de caracteres.** Los límites por canal
 * viven donde el diseño general los puso: `validar(pieza)` en la interfaz del
 * conector, que corre antes de generar e informa al generador. Repetirlos acá
 * sería la cuarta lista de reglas sincronizada a mano de este repositorio —
 * `pendientes.md` ya registra tres—. En este bloque viajan en el prompt como
 * instrucción, y un copy demasiado largo se ve al leerlo.
 */

const cuerpoLargo = z.string().min(20)
const textoCorto = z.string().min(10)
const hashtags = z.array(z.string().min(2))

const FORMAS = {
  linkedin: { gancho: textoCorto, cuerpo: cuerpoLargo, hashtags },
  facebook: { cuerpo: cuerpoLargo, hashtags },
  instagram: { caption: cuerpoLargo, hashtags, diapositivas: z.array(z.string().min(2)) },
  tiktok: { caption: textoCorto, guion: cuerpoLargo },
  blog: { titulo: textoCorto, bajada: textoCorto, cuerpo: cuerpoLargo },
} as const satisfies Record<Canal, z.ZodRawShape>

/**
 * El esquema del canal **sin** el discriminante: es lo que se le pide al
 * modelo, que no tiene por qué devolver el canal, que ya sabemos.
 */
export function esquemaDePieza(canal: Canal): z.ZodTypeAny {
  return z.object(FORMAS[canal]).strict()
}

/**
 * La pieza tal como se guarda: la forma del canal más el canal adentro.
 *
 * El discriminante viaja **dentro de `data`** y no solo en la columna, para
 * que validar una fila leída de la base no exija consultar su slot — y para
 * que una pieza de LinkedIn guardada en una fila de Instagram se rechace en
 * vez de renderizarse con los campos vacíos.
 *
 * Las cinco variantes van literales y no derivadas de `CANALES.map(...)`:
 * con la versión de Zod de este proyecto, `z.discriminatedUnion` exige que
 * la tupla de opciones lleve el literal `canal` en su tipo, y `CANALES.map`
 * produce `ZodObject<ZodRawShape>[]` genérico — el `as unknown as` que
 * fuerza el tipo no compila (`tsc` rechaza el cast por no solaparse). La
 * lista de canales queda escrita dos veces —acá y en `CANALES`— y eso es
 * deuda: si se agrega un canal nuevo, hay que recordar tocar los dos
 * lugares, y nada avisa si alguien lo olvida.
 */
export const PiezaDeContenido = z.discriminatedUnion('canal', [
  z.object({ canal: z.literal('linkedin'), ...FORMAS.linkedin }).strict(),
  z.object({ canal: z.literal('facebook'), ...FORMAS.facebook }).strict(),
  z.object({ canal: z.literal('instagram'), ...FORMAS.instagram }).strict(),
  z.object({ canal: z.literal('tiktok'), ...FORMAS.tiktok }).strict(),
  z.object({ canal: z.literal('blog'), ...FORMAS.blog }).strict(),
])

export type TipoPieza = z.infer<typeof PiezaDeContenido>
