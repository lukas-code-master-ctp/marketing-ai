import {
  crearRegistrador, definirTarea, ejecutarTarea, exigirPresupuesto,
  type MensajeLlm,
} from '@gc/ai'
import { cargarPerfilVigente, contextoDeMarca } from '@gc/brand'
import { esquema } from '@gc/db'
import { definirPaso, type DefinicionDeFlujo } from '@gc/pipeline'
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
          set: { data: datos, brandProfileVersion: version, status: 'borrador' },
        })
        .returning()

      return { strategyId: fila!.id, estrategia: datos }
    },
  })

  return { nombre: 'p1_estrategia', pasos: [paso] }
}
