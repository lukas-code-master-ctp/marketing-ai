import Link from 'next/link'
import { notFound } from 'next/navigation'
import { corridaDe, grillaDelMes, piezasDelMes, resumenDePiezas } from '@gc/operaciones'
// Del submódulo: es el mismo predicado que usa la estrategia y no arrastra nada.
import { corridaViva } from '@gc/operaciones/senales'
// `@gc/operaciones` no reexporta `TipoPieza`: `piezasDelMes` lo usa en su
// firma pero no lo vuelve a exportar. Este es un componente de servidor, así
// que —a diferencia de `RejillaDelMes.tsx` y `PanelDeDetalle.tsx`— importar
// de `@gc/strategy` acá no arrastra nada al bundle del navegador.
import type { TipoPieza } from '@gc/strategy'
import { mesAnterior, mesSiguiente, semanasDelMes } from '../../../../../calendario.js'
import { conexion, organizacionPorDefecto } from '../../../../../datos.js'
import { BotonAprobarGrilla } from '../../../../../componentes/BotonAprobarGrilla.js'
import { BotonGenerar } from '../../../../../componentes/BotonGenerar.js'
import { BotonGenerarPiezas } from '../../../../../componentes/BotonGenerarPiezas.js'
import { BotonReabrirGrilla } from '../../../../../componentes/BotonReabrirGrilla.js'
import { EstadoDeCorrida } from '../../../../../componentes/EstadoDeCorrida.js'
import { RejillaDelMes } from '../../../../../componentes/RejillaDelMes.js'

// `[marca]/grilla/[mes]` es un árbol de rutas propio: el `force-dynamic` de
// `/` (Task 2) no llega hasta acá. Sin este, Next prerenderiza la grilla y
// la congela en el mes que estuviera vigente al momento del build.
export const dynamic = 'force-dynamic'

const ETIQUETAS_DE_ESTADO: Record<string, string> = {
  borrador: 'Borrador',
  aprobada: 'Aprobada',
  en_ejecucion: 'En ejecución',
  cerrada: 'Cerrada',
}

/** Concordancia de número para los textos de avance: nada de "1 fallaron". */
function singularOPlural(cantidad: number, singular: string, plural: string): string {
  return cantidad === 1 ? singular : plural
}

