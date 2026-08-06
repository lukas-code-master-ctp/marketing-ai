import { describe, expect, it, vi } from 'vitest'
import { despertarWorker } from './despertar.js'

describe('despertarWorker', () => {
  it('sin configuración no hace nada y no falla', async () => {
    // El camino local. Si esto lanzara, cada encolado desde la máquina de
    // desarrollo devolvería un error al usuario por algo que no está roto.
    //
    // Espiar `console.error` no es adorno: `despertarWorker` devuelve
    // `Promise<void>` y tiene todo el cuerpo dentro de un `try/catch` que
    // traga, así que `resolves.toBeUndefined()` **sola** se cumple para
    // cualquier entrada y cualquier estado del código — es una tautología
    // sobre la firma, no una garantía. La aserción que sí muerde es que no se
    // registró nada: si alguien mueve la construcción del cliente o la llamada
    // a la red arriba del retorno temprano, el fallo cae en el `catch`, sale
    // la línea de log, y esta prueba se pone roja.
    const espia = vi.spyOn(console, 'error').mockImplementation(() => {})
    try {
      await expect(despertarWorker({})).resolves.toBeUndefined()
      expect(espia).not.toHaveBeenCalled()
    } finally {
      espia.mockRestore()
    }
  })

  it('con solo WORKER_TOKEN tampoco hace nada: es el worker local', async () => {
    // `WORKER_TOKEN` es la única de las seis con consumidor local —el worker
    // no arranca sin ella—, así que tenerla en el `.env` de la raíz es una
    // configuración correcta y tiene que ser silenciosa. Ver `destino.ts`.
    const espia = vi.spyOn(console, 'error').mockImplementation(() => {})
    try {
      await expect(despertarWorker({ WORKER_TOKEN: 'local' })).resolves.toBeUndefined()
      expect(espia).not.toHaveBeenCalled()
    } finally {
      espia.mockRestore()
    }
  })

  it('una configuración a medias se registra pero no rompe el encolado', async () => {
    // La corrida ya está escrita en la base cuando esto corre, y la red de
    // seguridad la va a levantar igual. Fallar acá convertiría un problema de
    // configuración en un error visible sobre una operación que sí funcionó.
    const espia = vi.spyOn(console, 'error').mockImplementation(() => {})
    try {
      await expect(despertarWorker({ WORKER_URL: 'https://x.run.app' })).resolves.toBeUndefined()
      expect(espia).toHaveBeenCalledWith(
        expect.stringContaining('[despertador]'),
        expect.stringContaining('CLOUD_TASKS_PROYECTO'),
      )
    } finally {
      espia.mockRestore()
    }
  })
})
