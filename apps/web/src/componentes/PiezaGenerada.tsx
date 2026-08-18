'use client'

import type { TipoPieza } from '@gc/strategy'
import { useState } from 'react'

/**
 * El texto de un campo simple, con su etiqueta arriba — el mismo patrón que
 * «Ángulo» y «Brief» en `PanelDeDetalle`.
 */
function Campo({ etiqueta, valor }: { etiqueta: string; valor: string }) {
  return (
    <div>
      <p className="mb-1 text-sm font-medium text-gray-700">{etiqueta}</p>
      <p className="whitespace-pre-wrap text-sm text-gray-800">{valor}</p>
    </div>
  )
}

/**
 * Antepone `#` a un hashtag que no lo trae. Un solo lugar para el criterio:
 * lo usan tanto `CampoLista` (lo que se ve en pantalla) como `textoPlano` (lo
 * que se copia), y antes cada uno tenía su propia copia — producían lo mismo
 * hoy, pero divergían en silencio si alguien cambiaba el criterio en una sola.
 */
function conNumeral(hashtag: string): string {
  return hashtag.startsWith('#') ? hashtag : `#${hashtag}`
}

/**
 * Una lista corta —hashtags, diapositivas— que no se renderiza cuando viene
 * vacía: una etiqueta «Diapositivas» sin nada debajo no informa nada, y para
 * los canales que no tienen ese campo (p. ej. TikTok no tiene diapositivas)
 * el llamador ni siquiera pasa un arreglo, así que esta guarda es la que
 * mantiene la pantalla honesta sobre lo que la pieza realmente trae.
 */
function CampoLista({ etiqueta, valores }: { etiqueta: string; valores: string[] }) {
  if (valores.length === 0) return null
  return (
    <div>
      <p className="mb-1 text-sm font-medium text-gray-700">{etiqueta}</p>
      <p className="text-sm text-gray-800">{valores.map(conNumeral).join(' ')}</p>
    </div>
  )
}

/**
 * Los campos de la pieza, uno por canal — `switch` exhaustivo sobre
 * `pieza.canal`: TypeScript lo comprueba porque `TipoPieza` es una unión
 * discriminada (`@gc/strategy`), así que un canal nuevo sin su rama acá no
 * compila.
 */
function campos(pieza: TipoPieza) {
  switch (pieza.canal) {
    case 'linkedin':
      return (
        <>
          <Campo etiqueta="Gancho" valor={pieza.gancho} />
          <Campo etiqueta="Cuerpo" valor={pieza.cuerpo} />
          <CampoLista etiqueta="Hashtags" valores={pieza.hashtags} />
        </>
      )
    case 'facebook':
      return (
        <>
          <Campo etiqueta="Cuerpo" valor={pieza.cuerpo} />
          <CampoLista etiqueta="Hashtags" valores={pieza.hashtags} />
        </>
      )
    case 'instagram':
      return (
        <>
          <Campo etiqueta="Descripción" valor={pieza.caption} />
          <CampoLista etiqueta="Hashtags" valores={pieza.hashtags} />
          <CampoLista etiqueta="Diapositivas" valores={pieza.diapositivas} />
        </>
      )
    case 'tiktok':
      return (
        <>
          <Campo etiqueta="Descripción" valor={pieza.caption} />
          <Campo etiqueta="Guion" valor={pieza.guion} />
        </>
      )
    case 'blog':
      return (
        <>
          <Campo etiqueta="Título" valor={pieza.titulo} />
          <Campo etiqueta="Bajada" valor={pieza.bajada} />
          <Campo etiqueta="Cuerpo" valor={pieza.cuerpo} />
        </>
      )
    default: {
      // Exhaustividad: si se agrega un canal a `TipoPieza` sin agregar su
      // rama acá, `pieza` deja de ser `never` y `tsc` rechaza esta línea.
      const _exhaustivo: never = pieza
      return _exhaustivo
    }
  }
}

/**
 * El texto plano del canal, listo para pegar en la red — es lo que el botón
 * de copiar pone en el portapapeles. Para LinkedIn: gancho, línea en blanco,
 * cuerpo y hashtags (el orden que pide la Task 7). Los demás canales siguen
 * el mismo espíritu: los campos en el orden en que se leen en pantalla,
 * separados por una línea en blanco.
 */
function textoPlano(pieza: TipoPieza): string {
  switch (pieza.canal) {
    case 'linkedin':
      return [pieza.gancho, '', pieza.cuerpo, '', formatoHashtags(pieza.hashtags)].join('\n')
    case 'facebook':
      return [pieza.cuerpo, '', formatoHashtags(pieza.hashtags)].join('\n')
    case 'instagram':
      return [pieza.caption, '', formatoHashtags(pieza.hashtags)].join('\n')
    case 'tiktok':
      return [pieza.caption, '', pieza.guion].join('\n')
    case 'blog':
      return [pieza.titulo, '', pieza.bajada, '', pieza.cuerpo].join('\n')
    default: {
      const _exhaustivo: never = pieza
      return _exhaustivo
    }
  }
}

function formatoHashtags(hashtags: string[]): string {
  return hashtags.map(conNumeral).join(' ')
}

/**
 * El texto de una pieza ya generada, de solo lectura — editar es 2C. Cada
 * canal muestra sus propios campos (`campos`, arriba) y un botón copia el
 * texto plano completo al portapapeles.
 *
 * El manejo del fallo de copiar es el mismo que ya resolvió `EditorDePerfil`:
 * `navigator.clipboard` exige contexto seguro y puede estar denegado por
 * permisos, así que si falla el texto sigue en pantalla —y seleccionable a
 * mano, porque son párrafos comunes— y el fallo se informa con `role="alert"`
 * en vez de bloquear nada.
 */
export function PiezaGenerada({ pieza }: { pieza: TipoPieza }) {
  const [copiado, setCopiado] = useState(false)
  const [errorDeCopia, setErrorDeCopia] = useState<string | null>(null)

  async function copiar() {
    setCopiado(false)
    setErrorDeCopia(null)
    try {
      await navigator.clipboard.writeText(textoPlano(pieza))
      setCopiado(true)
    } catch {
      setErrorDeCopia(
        'No se pudo copiar automáticamente. Selecciona el texto de arriba y cópialo a mano.',
      )
    }
  }

  return (
    <div className="mt-4 border-t border-gray-100 pt-4">
      <p className="mb-2 text-sm font-semibold text-gray-900">Pieza generada</p>
      <div className="space-y-3">{campos(pieza)}</div>
      <button
        type="button"
        onClick={() => void copiar()}
        className="mt-3 rounded border border-gray-300 px-3 py-1.5 text-sm font-medium text-gray-700 hover:bg-gray-50"
      >
        Copiar
      </button>
      {/* `role="status"`, no solo el texto: el fallo lleva `role="alert"` y se
          anuncia solo, y el éxito merece el mismo trato. */}
      {copiado && (
        <span role="status" className="ml-2 text-sm text-green-700">
          Copiado.
        </span>
      )}
      {errorDeCopia && (
        <p role="alert" className="mt-2 text-sm text-red-800">
          {errorDeCopia}
        </p>
      )}
    </div>
  )
}
