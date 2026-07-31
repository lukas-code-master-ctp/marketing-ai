export interface MensajeLlm {
  rol: 'sistema' | 'usuario' | 'asistente'
  texto: string
}

export interface PeticionLlm {
  /** Principal primero; el proveedor cae al siguiente si el primero falla. */
  modelos: string[]
  mensajes: MensajeLlm[]
  esquemaJson: unknown
  nombreEsquema: string
  temperatura: number
  maxTokens: number
}

export interface RespuestaLlm {
  texto: string
  modelo: string
  tokensEntrada: number
  tokensSalida: number
  costoUsd: number
}

export interface ClienteLlm {
  completar(peticion: PeticionLlm): Promise<RespuestaLlm>
}
