import { describe, expect, it } from 'vitest'
import { destinoDelDespertador } from './destino.js'

const COMPLETO = {
  CLOUD_TASKS_PROYECTO: 'gestor-contenido-ctp',
  CLOUD_TASKS_REGION: 'southamerica-east1',
  CLOUD_TASKS_COLA: 'generaciones',
  WORKER_URL: 'https://worker-abc.run.app',
  WORKER_CUENTA_DE_SERVICIO: 'invocador@gestor-contenido-ctp.iam.gserviceaccount.com',
  WORKER_TOKEN: 'un-token',
}

describe('destinoDelDespertador', () => {
  it('sin ninguna variable no hay a quién despertar', () => {
    // Es el caso local: el worker de Docker sondea solo, así que no hay nada
    // que avisar. Tiene que ser silencioso, no un error.
    expect(destinoDelDespertador({})).toEqual({ tipo: 'ninguno' })
  })

  it('con las seis variables resuelve por Cloud Tasks', () => {
    expect(destinoDelDespertador(COMPLETO)).toEqual({
      tipo: 'cloud-tasks',
      proyecto: 'gestor-contenido-ctp',
      region: 'southamerica-east1',
      cola: 'generaciones',
      urlDelWorker: 'https://worker-abc.run.app',
      cuentaDeServicio: 'invocador@gestor-contenido-ctp.iam.gserviceaccount.com',
      token: 'un-token',
      credenciales: null,
    })
  })

  it('una configuración a medias falla nombrando lo que falta', () => {
    // El caso peligroso, y la razón de que esto sea una función y no tres
    // `if`: quedarse callado ante una configuración incompleta deja la web
    // encolando sin despertar a nadie, y eso solo se nota como «tarda cinco
    // minutos» —el intervalo de la red de seguridad— sin ningún error.
    const { WORKER_TOKEN: _sinToken, ...aMedias } = COMPLETO
    expect(() => destinoDelDespertador(aMedias)).toThrow(/WORKER_TOKEN/)
  })

  it('una variable en blanco cuenta como ausente, no como valor', () => {
    expect(() => destinoDelDespertador({ ...COMPLETO, CLOUD_TASKS_COLA: '   ' })).toThrow(
      /CLOUD_TASKS_COLA/,
    )
  })

  it('lleva las credenciales cuando están, para Vercel', () => {
    // En Vercel no hay identidad de Google adherida, así que la misma variable
    // que usa la conexión a la base sirve para firmar contra Cloud Tasks.
    const d = destinoDelDespertador({
      ...COMPLETO,
      GOOGLE_CREDENCIALES_JSON: '{"type":"service_account"}',
    })
    expect(d).toMatchObject({ credenciales: '{"type":"service_account"}' })
  })

  it('quita la barra final de la URL del worker', () => {
    // La URL se concatena con `/trabajar`. Con la barra quedaría `//trabajar`,
    // que el servidor responde con 404 — y el síntoma sería «Cloud Tasks
    // reintenta para siempre», lejos de la causa.
    const d = destinoDelDespertador({ ...COMPLETO, WORKER_URL: 'https://worker-abc.run.app/' })
    expect(d).toMatchObject({ urlDelWorker: 'https://worker-abc.run.app' })
  })
})
