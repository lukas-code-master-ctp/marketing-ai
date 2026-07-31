import { describe, expect, it } from 'vitest'
import { z } from 'zod'
import { ejecutarTarea, type UsoDeLlamada } from './ejecutar.js'
import { ClienteFalso } from './falso.js'
import { definirTarea } from './tarea.js'

const TAREA = definirTarea({
  nombre: 'tarea_de_prueba',
  nivel: 'utilitario',
  esquema: z.object({ titulo: z.string(), puntaje: z.number() }),
  temperatura: 0.2,
  maxTokensSalida: 500,
})

const ENTORNO = { MODELO_UTILITARIO: 'proveedor/barato' }
const MENSAJES = [{ rol: 'usuario' as const, texto: 'hola' }]

describe('ejecutarTarea', () => {
  it('valida y devuelve los datos cuando el modelo responde bien', async () => {
    const cliente = new ClienteFalso(['{"titulo":"Hola","puntaje":8}'])
    const { datos, uso } = await ejecutarTarea(TAREA, MENSAJES, { cliente, env: ENTORNO })

    expect(datos).toEqual({ titulo: 'Hola', puntaje: 8 })
    expect(uso.tarea).toBe('tarea_de_prueba')
    expect(uso.hashDePrompt).toMatch(/^[a-f0-9]{16}$/)
  })

  it('repara una sola vez cuando la salida no valida', async () => {
    const cliente = new ClienteFalso([
      '{"titulo":"Hola"}',
      '{"titulo":"Hola","puntaje":8}',
    ])
    const { datos } = await ejecutarTarea(TAREA, MENSAJES, { cliente, env: ENTORNO })

    expect(datos.puntaje).toBe(8)
    expect(cliente.peticiones).toHaveLength(2)
    const segunda = cliente.peticiones[1]!
    expect(segunda.mensajes.at(-1)!.texto).toContain('puntaje')
  })

  it('falla de forma permanente si la reparación tampoco valida', async () => {
    const cliente = new ClienteFalso(['{"titulo":"a"}', '{"titulo":"b"}'])
    await expect(
      ejecutarTarea(TAREA, MENSAJES, { cliente, env: ENTORNO }),
    ).rejects.toMatchObject({ clase: 'permanente' })
    expect(cliente.peticiones).toHaveLength(2)
  })

  it('falla de forma permanente si la respuesta no es JSON', async () => {
    const cliente = new ClienteFalso(['no soy json', 'tampoco'])
    await expect(
      ejecutarTarea(TAREA, MENSAJES, { cliente, env: ENTORNO }),
    ).rejects.toMatchObject({ clase: 'permanente' })
  })

  it('envía el modelo principal y el de respaldo', async () => {
    const cliente = new ClienteFalso(['{"titulo":"a","puntaje":1}'])
    await ejecutarTarea(TAREA, MENSAJES, {
      cliente,
      env: { ...ENTORNO, MODELO_UTILITARIO_RESPALDO: 'proveedor/barato-alt' },
    })
    expect(cliente.peticiones[0]!.modelos).toEqual([
      'proveedor/barato',
      'proveedor/barato-alt',
    ])
  })

  it('entrega el uso al registrador cuando se provee', async () => {
    const registrado: unknown[] = []
    const cliente = new ClienteFalso(['{"titulo":"a","puntaje":1}'])
    await ejecutarTarea(TAREA, MENSAJES, {
      cliente,
      env: ENTORNO,
      registrarUso: async (u) => void registrado.push(u),
    })
    expect(registrado).toHaveLength(1)
  })

  it('registra también la llamada que falló y disparó la reparación', async () => {
    // La primera respuesta consumió tokens igual que la segunda: si no se
    // registra, el presupuesto mide algo distinto del gasto real.
    const registrado: UsoDeLlamada[] = []
    const cliente = new ClienteFalso([
      '{"titulo":"Hola"}',
      '{"titulo":"Hola","puntaje":8}',
    ])
    const { uso } = await ejecutarTarea(TAREA, MENSAJES, {
      cliente,
      env: ENTORNO,
      registrarUso: async (u) => void registrado.push(u),
    })

    expect(registrado).toHaveLength(2)
    expect(registrado.every((u) => u.tarea === 'tarea_de_prueba')).toBe(true)
    // El uso devuelto es el de la llamada que sí valió, y es la última fila.
    expect(registrado[1]).toEqual(uso)
  })

  it('registra las dos llamadas aunque la tarea termine fallando', async () => {
    const registrado: UsoDeLlamada[] = []
    const cliente = new ClienteFalso(['{"titulo":"a"}', '{"titulo":"b"}'])

    await expect(
      ejecutarTarea(TAREA, MENSAJES, {
        cliente,
        env: ENTORNO,
        registrarUso: async (u) => void registrado.push(u),
      }),
    ).rejects.toMatchObject({ clase: 'permanente' })

    expect(registrado).toHaveLength(2)
  })
})
