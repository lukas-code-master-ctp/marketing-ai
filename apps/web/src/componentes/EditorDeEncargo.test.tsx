// @vitest-environment jsdom
import { cleanup, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { EditorDeEncargo } from './EditorDeEncargo.js'
import { guardarEncargoAction } from '../acciones.js'

vi.mock('../acciones.js', () => ({
  guardarEncargoAction: vi.fn(async () => ({ ok: true, datos: null })),
}))

// Sin esto el DOM de una prueba queda montado para la siguiente: este archivo
// no usa `globals: true`, así que `@testing-library/react` no engancha su
// limpieza automática, y las siete pruebas comparten un mismo `document` si
// no se limpia a mano. Cada prueba de componente del proyecto lo hace igual
// (ver `EditorDePerfil.test.tsx`).
afterEach(cleanup)

const ENCARGO = {
  objetivo: 'Vender las doce parcelas que quedan del loteo norte',
  comoSeMide: 'Formularios de contacto recibidos',
  publicacionesPorSemana: 4,
  canalesDisponibles: ['instagram', 'blog'],
  queEstaPasando: '',
  queFunciono: '',
  queNoFunciono: '',
  queEvitar: '',
  algoMas: '',
}

const PROPS = { marca: 'parcelas', periodo: '2026-Q4', encargo: ENCARGO, soloLectura: false }

beforeEach(() => vi.mocked(guardarEncargoAction).mockClear())
afterEach(() => vi.restoreAllMocks())

// No hay `jest-dom` en este paquete (ver `FormularioDeMarca.test.tsx` y
// `EditorDePerfil.test.tsx`): `toHaveValue`, `toHaveAttribute` y
// `toBeDisabled` no existen. Se lee el elemento directamente.
function valorDe(etiqueta: RegExp): string {
  return (screen.getByLabelText(etiqueta) as HTMLInputElement | HTMLTextAreaElement).value
}

describe('EditorDeEncargo', () => {
  it('siembra los campos con el encargo guardado', () => {
    render(<EditorDeEncargo {...PROPS} />)
    expect(valorDe(/objetivo del trimestre/i)).toBe(ENCARGO.objetivo)
    expect(valorDe(/publicaciones por semana/i)).toBe('4')
  })

  it('guardar manda el encargo convertido a la forma del esquema', async () => {
    render(<EditorDeEncargo {...PROPS} />)
    await userEvent.click(screen.getByRole('button', { name: 'Guardar el encargo' }))

    const [slug, periodo, texto] = vi.mocked(guardarEncargoAction).mock.calls[0]!
    expect(slug).toBe('parcelas')
    expect(periodo).toBe('2026-Q4')
    // La capacidad viaja como número, no como el texto del input.
    expect(JSON.parse(texto).publicacionesPorSemana).toBe(4)
  })

  it('con campos obligatorios vacíos marca los campos y NO llama al servidor', async () => {
    // El servidor rechazaría igual, pero con un mensaje del esquema. Marcar
    // acá es lo que hace que el error se lea en español y junto al campo.
    render(<EditorDeEncargo {...PROPS} encargo={null} />)
    await userEvent.click(screen.getByRole('button', { name: 'Guardar el encargo' }))

    expect(guardarEncargoAction).not.toHaveBeenCalled()
    expect(screen.getByLabelText(/objetivo del trimestre/i).getAttribute('aria-invalid')).toBe('true')
  })

  it('el formulario vacío no muestra ningún error antes de intentar guardar', async () => {
    // El editor de perfil saludaba con dos errores rojos antes de escribir
    // nada, y eso fue un hallazgo de revisión. No se repite.
    render(<EditorDeEncargo {...PROPS} encargo={null} />)
    expect(screen.queryByRole('alert')).toBeNull()
    expect(screen.getByLabelText(/objetivo del trimestre/i).getAttribute('aria-invalid')).toBeNull()
  })

  it('elegir un canal lo suma a los ya marcados en el encargo que se manda', async () => {
    // No basta `toContain('linkedin')`: eso pasa igual si `alternarCanal`
    // reemplazara el arreglo entero por `[canal]` en vez de agregarle uno,
    // y ese cambio borraría en silencio los canales ya sembrados. La
    // aserción tiene que mirar el contenido completo del arreglo.
    render(<EditorDeEncargo {...PROPS} />)
    await userEvent.click(screen.getByRole('checkbox', { name: /linkedin/i }))
    await userEvent.click(screen.getByRole('button', { name: 'Guardar el encargo' }))

    const [, , texto] = vi.mocked(guardarEncargoAction).mock.calls[0]!
    expect(JSON.parse(texto).canalesDisponibles).toEqual(['instagram', 'blog', 'linkedin'])
  })

  it('desmarcar un canal lo saca del encargo que se manda y deja el otro', async () => {
    render(<EditorDeEncargo {...PROPS} />)
    await userEvent.click(screen.getByRole('checkbox', { name: /instagram/i }))
    await userEvent.click(screen.getByRole('button', { name: 'Guardar el encargo' }))

    const [, , texto] = vi.mocked(guardarEncargoAction).mock.calls[0]!
    expect(JSON.parse(texto).canalesDisponibles).toEqual(['blog'])
  })

  it('en solo lectura no hay forma de guardar', async () => {
    render(<EditorDeEncargo {...PROPS} soloLectura />)
    expect(screen.queryByRole('button', { name: 'Guardar el encargo' })).toBeNull()
    // El campo está dentro de un `<fieldset disabled>`: la propiedad `.disabled`
    // del elemento solo refleja su propio atributo, no la cascada del
    // ancestro (así lo define el estándar), pero el pseudo-selector
    // `:disabled` sí la contempla — y es lo mismo que usa un lector de
    // pantalla o el propio navegador para bloquear la edición.
    expect(screen.getByLabelText(/objetivo del trimestre/i).matches(':disabled')).toBe(true)
  })

  it('un fallo del servidor se muestra y no se anuncia éxito', async () => {
    vi.mocked(guardarEncargoAction).mockResolvedValueOnce({
      ok: false, mensaje: 'La estrategia está en estado «aprobada»', reintentable: false,
    })

    render(<EditorDeEncargo {...PROPS} />)
    await userEvent.click(screen.getByRole('button', { name: 'Guardar el encargo' }))

    expect(screen.getByRole('alert').textContent).toContain('aprobada')
    expect(screen.queryByText(/guardado/i)).toBeNull()
    // Sin `reintentable`, no hay razón para ofrecer el botón.
    expect(screen.queryByRole('button', { name: 'Reintentar' })).toBeNull()
  })

  it('un guardado exitoso anuncia el aviso de éxito por rol', async () => {
    // Antes, la única prueba sobre el éxito era negativa (`queryByText(/guardado/i)`
    // dentro de la prueba del fallo) y estaba acoplada al literal «guardado»:
    // renombrar el mensaje habría dejado el camino feliz sin cobertura, sin
    // poner ninguna prueba en rojo. Esta afirma por rol, no por texto.
    render(<EditorDeEncargo {...PROPS} />)
    expect(screen.queryByRole('status')).toBeNull()

    await userEvent.click(screen.getByRole('button', { name: 'Guardar el encargo' }))

    expect(screen.getByRole('status')).not.toBeNull()
  })

  it('un fallo transitorio ofrece «Reintentar», y reintentar vuelve a llamar al servidor', async () => {
    vi.mocked(guardarEncargoAction)
      .mockResolvedValueOnce({ ok: false, mensaje: 'La base no respondió', reintentable: true })
      .mockResolvedValueOnce({ ok: true, datos: null })

    render(<EditorDeEncargo {...PROPS} />)
    await userEvent.click(screen.getByRole('button', { name: 'Guardar el encargo' }))
    expect(screen.getByRole('alert').textContent).toContain('La base no respondió')

    await userEvent.click(screen.getByRole('button', { name: 'Reintentar' }))

    expect(vi.mocked(guardarEncargoAction)).toHaveBeenCalledTimes(2)
    expect(screen.getByRole('status')).not.toBeNull()
  })
})
