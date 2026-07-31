import { clasificarHttp, ErrorDeDominio, permanente, transitorio } from '@gc/shared'
import type { ClienteLlm, MensajeLlm, PeticionLlm, RespuestaLlm } from './cliente.js'
import { ClienteDeMuestra } from './falso.js'

const URL_BASE = 'https://openrouter.ai/api/v1/chat/completions'

const ROL_EXTERNO: Record<MensajeLlm['rol'], string> = {
  sistema: 'system',
  usuario: 'user',
  asistente: 'assistant',
}

export class ClienteOpenRouter implements ClienteLlm {
  constructor(private readonly clave: string) {}

  async completar(p: PeticionLlm): Promise<RespuestaLlm> {
    let http: Response
    try {
      http = await fetch(URL_BASE, {
        method: 'POST',
        headers: {
          authorization: `Bearer ${this.clave}`,
          'content-type': 'application/json',
        },
        body: JSON.stringify({
          models: p.modelos,
          messages: p.mensajes.map((m) => ({ role: ROL_EXTERNO[m.rol], content: m.texto })),
          temperature: p.temperatura,
          max_tokens: p.maxTokens,
          usage: { include: true },
          response_format: {
            type: 'json_schema',
            json_schema: { name: p.nombreEsquema, strict: true, schema: p.esquemaJson },
          },
        }),
      })
    } catch (causa) {
      throw transitorio('No se pudo contactar a OpenRouter', causa)
    }

    if (!http.ok) {
      const detalle = await http.text().catch(() => '')
      const clase = clasificarHttp(http.status)
      throw new ErrorDeDominio(`OpenRouter respondió ${http.status}: ${detalle}`, clase)
    }

    const cuerpo = (await http.json()) as {
      model?: string
      choices?: Array<{ message?: { content?: string } }>
      usage?: { prompt_tokens?: number; completion_tokens?: number; cost?: number }
    }

    const texto = cuerpo.choices?.[0]?.message?.content
    if (typeof texto !== 'string') {
      throw permanente('OpenRouter devolvió una respuesta sin contenido')
    }

    return {
      texto,
      modelo: cuerpo.model ?? p.modelos[0]!,
      tokensEntrada: cuerpo.usage?.prompt_tokens ?? 0,
      tokensSalida: cuerpo.usage?.completion_tokens ?? 0,
      costoUsd: cuerpo.usage?.cost ?? 0,
    }
  }
}

export interface OpcionesDeCliente {
  env?: Record<string, string | undefined>
  carpetaDeMuestras?: string
}

/** Devuelve el cliente de muestra si IA_EN_SECO está activo; si no, el real. */
export function crearCliente(opciones: OpcionesDeCliente = {}): ClienteLlm {
  const env = opciones.env ?? process.env
  if (env.IA_EN_SECO === 'true') {
    const carpeta = opciones.carpetaDeMuestras ?? env.CARPETA_DE_MUESTRAS
    if (!carpeta) throw permanente('IA_EN_SECO requiere CARPETA_DE_MUESTRAS')
    return new ClienteDeMuestra(carpeta)
  }
  const clave = env.OPENROUTER_API_KEY
  if (!clave) throw permanente('Falta OPENROUTER_API_KEY')
  return new ClienteOpenRouter(clave)
}