export default async function PaginaDeGrilla({
  params,
}: {
  params: Promise<{ marca: string; mes: string }>
}) {
  const { marca, mes } = await params

  // Un mes mal escrito en la URL (`/parcelas/grilla/foo`) no debe tumbar la
  // página con un error 500: se trata como ruta inexistente.
  let semanas: string[][]
  try {
    semanas = semanasDelMes(mes)
  } catch {
    notFound()
  }

  const db = await conexion()
  const organizationId = await organizacionPorDefecto(db)
  const grilla = await grillaDelMes(db, organizationId, marca, mes)

  // La corrida más reciente de este mes, si la hay. Va después de
  // `grillaDelMes` a propósito: las dos resuelven la marca, y así una marca
  // inexistente sigue fallando por donde ya fallaba.
  const corrida = await corridaDe(db, organizationId, {
    slug: marca,
    flujo: 'p2_grilla',
    periodo: mes,
  })

  // Con una corrida en vuelo no se ofrece generar. Nada impedía encolar una
  // segunda —el botón queda habilitado porque el estado de la grilla no cambia
  // hasta que el worker persiste—, el worker ejecutaba las dos y **cada una
  // pagaba el modelo**. El avance se ve en `EstadoDeCorrida`, y cuando termine
  // el botón vuelve solo.
  const enVuelo = corridaViva(corrida)

  // El resumen de las piezas —cuántas ya tiene, cuántas están en vuelo,
  // cuántas fallaron— es independiente de la corrida de P2 de arriba: son
  // corridas de `p3_pieza`, una por slot, y `resumenDePiezas` ya las cuenta
  // agrupadas. Se lee siempre, sin condicionarlo al estado de la grilla,
  // porque el cálculo es barato y el estado ya decide por su cuenta si se
  // muestra algo con él.
  const resumenPiezas = await resumenDePiezas(db, organizationId, { slug: marca, mes })

  // El mapa de `planSlotId` a pieza, para que `RejillaDelMes` se lo pase a
  // `PanelDeDetalle` del slot que esté abierto (Task 7). Solo tiene sentido
  // pedirlo cuando hay grilla que mostrar —sin ella no se monta
  // `RejillaDelMes` más abajo—, así que se condiciona igual que la sección de
  // la rejilla en vez de repetir el gasto de `resumenPiezas` de arriba.
  const piezas = grilla.estado !== null
    ? await piezasDelMes(db, organizationId, { slug: marca, mes })
    : new Map<string, TipoPieza>()

  // El botón se apaga en cuanto no queda nada por encolar: cada slot vigente
  // ya tiene pieza o ya tiene una corrida viva detrás. Encolar de nuevo ahí
  // no haría nada —`encolarPiezas` filtra los mismos candidatos— pero
  // ofrecerlo igual invitaría a creer que hace falta apretarlo otra vez.
  const mostrarBotonPiezas =
    grilla.estado === 'aprobada' &&
    resumenPiezas.listas + resumenPiezas.enVuelo < resumenPiezas.total

  // Los cuatro casos que la pantalla tiene que distinguir sin confundirlos:
  // con corridas vivas, el avance parcial (más las fallidas, si las hay); con
  // todo listo, que ya terminó; con la cola ya drenada pero algo fallado, que
  // tiene que decir qué hacer; y sin nada encolado todavía, donde no hay nada
  // que anunciar más que el botón mismo.
  let textoAvancePiezas: string | null = null
  if (resumenPiezas.enVuelo > 0) {
    textoAvancePiezas =
      `Escribiendo las piezas: ${resumenPiezas.listas} de ${resumenPiezas.total} ` +
      singularOPlural(resumenPiezas.total, 'lista', 'listas') +
      (resumenPiezas.fallidas > 0
        ? `, ${resumenPiezas.fallidas} ${singularOPlural(resumenPiezas.fallidas, 'falló', 'fallaron')}`
        : '')
  } else if (resumenPiezas.listas === resumenPiezas.total && resumenPiezas.total > 0) {
    textoAvancePiezas =
      resumenPiezas.total === 1
        ? 'La pieza está escrita'
        : `Las ${resumenPiezas.total} piezas están escritas`
  } else if (resumenPiezas.total > 0 && resumenPiezas.fallidas > 0) {
    // La cola ya se drenó (`enVuelo === 0`, la única forma de llegar hasta
    // acá) pero algo quedó fallido: sin esta rama el texto desaparecía justo
    // en el estado estable que el usuario mira, indistinguible de "no has
    // encolado nada" (Crítico 1 de la revisión de la rama). El guardián de
    // `total > 0` evita el caso degenerado de un mes con todos los slots
    // descartados: sin él, con `total === 0` y alguna corrida fallida de un
    // slot que ya no cuenta, el texto decía «0 de 0 piezas escritas, N
    // fallaron» (Importante A de la revisión de `feat/piezas-y-su-texto`).
    //
    // Lo que falta por escribir no es `resumenPiezas.fallidas`: ese número
    // cuenta corridas de `p3_pieza`, no slots, y una corrida fallida nunca se
    // limpia, así que con varias tandas de reintentos crece sin techo aunque
    // cada vez quede menos por hacer de verdad (Importante B de la misma
    // revisión — medido: dos tandas fallidas seguidas sobre 2 slots dejan
    // `fallidas` en 4 aunque solo falte reintentar 1). Con la cola drenada lo
    // que falta es exactamente `total - listas`, y coincide con lo que el
    // botón va a reencolar (`encolarPiezas` toma los slots sin pieza y sin
    // corrida viva). `resumenPiezas.fallidas` se deja como está —arreglarlo
    // exige decidir qué cuenta como "fallida vigente", ver `pendientes.md`—
    // pero esta pantalla ya no depende de él.
    const faltan = resumenPiezas.total - resumenPiezas.listas
    textoAvancePiezas =
      `${resumenPiezas.listas} de ${resumenPiezas.total} ` +
      singularOPlural(resumenPiezas.total, 'pieza escrita', 'piezas escritas') +
      `, ${faltan} ${singularOPlural(faltan, 'falló', 'fallaron')}.` +
      (mostrarBotonPiezas
        ? // El botón exige la grilla aprobada (`mostrarBotonPiezas`, arriba).
          // Mandar a apretarlo cuando no está en pantalla —reabrir deja la
          // grilla en borrador sin tocar las corridas ni las piezas ya
          // escritas— era el defecto medido en Importante A: el texto sí
          // aparece (la sección vive fuera del bloque de `aprobada`, ver más
          // abajo) pero el botón que menciona, no.
          ' Generar las piezas reintenta solo las que faltan, sin volver a pagar las que ya tienes.'
        : grilla.estado === 'borrador'
          ? ' Aprueba la grilla de nuevo para poder reintentarlas.'
          : '')
  }

  const bloqueantes = grilla.problemas.filter((p) => p.severidad === 'bloqueante')
  const avisos = grilla.problemas.filter((p) => p.severidad === 'aviso')

  // Regenerar borra todos los slots del mes y vuelve a insertarlos desde la
  // propuesta nueva (`persistir`, en `@gc/flujos/p2.ts`). Los descartes no se
  // recuentan en cadencia ni en pilares —la propuesta del modelo no los
  // conoce— pero sí desaparecen, y son lo único destruido que el usuario
  // puede contar antes de decidir.
  const descartados = grilla.slots.filter((s) => s.descartado).length

  return (
    <div className="p-6">
      <header className="mb-6 flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="flex items-center gap-3 text-xl font-semibold text-gray-900">
            <Link
              href={`/${marca}/grilla/${mesAnterior(mes)}`}
              aria-label="Mes anterior"
              className="text-gray-400 hover:text-gray-800"
            >
              ←
            </Link>
            {mes}
            <Link
              href={`/${marca}/grilla/${mesSiguiente(mes)}`}
              aria-label="Mes siguiente"
              className="text-gray-400 hover:text-gray-800"
            >
              →
            </Link>
          </h1>
          <p className="mt-1 text-sm text-gray-600">
            Estado:{' '}
            {grilla.estado ? (ETIQUETAS_DE_ESTADO[grilla.estado] ?? grilla.estado) : 'Sin grilla'}
          </p>
        </div>

        <div className="flex flex-col items-end gap-3">
          {grilla.estado !== null && Object.keys(grilla.porCanal).length > 0 && (
            <div className="text-sm text-gray-600">
              {Object.entries(grilla.porCanal).map(([canal, cantidad]) => (
                <span key={canal} className="mr-3">
                  {canal}: {cantidad}
                </span>
              ))}
            </div>
          )}

          {/* Regenerar solo se ofrece en borrador porque es lo único que el
              motor acepta: P2 rechaza una grilla que ya salió de borrador. */}
          {grilla.estado === 'borrador' && (
            <div className="flex flex-wrap items-start justify-end gap-2">
              {!enVuelo && (
                <BotonGenerar
                  marca={marca}
                  periodo={mes}
                  que="grilla"
                  etiqueta="Regenerar grilla"
                  advertencia={
                    `Regenerar la grilla de ${mes} reemplaza todas sus publicaciones. ` +
                    (descartados === 1
                      ? 'La que descartaste vuelve a aparecer, y las ediciones que hiciste a mano se pierden.'
                      : descartados > 1
                        ? `Las ${descartados} que descartaste vuelven a aparecer, y las ediciones que hiciste a mano se pierden.`
                        : 'Las ediciones que hayas hecho a mano se pierden.') +
                    // Lo único destruido que costó dinero: `persistir` de P2
                    // borra todos los `plan_slots` del plan —**incluidos los
                    // descartados**, que siguen ahí hasta que se regenera— por
                    // el `ON DELETE CASCADE` de la migración `0008`, y con
                    // ellos cualquier pieza que colgara de ellos (Crítico 2 de
                    // la revisión de la rama). Sin esta frase, la advertencia
                    // enumeraba todo lo perdible salvo lo más caro.
                    //
                    // Por eso cuenta con `piezas.size` y no con
                    // `resumenPiezas.listas`: ese segundo número sale de
                    // `slotsVigentesDelMes`, que filtra los slots
                    // descartados a propósito (es el mismo criterio que
                    // `encolarPiezas` usa para decidir a quién encolar), así
                    // que subcuenta las piezas de un slot que se descartó
                    // después de escribirse — medido: descartar un slot con
                    // pieza deja `resumenPiezas.listas` en 1 con 2 filas reales
                    // en `content_pieces` (Menor D de la revisión de la
                    // rama). `piezas` (de `piezasDelMes`, arriba) no filtra
                    // por descartado y por eso sí cuenta las dos.
                    (piezas.size > 0
                      ? piezas.size === 1
                        ? ' También se borra la pieza que ya escribiste, y volver a generarla paga el modelo otra vez.'
                        : ` También se borran las ${piezas.size} piezas que ya escribiste, y volver a generarlas paga el modelo otra vez.`
                      : '')
                  }
                />
              )}
              {grilla.contentPlanId && (
                <BotonAprobarGrilla marca={marca} mes={mes} contentPlanId={grilla.contentPlanId} />
              )}
            </div>
          )}
          {grilla.estado === 'aprobada' && (
            <div className="flex flex-col items-end gap-2">
              {/* `piezas.size`, no `resumenPiezas.listas`, por la misma razón
                  que la advertencia de regenerar de arriba: no filtra los
                  slots descartados, y esos también pierden su pieza cuando
                  se regenera (Menor D de la revisión de la rama). */}
              <BotonReabrirGrilla marca={marca} mes={mes} piezasEscritas={piezas.size} />
            </div>
          )}
          {/* Sección propia, con su nombre accesible, para que el avance de
              las piezas y el botón que las encola se puedan pedir por
              separado del resto de la cabecera. Fuera del bloque de
              `aprobada`: si alguien reabre la grilla mientras las corridas de
              piezas siguen en vuelo —cosa que hoy nada impide—, el aviso de
              avance tiene que seguir viéndose aunque el botón (que sí exige
              `aprobada`, ver `mostrarBotonPiezas`) haya desaparecido. */}
          {(textoAvancePiezas || mostrarBotonPiezas) && (
            <section
              aria-label="Piezas del mes"
              className="flex flex-col items-end gap-1 text-right"
            >
              {textoAvancePiezas && <p className="text-sm text-gray-600">{textoAvancePiezas}</p>}
              {mostrarBotonPiezas && <BotonGenerarPiezas marca={marca} mes={mes} />}
            </section>
          )}
        </div>
      </header>

      {corrida && <EstadoDeCorrida corrida={corrida} ruta={`/${marca}/grilla/${mes}`} />}

      {/* Bloqueantes y avisos son dos clases distintas de problema y se
          muestran distinto: un pilar que ya no existe en el perfil rompe la
          grilla, un desvío de cadencia solo la desafina. Antes los
          bloqueantes se filtraban antes de llegar aquí. */}
      {bloqueantes.length > 0 && (
        <div className="mb-4 rounded border-2 border-red-400 bg-red-50 p-3 text-sm text-red-900">
          <p className="mb-1 font-semibold">
            {bloqueantes.length === 1
              ? 'Esta grilla tiene un problema que hay que resolver'
              : `Esta grilla tiene ${bloqueantes.length} problemas que hay que resolver`}
          </p>
          <ul className="list-disc space-y-1 pl-5">
            {bloqueantes.map((p, i) => (
              <li key={i}>{p.detalle}</li>
            ))}
          </ul>
        </div>
      )}

      {avisos.length > 0 && (
        <ul className="mb-6 space-y-1 rounded border border-amber-300 bg-amber-50 p-3 text-sm text-amber-800">
          {avisos.map((aviso, i) => (
            <li key={i}>{aviso.detalle}</li>
          ))}
        </ul>
      )}

      {grilla.estado === null ? (
        <div className="rounded border border-dashed border-gray-300 p-8 text-center text-gray-600">
          <p className="mb-3">Este mes todavía no tiene grilla.</p>
          {/* El botón encola y devuelve; quien la genera es el worker. El
              avance aparece arriba, en `EstadoDeCorrida`. Mientras esa corrida
              siga viva no se ofrece de nuevo: la grilla no existe hasta que el
              worker la persista, así que sin esta guarda el botón invita a
              encolar una segunda y pagar el modelo dos veces. */}
          {!enVuelo && (
            <div className="flex justify-center">
              <BotonGenerar marca={marca} periodo={mes} que="grilla" etiqueta="Generar grilla" />
            </div>
          )}
        </div>
      ) : (
        <RejillaDelMes
          marca={marca}
          mes={mes}
          estado={grilla.estado}
          semanas={semanas}
          slots={grilla.slots}
          piezas={piezas}
        />
      )}
    </div>
  )
}
