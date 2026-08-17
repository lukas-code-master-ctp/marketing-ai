import { describe, expect, it } from 'vitest'
import { PiezaDeContenido, esquemaDePieza } from './pieza.js'

const LINKEDIN = {
  canal: 'linkedin' as const,
  gancho: 'La mayoría de las flotas descubre el vencimiento cuando ya es multa.',
  cuerpo: 'Un párrafo que explica el problema y cómo se resuelve, con suficiente largo.',
  hashtags: ['gestiondeflota', 'tapcar'],
}

const BLOG = {
  canal: 'blog' as const,
  titulo: 'Cómo evitar multas por documentos vencidos',
  bajada: 'Una guía corta para quien administra una flota pequeña.',
  cuerpo: '## El problema\n\nTexto en Markdown con suficiente largo para ser un artículo.',
}

describe('PiezaDeContenido', () => {
  it('acepta una pieza de cada canal', () => {
    expect(PiezaDeContenido.safeParse(LINKEDIN).success).toBe(true)
    expect(PiezaDeContenido.safeParse(BLOG).success).toBe(true)
    expect(PiezaDeContenido.safeParse({
      canal: 'facebook', cuerpo: 'Un texto de largo suficiente para pasar.', hashtags: [],
    }).success).toBe(true)
    expect(PiezaDeContenido.safeParse({
      canal: 'instagram', caption: 'Un texto de largo suficiente.', hashtags: [], diapositivas: [],
    }).success).toBe(true)
    expect(PiezaDeContenido.safeParse({
      canal: 'tiktok', caption: 'Un texto corto.', guion: 'Lo que se dice, con largo suficiente.',
    }).success).toBe(true)
  })

  it('rechaza los campos de un canal en otro', () => {
    // Es el punto entero del discriminado: sin él, una pieza de LinkedIn
    // guardada en una fila de Instagram pasaría la validación y la pantalla
    // renderizaría campos vacíos sin decir por qué.
    expect(PiezaDeContenido.safeParse({ ...LINKEDIN, canal: 'instagram' }).success).toBe(false)
    expect(PiezaDeContenido.safeParse({ ...BLOG, canal: 'linkedin' }).success).toBe(false)
  })

  it('rechaza un canal que el sistema no publica', () => {
    expect(PiezaDeContenido.safeParse({ ...LINKEDIN, canal: 'podcast' }).success).toBe(false)
  })

  it('exige el gancho de LinkedIn, que es lo único que se ve antes de «ver más»', () => {
    const { gancho: _, ...sinGancho } = LINKEDIN
    expect(PiezaDeContenido.safeParse(sinGancho).success).toBe(false)
  })

  it('exige título y bajada en el blog', () => {
    const { titulo: _, ...sinTitulo } = BLOG
    expect(PiezaDeContenido.safeParse(sinTitulo).success).toBe(false)
    const { bajada: __, ...sinBajada } = BLOG
    expect(PiezaDeContenido.safeParse(sinBajada).success).toBe(false)
  })

  it('las diapositivas de Instagram pueden ir vacías', () => {
    // Se llenan solo cuando el formato del slot dice carrusel.
    expect(PiezaDeContenido.safeParse({
      canal: 'instagram', caption: 'Un texto de largo suficiente.', hashtags: [], diapositivas: [],
    }).success).toBe(true)
  })

  it('no impone ningún límite superior de caracteres', () => {
    // Los límites por canal viven en `validar(pieza)` del conector, en la
    // Fase 3, y en el prompt como instrucción. Ponerlos también acá sería la
    // cuarta lista de reglas sincronizada a mano de este repositorio.
    const largo = 'a'.repeat(20000)
    expect(PiezaDeContenido.safeParse({ ...LINKEDIN, cuerpo: largo }).success).toBe(true)
  })
})

describe('esquemaDePieza', () => {
  it('devuelve el esquema del canal, sin el discriminante', () => {
    // Es lo que se le pide al modelo: no tiene sentido que el modelo devuelva
    // el canal, que ya sabemos.
    const { canal: _, ...sinCanal } = LINKEDIN
    expect(esquemaDePieza('linkedin').safeParse(sinCanal).success).toBe(true)
  })

  it('el esquema de un canal rechaza la forma de otro', () => {
    const { canal: _, ...sinCanal } = BLOG
    expect(esquemaDePieza('linkedin').safeParse(sinCanal).success).toBe(false)
  })
})
