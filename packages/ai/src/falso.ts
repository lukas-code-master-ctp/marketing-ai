import { permanente } from '@gc/shared'
import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import type { ClienteLlm, PeticionLlm, RespuestaLlm } from './cliente.js'

/** Cliente para pruebas: devuelve respuestas predefinidas en orden. */
export class ClienteFalso implements ClienteLlm {
  readonly peticiones: PeticionLlm[] = []
  private pendientes: string[]

  constructor(respuestas: string[]) {
    this.pendientes = [...respuestas]
  }

  async completar(peticion: PeticionLlm): Promise<RespuestaLlm> {
    this.peticiones.push(peticion)
    const texto = this.pendientes.shift()
    if (texto === undefined) {
      throw permanente('ClienteFalso se quedó sin respuestas predefinidas')
    }
    return {
      texto,
      modelo: peticion.modelos[0] ?? 'falso',
      tokensEntrada: 0,
      tokensSalida: 0,
      costoUsd: 0,
    }
  }
}

/**
 * Cliente de marcha en seco: lee la muestra `<carpeta>/<nombreEsquema>.json`.
 * Permite correr los flujos completos sin gastar tokens.
 */
export class ClienteDeMuestra implements ClienteLlm {
  constructor(private readonly carpeta: string) {}

  async completar(peticion: PeticionLlm): Promise<RespuestaLlm> {
    const ruta = join(this.carpeta, `${peticion.nombreEsquema}.json`)
    let texto: string
    try {
      texto = await readFile(ruta, 'utf8')
    } catch (causa) {
      throw permanente(`Falta la muestra de marcha en seco: ${ruta}`, causa)
    }
    return {
      texto,
      modelo: 'muestra',
      tokensEntrada: 0,
      tokensSalida: 0,
      costoUsd: 0,
    }
  }
}
