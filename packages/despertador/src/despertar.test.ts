import { describe, expect, it, vi } from 'vitest'
import { despertarWorker } from './despertar.js'

describe('despertarWorker', () => {
  it('sin configuración no hace nada y no falla', async () => {
    // El camino local. Si esto lanzara, cada encolado desde la máquina de
    // desarrollo devolvería un error al usuario por algo que no está roto.
    await expect(despertarWorker({})).resolves.toBeUndefined()
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
