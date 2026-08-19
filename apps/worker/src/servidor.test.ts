import { ClienteFalso } from '@gc/ai'
import { conBaseDeDatosDePrueba } from '@gc/db/pruebas'
import { encolarGrilla } from '@gc/operaciones'
import { sembrarConEstrategia } from '@gc/operaciones/pruebas'
import { sql } from 'drizzle-orm'
import type { AddressInfo } from 'node:net'
import type { Server } from 'node:http'
import { describe, expect, it } from 'vitest'
import { crearServidor } from './servidor.js'

const TOKEN = 'token-de-prueba'
/** Mismo mes de 2026-Q3 que usan `tomar.test.ts` y `drenar.test.ts`: la siembra trae esa estrategia. */
const MES = '2026-09'

/** Levanta el servidor en un puerto efímero y lo cierra pase lo que pase. */
async function conServidor(
  db: Parameters<typeof crearServidor>[0]['db'],
  fn: (base: string) => Promise<void>,
): Promise<void> {
  const servidor: Server = crearServidor({
    db,
    deps: { cliente: new ClienteFalso([]) },
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

  // El punto de este arreglo: antes, cualquier excepción fuera del
  // `try/catch` que envolvía solo a `drenarCola` dejaba la promesa del
  // manejador rechazada sin manejar, y eso termina el proceso desde Node 15
  // — en Cloud Run, tumbaba la instancia entera en vez de responder. Ahora
  // hay un único manejador de errores adjunto a toda la petición, así que un
  // fallo de infraestructura tiene que devolver 500 —o sea, tiene que
  // devolver algo— y no colgar la petición ni matar el servidor.
  //
  // El disparador engancha `before update on pipeline_runs`, que es
  // exactamente la sentencia con la que `tomarCorridaPendiente` toma la
  // corrida (ver `packages/operaciones/src/corridas.ts`): la misma forma que
  // usa `tomar.test.ts` para simular un fallo de Postgres en una sentencia
  // concreta.
  it('un fallo de infraestructura al tomar la corrida responde 500 y no cuelga', async () => {
    await conBaseDeDatosDePrueba(async (db) => {
      const ref = await sembrarConEstrategia(db)
      await encolarGrilla(db, ref.organizationId, { slug: 'parcelas', mes: MES })

      await db.execute(sql`
        create or replace function gc_romper_toma() returns trigger
        language plpgsql as $$ begin raise exception 'la base se cayó al tomar la corrida'; end; $$
      `)
      await db.execute(sql`
        create trigger gc_romper_toma before update on pipeline_runs
        for each row execute function gc_romper_toma()
      `)
      try {
        await conServidor(db, async (base) => {
          const r = await fetch(`${base}/trabajar`, {
            method: 'POST',
            headers: { 'x-token-worker': TOKEN },
          })
          expect(r.status).toBe(500)
        })
      } finally {
        await db.execute(sql`drop trigger if exists gc_romper_toma on pipeline_runs`)
        await db.execute(sql`drop function if exists gc_romper_toma()`)
      }
    })
  })
})
