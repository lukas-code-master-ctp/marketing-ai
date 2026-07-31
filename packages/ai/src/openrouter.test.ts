import { afterEach, describe, expect, it, vi } from 'vitest'
import { ClienteOpenRouter } from './openrouter.js'

const PETICION = {
  modelos: ['proveedor/uno', 'proveedor/dos'],
  mensajes: [{ rol: 'usuario' as const, texto: 'hola' }],
  esquemaJson: { type: 'object' },
  nombreEsquema: 'tarea_de_prueba',
  temperatura: 0.3,
  maxTokens: 100,
}

afterEach(() => vi.unstubAllGlobals())

function respuestaHttp(cuerpo: unknown, status = 200) {
  return new Response(JSON.stringify(cuerpo), {
    status,
    headers: { 'content-type': 'application/json' },
  })
}

describe('ClienteOpenRouter', () => {
  it('traduce la respuesta del proveedor al contrato interno', async () => {
    const fetchFalso = vi.fn(async (..._args: Parameters<typeof fetch>) =>
      respuestaHttp({
        model: 'proveedor/uno',
        choices: [{ message: { content: '{"a":1}' } }],
        usage: { prompt_tokens: 120, completion_tokens: 30, cost: 0.00042 },
      }),
    )
    vi.stubGlobal('fetch', fetchFalso)

    const cliente = new ClienteOpenRouter('clave-secreta')
    const r = await cliente.completar(PETICION)

    expect(r).toEqual({
      texto: '{"a":1}',
      modelo: 'proveedor/uno',
      tokensEntrada: 120,
      tokensSalida: 30,
      costoUsd: 0.00042,
    })

    const cuerpo = JSON.parse(fetchFalso.mock.calls[0]![1]!.body as string)
    expect(cuerpo.models).toEqual(['proveedor/uno', 'proveedor/dos'])
    expect(cuerpo.response_format.json_schema.name).toBe('tarea_de_prueba')
    expect(cuerpo.usage).toEqual({ include: true })
  })

  it('clasifica 429 como transitorio', async () => {
    vi.stubGlobal('fetch', async () => respuestaHttp({ error: 'límite' }, 429))
    const cliente = new ClienteOpenRouter('clave')
    await expect(cliente.completar(PETICION)).rejects.toMatchObject({
      clase: 'transitorio',
    })
  })

  it('clasifica 400 como permanente', async () => {
    vi.stubGlobal('fetch', async () => respuestaHttp({ error: 'malo' }, 400))
    const cliente = new ClienteOpenRouter('clave')
    await expect(cliente.completar(PETICION)).rejects.toMatchObject({
      clase: 'permanente',
    })
  })

  it('clasifica una falla de red como transitoria', async () => {
    vi.stubGlobal('fetch', async () => {
      throw new Error('ECONNRESET')
    })
    const cliente = new ClienteOpenRouter('clave')
    await expect(cliente.completar(PETICION)).rejects.toMatchObject({
      clase: 'transitorio',
    })
  })
})
