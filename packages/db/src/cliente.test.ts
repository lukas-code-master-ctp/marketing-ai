import { esViolacionDeUnica } from '@gc/shared'
import { sql } from 'drizzle-orm'
import { describe, expect, it, vi } from 'vitest'
import { crearConexion } from './cliente.js'
import { esquema } from './esquema.js'
import { conBaseDeDatosDePrueba } from './pruebas/entorno.js'

/**
 * `clasificarError` —el único punto del sistema donde se decide reintentar—
 * lee `e.code` del error que devuelve el driver. Las pruebas de
 * `esViolacionDeUnica` en `@gc/shared` construyen ese objeto a mano
 * (`{ code: '23505' }`) y por eso no detectarían que `node-postgres` expone
 * el SQLSTATE de otra forma. Esta prueba provoca una violación de unicidad
 * real contra la base y confirma que el error que de verdad lanza el driver
 * sigue siendo reconocido.
 */
describe('errores reales del driver', () => {
  it('esViolacionDeUnica reconoce una violación de unicidad real de node-postgres', async () => {
    await conBaseDeDatosDePrueba(async (db) => {
      await db.insert(esquema.users).values({ email: 'duplicado@ejemplo.cl', name: 'Uno' })

      const error = await db
        .insert(esquema.users)
        .values({ email: 'duplicado@ejemplo.cl', name: 'Otro' })
        .catch((e: unknown) => e)

      expect(esViolacionDeUnica(error)).toBe(true)
    })
  })
})

/**
 * `node-postgres` emite `'error'` sobre el `Pool` cuando un cliente OCIOSO se
 * cae (Postgres reiniciando, un corte de red, o —el caso real, porque la base
 * se muda a Cloud SQL— el otro extremo cerrando por inactividad). Sin oyente,
 * ese `'error'` se relanza como excepción no atrapada y tumba el proceso.
 * `postgres-js`, el driver anterior, no se comportaba así.
 *
 * Esta prueba reproduce la caída de verdad: abre una conexión, fuerza al pool
 * a crear un cliente, lo deja ocioso, y desde OTRA conexión termina ese
 * backend con `pg_terminate_backend` — exactamente lo que hace un servidor al
 * cortar una conexión ociosa. Si `crearConexion` no escuchara `'error'`, este
 * archivo de prueba completo moriría junto con el proceso de Vitest que lo
 * ejecuta, en vez de fallar con una aserción.
 *
 * Esa muerte del proceso es justo lo que no queda visible leyendo las
 * aserciones de abajo: `desaparecio` y `otraVez` pasarían igual si alguien
 * reemplazara el oyente por uno vacío (`pool.on('error', () => {})`), que ya
 * no tumba el proceso pero tampoco registra nada. Por eso se espía
 * `console.error` y se exige que haya quedado constancia de la caída: esa
 * aserción sí se rompe con esa mutación puntual, sin depender de que Vitest
 * detecte un proceso muerto.
 */
describe('conexión ociosa caída', () => {
  it(
    'una conexión ociosa terminada por el servidor no tumba el proceso, y la siguiente consulta funciona',
    async () => {
      const url = process.env.DATABASE_URL_TEST
      if (!url) throw new Error('Falta DATABASE_URL_TEST')

      const consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => {})

      const { db, cerrar } = crearConexion(url)
      try {
        // Fuerza al pool a abrir un cliente y captura el pid de su backend.
        // `pool.query()` —lo que usa drizzle por debajo— libera el cliente al
        // pool en cuanto la consulta termina, así que queda ocioso de inmediato.
        const { rows } = await db.execute<{ pg_backend_pid: number }>(
          sql`select pg_backend_pid()`,
        )
        const pid = rows[0]?.pg_backend_pid
        expect(typeof pid).toBe('number')

        const admin = crearConexion(url)
        try {
          await admin.db.execute(sql`select pg_terminate_backend(${pid})`)

          // `pg_terminate_backend` solo pide la señal: no espera a que el
          // backend termine de verdad. Se sondea `pg_stat_activity` hasta que
          // desaparece, con un límite, en vez de un `sleep` fijo que sería
          // escamoso bajo carga.
          const limite = Date.now() + 5000
          let desaparecio = false
          while (Date.now() < limite) {
            const resultado = await admin.db.execute(
              sql`select 1 from pg_stat_activity where pid = ${pid}`,
            )
            if (resultado.rows.length === 0) {
              desaparecio = true
              break
            }
            await new Promise((resolve) => setTimeout(resolve, 50))
          }
          expect(desaparecio).toBe(true)
        } finally {
          await admin.cerrar()
        }

        // Si el proceso hubiera muerto con la excepción no atrapada, nunca se
        // llegaría hasta acá. La consulta siguiente toma un cliente nuevo del
        // pool —el viejo ya fue descartado— y tiene que funcionar igual.
        const otraVez = await db.execute<{ uno: number }>(sql`select 1 as uno`)
        expect(otraVez.rows[0]?.uno).toBe(1)

        // La garantía en sí: el oyente de 'error' no solo evita la caída, deja
        // constancia de ella. Esta aserción es la que se rompe si alguien lo
        // reemplaza por un manejador vacío — la que no depende de que Vitest
        // note un proceso muerto.
        expect(consoleErrorSpy).toHaveBeenCalledWith(
          expect.stringMatching(/^\[db\] una conexión ociosa del pool se cayó/),
        )
      } finally {
        // El espía se restaura ANTES de cerrar: si `cerrar()` rechazara, el
        // `finally` se corta ahí y el espía quedaría puesto, envenenando las
        // pruebas siguientes del archivo con un `console.error` silenciado.
        consoleErrorSpy.mockRestore()
        await cerrar()
      }
    },
    15000,
  )
})
