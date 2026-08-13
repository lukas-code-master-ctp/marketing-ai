import { CANALES } from '@gc/db'
import { z } from 'zod'

const Canal = z.enum(CANALES)

/**
 * Lo que la persona responde antes de generar la estrategia del trimestre.
 *
 * El perfil de marca dice quién es la marca y no cambia casi nunca; esto dice
 * qué quiere lograr **este** trimestre, y caduca con él. Sin esto, P1 tenía
 * que inventar las métricas de los objetivos y el `mixDeCanales` entero.
 *
 * Los cinco campos opcionales son `z.string()` sin mínimo —presentes y
 * posiblemente vacíos— y no `.optional()`. La diferencia importa: «puede ir
 * vacío» y «puede no estar» son cosas distintas para quien lea el JSON, y
 * este proyecto ya pagó esa ambigüedad una vez, en las reglas del prompt del
 * perfil.
 */
export const Encargo = z.object({
  /** Qué quieres que pase en estos tres meses. */
  objetivo: z.string().min(10),
  /** En qué número lo verías. Alimenta `objetivos[].metrica` y `.meta`. */
  comoSeMide: z.string().min(5),
  /**
   * Total de publicaciones por semana que puedes sostener, sumando canales.
   * El tope no juzga si el plan es sensato —eso lo decides tú al leer la
   * estrategia—: solo ataja un cero escrito de más.
   */
  publicacionesPorSemana: z.number().int().min(1).max(50),
  /** En qué canales puedes publicar este trimestre. */
  canalesDisponibles: z.array(Canal).min(1),
  /** Un lanzamiento, una temporada, un evento. */
  queEstaPasando: z.string(),
  queFunciono: z.string(),
  queNoFunciono: z.string(),
  /** Lo que este trimestre no se toca. No es el léxico prohibido del perfil,
   *  que es lo que la marca nunca dice y no caduca. */
  queEvitar: z.string(),
  algoMas: z.string(),
})

export type TipoEncargo = z.infer<typeof Encargo>
