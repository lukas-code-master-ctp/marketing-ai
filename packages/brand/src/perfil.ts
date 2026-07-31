import { permanente } from '@gc/shared'
import { z } from 'zod'

const SNAKE_CASE = /^[a-z][a-z0-9_]*$/

export const PerfilDeMarca = z.object({
  posicionamiento: z.object({
    categoria: z.string().min(3),
    promesa: z.string().min(10),
    diferenciadores: z.array(z.string().min(3)).min(1),
  }),
  publicos: z
    .array(
      z.object({
        nombre: z.string().min(3),
        dolor: z.string().min(10),
        objecion: z.string().min(10),
      }),
    )
    .min(1),
  tono: z.object({
    atributos: z.array(z.string().min(3)).min(1),
    hacer: z.array(z.string().min(3)),
    noHacer: z.array(z.string().min(3)),
  }),
  lexico: z.object({
    preferido: z.array(z.string()),
    prohibido: z.array(z.string()),
  }),
  pilares: z
    .array(
      z.object({
        nombre: z.string().regex(SNAKE_CASE, 'el nombre del pilar debe ser snake_case'),
        descripcion: z.string().min(5),
        proporcion: z.number().min(0).max(1),
      }),
    )
    .min(2),
  ofertas: z.array(
    z.object({
      nombre: z.string().min(3),
      descripcion: z.string().min(5),
      url: z.string().url().optional(),
    }),
  ),
  restricciones: z.object({
    disclaimers: z.array(z.string()),
  }),
})

export type TipoPerfilDeMarca = z.infer<typeof PerfilDeMarca>

const TOLERANCIA = 0.01

export function validarPerfil(crudo: unknown): TipoPerfilDeMarca {
  const r = PerfilDeMarca.safeParse(crudo)
  if (!r.success) {
    const detalle = r.error.issues
      .map((i) => `- ${i.path.join('.') || '(raíz)'}: ${i.message}`)
      .join('\n')
    throw permanente(`Perfil de marca inválido:\n${detalle}`)
  }

  const perfil = r.data
  const suma = perfil.pilares.reduce((t, p) => t + p.proporcion, 0)
  if (Math.abs(suma - 1) > TOLERANCIA) {
    throw permanente(
      `Las proporciones de los pilares deben sumar 1; suman ${suma.toFixed(2)}`,
    )
  }

  const nombres = perfil.pilares.map((p) => p.nombre)
  if (new Set(nombres).size !== nombres.length) {
    throw permanente('Hay nombres de pilar repetidos')
  }

  return perfil
}

/** Capa 2 del prompt: el contexto de marca, idéntico para todas las tareas. */
export function contextoDeMarca(perfil: TipoPerfilDeMarca): string {
  const lista = (xs: readonly string[]) => xs.map((x) => `- ${x}`).join('\n')

  return [
    '## Posicionamiento',
    `Categoría: ${perfil.posicionamiento.categoria}`,
    `Promesa: ${perfil.posicionamiento.promesa}`,
    'Diferenciadores:',
    lista(perfil.posicionamiento.diferenciadores),
    '',
    '## Públicos',
    perfil.publicos
      .map((p) => `- ${p.nombre} — dolor: ${p.dolor} — objeción: ${p.objecion}`)
      .join('\n'),
    '',
    '## Tono',
    `Atributos: ${perfil.tono.atributos.join(', ')}`,
    'Hacer:',
    lista(perfil.tono.hacer),
    'No hacer:',
    lista(perfil.tono.noHacer),
    '',
    '## Léxico',
    `Preferido: ${perfil.lexico.preferido.join(', ') || '(sin definir)'}`,
    `PROHIBIDO usar: ${perfil.lexico.prohibido.join(', ') || '(sin restricciones)'}`,
    '',
    '## Pilares de contenido',
    perfil.pilares
      .map((p) => `- ${p.nombre} (${Math.round(p.proporcion * 100)}%): ${p.descripcion}`)
      .join('\n'),
    '',
    '## Ofertas',
    perfil.ofertas
      .map((o) => `- ${o.nombre}: ${o.descripcion}${o.url ? ` (${o.url})` : ''}`)
      .join('\n'),
    '',
    '## Disclaimers obligatorios',
    lista(perfil.restricciones.disclaimers),
  ].join('\n')
}
