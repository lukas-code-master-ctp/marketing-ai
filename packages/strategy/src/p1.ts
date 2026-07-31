import {
  crearRegistrador, definirTarea, ejecutarTarea, exigirPresupuesto,
  type MensajeLlm,
} from '@gc/ai'
import { cargarPerfilVigente, contextoDeMarca } from '@gc/brand'
import { esquema } from '@gc/db'
import { definirPaso, type DefinicionDeFlujo } from '@gc/pipeline'
import { permanente } from '@gc/shared'
import { eq } from 'drizzle-orm'
import { readFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import { Estrategia, type TipoEstrategia } from './esquemas.js'
import type { Dependencias } from './tipos.js'

export const TAREA_ESTRATEGIA = definirTarea({
  nombre: 'generar_estrategia',
  nivel: 'razonamiento',
  esquema: Estrategia,
  temperatura: 0.6,
  maxTokensSalida: 3000,
})

const RUTA_PROMPT = fileURLToPath(new URL('./prompts/generar-estrategia.md', import.meta.url))

export interface EntradaP1 {
  brandId: string
  period: string
}

export interface SalidaP1 {
  strategyId: string
  estrategia: TipoEstrategia
}

export function crearFlujoEstrategia(deps: Dependencias): DefinicionDeFlujo {
  const paso = definirPaso<EntradaP1, SalidaP1>({
    nombre: 'generar_estrategia',
    ejecutar: async (entrada, ctx) => {
      await exigirPresupuesto(ctx.db, entrada.brandId, new Date())

      const { version, perfil } = await cargarPerfilVigente(ctx.db, entrada.brandId)
      const instrucciones = await readFile(RUTA_PROMPT, 'utf8')

      const mensajes: MensajeLlm[] = [
        { rol: 'sistema', texto: instrucciones },
        {
          rol: 'usuario',
          texto: [
            contextoDeMarca(perfil),
            '',
            `## Encargo`,
            `Genera la estrategia de contenido para el periodo ${entrada.period}.`,
          ].join('\n'),
        },
      ]

      const { datos } = await ejecutarTarea(TAREA_ESTRATEGIA, mensajes, {
        cliente: deps.cliente,
        ...(deps.env !== undefined ? { env: deps.env } : {}),
        registrarUso: crearRegistrador(ctx.db, {
          organizationId: ctx.organizationId,
          brandId: entrada.brandId,
          runId: ctx.runId,
          brandProfileVersion: version,
        }),
      })

      const [fila] = await ctx.db
        .insert(esquema.strategies)
        .values({
          organizationId: ctx.organizationId,
          brandId: entrada.brandId,
          period: entrada.period,
          data: datos,
          brandProfileVersion: version,
        })
        .onConflictDoUpdate({
          target: [esquema.strategies.brandId, esquema.strategies.period],
          // `status` queda fuera del set a propósito: un borrador sigue siendo
          // borrador, y el setWhere impide tocar una estrategia ya aprobada.
          set: { data: datos, brandProfileVersion: version },
          setWhere: eq(esquema.strategies.status, 'borrador'),
        })
        .returning()

      // Sin fila devuelta, el setWhere descartó la actualización: ya hay una
      // estrategia aprobada o archivada para ese periodo. Se escala en vez de
      // descartar en silencio el trabajo de revisión humana.
      if (!fila) {
        throw permanente(
          `Ya existe una estrategia aprobada para ${entrada.period} en la marca ` +
            `${entrada.brandId}. Archívala antes de regenerarla.`,
        )
      }

      return { strategyId: fila.id, estrategia: datos }
    },
  })

  return { nombre: 'p1_estrategia', pasos: [paso] }
}
