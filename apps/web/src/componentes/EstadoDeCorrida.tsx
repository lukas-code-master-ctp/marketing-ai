'use client'

import type { CorridaEnCurso } from '@gc/operaciones'
import { useRouter } from 'next/navigation'
import { useEffect, useState } from 'react'
import { reanudarCorridaAccion } from '../acciones.js'

/** Segundos tras los cuales una corrida `pendiente` deja de ser "en cola" y
 *  pasa a ser "nadie la tomó". Es el único detector del modo de falla que
 *  introduce tener un consumidor aparte: si el worker no corre, la pantalla
 *  diría "generando" para siempre. */
const SEGUNDOS_PARA_SOSPECHAR = 30

const REFRESCO_MS = 2000

/** Los nombres de paso son de máquina. Uno que no esté aquí se muestra tal
 *  cual: un paso nuevo en el motor no debe tumbar una pantalla. */
const PASOS_EN_PROSA: Record<string, string> = {
  generar_estrategia: 'Generando la estrategia',
  persistir_estrategia: 'Guardando la estrategia',
  proponer_grilla: 'Proponiendo la grilla',
  persistir_grilla: 'Guardando la grilla',
}

export function EstadoDeCorrida({ corrida, ruta }: { corrida: CorridaEnCurso; ruta: string }) {
  const router = useRouter()
  const [ocupado, setOcupado] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const viva = corrida.estado === 'pendiente' || corrida.estado === 'en_curso'

  // Refresca mientras hay algo que esperar, y **para cuando no lo hay**. Un
  // temporizador que no se detiene es la clase de cosa que se descubre semanas
  // después preguntándose por qué el ventilador no se apaga.
  //
  // El efecto va antes de cualquier `return`: los hooks no pueden quedar
  // detrás de una salida temprana.
  useEffect(() => {
    if (!viva) return
    const t = setInterval(() => router.refresh(), REFRESCO_MS)
    return () => clearInterval(t)
  }, [viva, router])

  async function reanudar() {
    setOcupado(true)
    setError(null)
    const r = await reanudarCorridaAccion(ruta, corrida.id)
    if (!r.ok) setError(r.mensaje)
    setOcupado(false)
  }

  // Una corrida completada no tiene nada que anunciar: lo que hay que mirar es
  // el resultado, que ya está en la pantalla.
  if (corrida.estado === 'completado') return null

  if (corrida.estado === 'fallido') {
    return (
      <div className="mb-4 rounded border border-red-300 bg-red-50 p-3 text-sm text-red-900">
        <p className="mb-2 font-medium">La generación falló.</p>
        <p className="mb-2 whitespace-pre-wrap">{corrida.error}</p>
        <p className="mb-2 text-xs">
          Reanudar retoma donde quedó: los pasos que ya se completaron no se vuelven a ejecutar, así
          que el modelo no se cobra de nuevo.
        </p>
        <button
          type="button"
          disabled={ocupado}
          onClick={() => void reanudar()}
          className="rounded border border-red-400 px-2 py-1 text-xs font-medium hover:bg-red-100 disabled:opacity-50"
        >
          Reanudar
        </button>
        {error && <p className="mt-2 text-xs">{error}</p>}
      </div>
    )
  }

  const abandonada = corrida.estado === 'pendiente' && corrida.encoladaHace > SEGUNDOS_PARA_SOSPECHAR

  if (abandonada) {
    return (
      <div className="mb-4 rounded border border-amber-300 bg-amber-50 p-3 text-sm text-amber-900">
        <p className="mb-2">
          Nadie tomó esta generación en {corrida.encoladaHace} segundos. Lo normal es que el worker
          no esté corriendo.
        </p>
        <p>
          Levántalo con{' '}
          <code className="rounded bg-amber-100 px-1.5 py-0.5 text-xs">docker compose up -d</code>
        </p>
      </div>
    )
  }

  return (
    <div className="mb-4 rounded border border-blue-300 bg-blue-50 p-3 text-sm text-blue-900">
      {corrida.estado === 'pendiente'
        ? 'En cola…'
        : `${corrida.pasoActual ? (PASOS_EN_PROSA[corrida.pasoActual] ?? corrida.pasoActual) : 'Generando'}…`}
    </div>
  )
}
