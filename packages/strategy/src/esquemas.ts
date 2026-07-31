import { CANALES } from '@gc/db'
import { z } from 'zod'

const Canal = z.enum(CANALES)

export const Estrategia = z.object({
  objetivos: z
    .array(
      z.object({
        nombre: z.string().min(3),
        metrica: z.string().min(3),
        meta: z.string().min(1),
      }),
    )
    .min(1)
    .max(4),
  mensajesClave: z.array(z.string().min(10)).min(2).max(6),
  mixDeCanales: z
    .array(
      z.object({
        canal: Canal,
        publicacionesPorSemana: z.number().int().min(0).max(21),
      }),
    )
    .min(1),
  /** Reglas deterministas de reciclaje que consume `expandirDerivados` (Task 9). */
  reciclaje: z.array(
    z.object({
      desde: Canal,
      hacia: z.array(Canal).min(1),
      diasDespues: z.number().int().min(0).max(30),
    }),
  ),
  temasPrioritarios: z.array(z.string().min(5)).min(1).max(10),
})

export type TipoEstrategia = z.infer<typeof Estrategia>

export const SlotPropuesto = z.object({
  fecha: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'formato esperado AAAA-MM-DD'),
  hora: z.string().regex(/^\d{2}:\d{2}$/, 'formato esperado HH:MM (UTC)'),
  canal: Canal,
  formato: z.string().min(2),
  pilar: z.string().min(2),
  angulo: z.string().min(5),
  brief: z.string().min(20),
})

export const GrillaPropuesta = z.object({
  slots: z.array(SlotPropuesto).min(1).max(120),
})

export type TipoSlotPropuesto = z.infer<typeof SlotPropuesto>
export type TipoGrillaPropuesta = z.infer<typeof GrillaPropuesta>
