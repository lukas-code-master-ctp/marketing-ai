import { connect, createServer } from 'node:net'
import type { AddressInfo } from 'node:net'
import { describe, expect, it } from 'vitest'
import {
  ErrorDeDominio,
  ambiguo,
  clasificarError,
  clasificarHttp,
  clasificarPostgres,
  esTransitorio,
  esViolacionDeUnica,
  permanente,
  transitorio,
} from './errores.js'

describe('taxonomía de errores', () => {
  it('conserva clase y causa original', () => {
    const causa = new Error('socket colgado')
    const e = transitorio('la red falló', causa)
    expect(e).toBeInstanceOf(ErrorDeDominio)
    expect(e.clase).toBe('transitorio')
    expect(e.causa).toBe(causa)
    expect(e.message).toBe('la red falló')
  })

  it('marca los errores permanentes y ambiguos', () => {
    expect(permanente('esquema inválido').clase).toBe('permanente')
    expect(ambiguo('timeout al publicar').clase).toBe('ambiguo')
  })

  it.each([
    [408, 'transitorio'],
    [429, 'transitorio'],
    [500, 'transitorio'],
    [503, 'transitorio'],
    [400, 'permanente'],
    [401, 'permanente'],
    [404, 'permanente'],
  ])('clasifica el estado HTTP %i como %s', (status, esperado) => {
    expect(clasificarHttp(status)).toBe(esperado)
  })

  it('esTransitorio solo acepta ErrorDeDominio transitorios', () => {
    expect(esTransitorio(transitorio('x'))).toBe(true)
    expect(esTransitorio(permanente('x'))).toBe(false)
    expect(esTransitorio(new Error('x'))).toBe(false)
    expect(esTransitorio('x')).toBe(false)
  })
})

describe('clasificarPostgres', () => {
  it.each([
    ['40001', 'transitorio'],
    ['40P01', 'transitorio'],
    ['08000', 'transitorio'],
    ['08003', 'transitorio'],
    ['08006', 'transitorio'],
    ['08001', 'transitorio'],
    ['08004', 'transitorio'],
    ['53300', 'transitorio'],
    ['55P03', 'transitorio'],
    ['57P01', 'transitorio'],
    ['57014', 'transitorio'],
    ['23505', 'permanente'],
    ['23503', 'permanente'],
    ['23514', 'permanente'],
    ['22007', 'permanente'],
    ['42601', 'permanente'],
    ['', 'permanente'],
  ])('clasifica el código %s como %s', (codigo, esperado) => {
    expect(clasificarPostgres(codigo)).toBe(esperado)
  })

  it('no clasifica por familia: 08999 no es transitorio solo por empezar con 08', () => {
    expect(clasificarPostgres('08999')).toBe('permanente')
  })
})

describe('esViolacionDeUnica', () => {
  it('reconoce el 23505 y ningún otro código', () => {
    expect(esViolacionDeUnica(Object.assign(new Error('duplicate key'), { code: '23505' }))).toBe(true)
    expect(esViolacionDeUnica(Object.assign(new Error('foránea'), { code: '23503' }))).toBe(false)
    expect(esViolacionDeUnica(Object.assign(new Error('check'), { code: '23514' }))).toBe(false)
  })

  it('no confunde con lo que no trae código de Postgres', () => {
    expect(esViolacionDeUnica(new Error('sin código'))).toBe(false)
    expect(esViolacionDeUnica('23505')).toBe(false)
    expect(esViolacionDeUnica({ code: 23505 })).toBe(false)
    expect(esViolacionDeUnica(null)).toBe(false)
    expect(esViolacionDeUnica(undefined)).toBe(false)
  })
})

describe('clasificarError', () => {
  it('respeta la clase de un ErrorDeDominio', () => {
    expect(clasificarError(transitorio('x'))).toBe('transitorio')
    expect(clasificarError(permanente('x'))).toBe('permanente')
    expect(clasificarError(ambiguo('x'))).toBe('ambiguo')
  })

  it('clasifica un error de Postgres por su código', () => {
    const deadlock = Object.assign(new Error('deadlock detected'), { code: '40P01' })
    expect(clasificarError(deadlock)).toBe('transitorio')

    const duplicado = Object.assign(new Error('duplicate key'), { code: '23505' })
    expect(clasificarError(duplicado)).toBe('permanente')
  })

  it('trata como permanente cualquier otra cosa', () => {
    expect(clasificarError(new Error('cualquiera'))).toBe('permanente')
    expect(clasificarError(new TypeError('bug'))).toBe('permanente')
    expect(clasificarError('texto suelto')).toBe('permanente')
    expect(clasificarError(null)).toBe('permanente')
    expect(clasificarError({ code: 42 })).toBe('permanente')
  })

  it('esTransitorio delega en clasificarError', () => {
    const serializacion = Object.assign(new Error('could not serialize'), { code: '40001' })
    expect(esTransitorio(serializacion)).toBe(true)
    expect(esTransitorio(new Error('bug'))).toBe(false)
  })
})

