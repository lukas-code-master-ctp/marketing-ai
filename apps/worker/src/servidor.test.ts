import { ClienteFalso } from '@gc/ai'
import { conBaseDeDatosDePrueba } from '@gc/db/pruebas'
import type { AddressInfo } from 'node:net'
import type { Server } from 'node:http'
import { describe, expect, it } from 'vitest'
import { crearServidor } from './servidor.js'

const TOKEN = 'token-de-prueba'
const ENV = { MODELO_RAZONAMIENTO: 'proveedor/fuerte' }

/** Levanta el servidor en un puerto efímero y lo cierra pase lo que pase. */
async function conServidor(
  db: Parameters<typeof crearServidor>[0]['db'],
  fn: (base: string) => Promise<void>,
): Promise<void> {
  const servidor: Server = crearServidor({
    db,
    deps: { cliente: new ClienteFalso([]), env: ENV },
    token: TOKEN,
  })
  await new Promise<void>((listo) => servidor.listen(0, '127.0.0.1', listo))
  const { port } = servidor.address() as AddressInfo
  try {
    await fn(`http://127.0.0.1:${port}`)
  } finally {
    await new Promise<void>((listo, falla) =>
      servidor.close((e) => (e ? falla(e) : listo())),
    )
  }
}

describe('el servidor del worker', () => {
  it('con el token correcto drena la cola y responde el recuento', async () => {
    await conBaseDeDatosDePrueba(async (db) => {
      await conServidor(db, async (base) => {
        const r = await fetch(`${base}/trabajar`, {
          method: 'POST',
          headers: { 'x-token-worker': TOKEN },
        })
        expect(r.status).toBe(200)
        expect(await r.json()).toEqual({ completadas: 0, fallidas: 0, quedaTrabajo: false })
      })
    })
  })

  it('sin el token responde 401 y no drena nada', async () => {
    await conBaseDeDatosDePrueba(async (db) => {
      await conServidor(db, async (base) => {
        const r = await fetch(`${base}/trabajar`, { method: 'POST' })
        expect(r.status).toBe(401)
      })
    })
  })

  it('con el token equivocado responde 401', async () => {
    await conBaseDeDatosDePrueba(async (db) => {
      await conServidor(db, async (base) => {
        const r = await fetch(`${base}/trabajar`, {
          method: 'POST',
          headers: { 'x-token-worker': 'otra-cosa' },
        })
        expect(r.status).toBe(401)
      })
    })
  })

  it('un token de largo distinto también responde 401', async () => {
    // La comparación de tiempo constante exige largos iguales antes de
    // comparar; sin esa guarda `timingSafeEqual` lanza y el servidor
    // respondería 500 en vez de 401, que es un oráculo distinto.
    await conBaseDeDatosDePrueba(async (db) => {
      await conServidor(db, async (base) => {
        const r = await fetch(`${base}/trabajar`, {
          method: 'POST',
          headers: { 'x-token-worker': 'x' },
        })
        expect(r.status).toBe(401)
      })
    })
  })

  it('otra ruta responde 404, y solo después de comprobar el token', async () => {
    await conBaseDeDatosDePrueba(async (db) => {
      await conServidor(db, async (base) => {
        const sinToken = await fetch(`${base}/otra-cosa`, { method: 'POST' })
        expect(sinToken.status).toBe(401)

        const conToken = await fetch(`${base}/otra-cosa`, {
          method: 'POST',
          headers: { 'x-token-worker': TOKEN },
        })
        expect(conToken.status).toBe(404)
      })
    })
  })

  it('GET sobre la ruta correcta responde 404', async () => {
    await conBaseDeDatosDePrueba(async (db) => {
      await conServidor(db, async (base) => {
        const r = await fetch(`${base}/trabajar`, {
          method: 'GET',
          headers: { 'x-token-worker': TOKEN },
        })
        expect(r.status).toBe(404)
      })
    })
  })
})
