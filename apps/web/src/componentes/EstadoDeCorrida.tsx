'use client'

import type { CorridaEnCurso } from '@gc/operaciones'
// Del submódulo y no del barril: `@gc/operaciones` arrastra drizzle y el
// driver de Postgres, y esto es un componente de cliente. `senales.ts` no
// importa nada en tiempo de ejecución justamente para poder entrar aquí.
import {
  describirAntiguedad,
  SEGUNDOS_SIN_SENAL_PARA_ABANDONO,
} from '@gc/operaciones/senales'
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

  // El mismo control en los dos paneles que lo ofrecen: la promesa de que
  // reanudar no vuelve a pagar el modelo vale igual para una corrida fallida
  // que para una que se quedó colgada.
  function controlDeReanudar(clases: string) {
    return (
      <>
        <p className="mb-2 text-xs">
          Reanudar retoma donde quedó: los pasos que ya se completaron no se vuelven a ejecutar, así
          que el modelo no se cobra de nuevo.
        </p>
        <button
          type="button"
          disabled={ocupado}
          onClick={() => void reanudar()}
          className={`rounded border px-2 py-1 text-xs font-medium disabled:opacity-50 ${clases}`}
        >
          Reanudar
        </button>
        {error && <p className="mt-2 text-xs">{error}</p>}
      </>
    )
  }

  // Una corrida completada no tiene nada que anunciar: lo que hay que mirar es
  // el resultado, que ya está en la pantalla.
  if (corrida.estado === 'completado') return null

  if (corrida.estado === 'fallido') {
    return (
      <div className="mb-4 rounded border border-red-300 bg-red-50 p-3 text-sm text-red-900">
        <p className="mb-2 font-medium">La generación falló.</p>
        <p className="mb-2 whitespace-pre-wrap">{corrida.error}</p>
        {controlDeReanudar('border-red-400 hover:bg-red-100')}
      </div>
    )
  }

  // Una corrida que se quedó en `en_curso` sin dar señales es el modo de falla
  // que deja el worker al morir a mitad: `tomarCorridaPendiente` solo levanta
  // las `pendiente`, así que reiniciarlo no la rescata y la pantalla anunciaría
  // "Proponiendo la grilla…" para siempre. El umbral es el del dominio y los
  // segundos salen del mismo cálculo que su guarda, así que el botón aparece
  // exactamente cuando `reanudarCorridaEncolada` lo va a aceptar.
  const interrumpida =
    corrida.estado === 'en_curso' && corrida.segundosSinSenal > SEGUNDOS_SIN_SENAL_PARA_ABANDONO

  if (interrumpida) {
    return (
      <div className="mb-4 rounded border border-amber-300 bg-amber-50 p-3 text-sm text-amber-900">
        <p className="mb-2 font-medium">Esta generación parece haberse interrumpido.</p>
        <p className="mb-2">
          Empezó a ejecutarse pero no da señales desde hace{' '}
          {describirAntiguedad(corrida.segundosSinSenal)}. Lo normal es que el worker se haya
          detenido a mitad.
        </p>
        {controlDeReanudar('border-amber-400 hover:bg-amber-100')}
      </div>
    )
  }

  const abandonada = corrida.estado === 'pendiente' && corrida.encoladaHace > SEGUNDOS_PARA_SOSPECHAR

  if (abandonada) {
    return (
      <div className="mb-4 rounded border border-amber-300 bg-amber-50 p-3 text-sm text-amber-900">
        <p className="mb-2">
          Nadie tomó esta generación en {describirAntiguedad(corrida.encoladaHace)}. Lo normal es que
          el worker no esté corriendo.
        </p>
        <p className="mb-2">
          Levántalo con{' '}
          <code className="rounded bg-amber-100 px-1.5 py-0.5 text-xs">docker compose up -d</code>
        </p>
        {/* El worker construye el cliente del modelo al arrancar y prefiere no
            arrancar antes que marcar fallida toda la cola, así que sin la clave
            de OpenRouter —o sin marcha en seco— el contenedor sale con
            `Exited (1)` y esta pantalla repetiría el mismo texto para siempre.
            Es el único modo de falla nuevo que trae tener un worker aparte, y
            el comando de arriba no lo resuelve: hay que ir a mirar el log. */}
        <p>
          Si ya lo hiciste y sigue igual, mira{' '}
          <code className="rounded bg-amber-100 px-1.5 py-0.5 text-xs">
            docker compose logs worker
          </code>
          : sin la clave del modelo, o sin marcha en seco, el worker no arranca y se apaga solo.
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