/**
 * `pg` no envuelve los errores de conexión de `node:net`: los reemite tal
 * cual desde el socket (`pg/lib/connection.js`, `reportStreamError`). Por
 * eso ECONNREFUSED y ECONNRESET se reproducen acá con sockets reales de
 * `node:net` en vez de objetos armados a mano — es exactamente lo que `pg`
 * vería y reemitiría. ETIMEDOUT queda hand-crafted porque forzarlo de verdad
 * exige una dirección que no responda ni con RST ni con SYN-ACK ("agujero
 * negro" de red), algo que esta prueba no puede garantizar de forma rápida
 * ni portátil; se arma con la misma forma que Node documenta y que se
 * verificó abajo para los otros dos: un `Error` con `.code` como único dato
 * relevante.
 */
describe('clasificarError reconoce fallos de conexión sin SQLSTATE', () => {
  it('ECONNREFUSED real (nadie escucha en el puerto) se clasifica como transitorio', async () => {
    // Truco estándar para un ECONNREFUSED determinístico: abrir un servidor
    // efímero, anotar su puerto, cerrarlo, e intentar conectar a ese mismo
    // puerto — nada lo ocupa ya.
    const puerto = await new Promise<number>((resolve, reject) => {
      const servidor = createServer()
      servidor.once('error', reject)
      servidor.listen(0, '127.0.0.1', () => {
        const direccion = servidor.address() as AddressInfo
        servidor.close(() => resolve(direccion.port))
      })
    })

    const error = await new Promise<NodeJS.ErrnoException>((resolve) => {
      connect(puerto, '127.0.0.1').once('error', resolve)
    })

    expect(error.code).toBe('ECONNREFUSED')
    expect(clasificarError(error)).toBe('transitorio')
  })

  it('ECONNRESET real (el otro extremo resetea la conexión) se clasifica como transitorio', async () => {
    const servidor = createServer((socket) => {
      // `destroy()` a secas manda un cierre ordenado (FIN): el cliente vería
      // 'end', no un error. `resetAndDestroy()` fuerza el RST que produce
      // `ECONNRESET` del lado del cliente.
      socket.resetAndDestroy()
    })
    const puerto = await new Promise<number>((resolve) => {
      servidor.listen(0, '127.0.0.1', () => resolve((servidor.address() as AddressInfo).port))
    })

    const error = await new Promise<NodeJS.ErrnoException>((resolve) => {
      connect(puerto, '127.0.0.1').once('error', resolve)
    })
    servidor.close()

    expect(error.code).toBe('ECONNRESET')
    expect(clasificarError(error)).toBe('transitorio')
  })

  it('ETIMEDOUT se clasifica como transitorio', () => {
    const error = Object.assign(new Error('connect ETIMEDOUT 10.255.255.1:5432'), {
      code: 'ETIMEDOUT',
    })
    expect(clasificarError(error)).toBe('transitorio')
  })

  it('ENOTFOUND (DNS mal resuelto) sigue siendo permanente: no se agregó a propósito', () => {
    const error = Object.assign(new Error('getaddrinfo ENOTFOUND instancia-mal-escrita'), {
      code: 'ENOTFOUND',
    })
    expect(clasificarError(error)).toBe('permanente')
  })

  it('los códigos de red no interfieren con la clasificación por SQLSTATE', () => {
    // Ninguno de los tres coincide con un SQLSTATE real, pero lo confirma
    // una prueba en vez de confiar en que nunca vaya a coincidir.
    expect(clasificarPostgres('ECONNRESET')).toBe('permanente')
  })
})

/**
 * `'Connection terminated unexpectedly'` y `'timeout exceeded when trying to
 * connect'` son los dos mensajes literales que construyen `pg` y `pg-pool`
 * respectivamente cuando la conexión falla sin `.code` (verificado leyendo
 * el código fuente instalado: `pg/lib/client.js` para el primero,
 * `pg-pool/index.js` para el segundo). Ninguno de los dos añade otra
 * propiedad al `Error`, así que un `new Error(mensaje)` liso reproduce
 * exactamente lo que el driver construye — no es un mensaje inventado.
 * Reproducirlos con el driver real exigiría levantar un servidor que hable
 * el protocolo de arranque de Postgres; se juzgó desproporcionado para lo
 * que prueba este archivo.
 */
describe('clasificarError reconoce los mensajes de conexión sin código de pg/pg-pool', () => {
  it("'Connection terminated unexpectedly' (pg/lib/client.js) se clasifica como transitorio", () => {
    expect(clasificarError(new Error('Connection terminated unexpectedly'))).toBe('transitorio')
  })

  it("'timeout exceeded when trying to connect' (pg-pool/index.js) se clasifica como transitorio", () => {
    expect(clasificarError(new Error('timeout exceeded when trying to connect'))).toBe(
      'transitorio',
    )
  })

  it('un mensaje real pero distinto de pg-pool no se clasifica mal', () => {
    // Mensaje real y vecino, del mismo archivo: el timeout que llega
    // DESPUÉS de obtener el cliente del pool, no antes de eso.
    // Deliberadamente fuera de la lista (ver el comentario de
    // MENSAJES_DE_RED_TRANSITORIOS en errores.ts).
    const vecino = new Error('Connection terminated due to connection timeout')
    expect(clasificarError(vecino)).toBe('permanente')
  })

  it('un mensaje parecido por accidente no engaña a la comparación', () => {
    // Si `clasificarError` comparara por subcadena en vez de por igualdad
    // exacta, esto se colaría como transitorio sin serlo.
    const parecido = new Error(
      'the connection timeout exceeded when trying to connect to Redis',
    )
    expect(clasificarError(parecido)).toBe('permanente')
  })
})
