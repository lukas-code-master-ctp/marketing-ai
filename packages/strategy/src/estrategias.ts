import { esquema, ESTADOS_STRATEGY, type BaseDeDatos } from '@gc/db'
import { and, eq, ne } from 'drizzle-orm'
import { Estrategia, type TipoEstrategia } from './esquemas.js'
import { trimestreDe } from './periodos.js'

type Estado = (typeof ESTADOS_STRATEGY)[number]

/**
 * Qué hacer con las estrategias archivadas. No tiene valor por defecto a
 * propósito: es la diferencia que separa a los consumidores de esta función y
 * dejarla implícita fue justamente el defecto que la unificación cierra.
 *
 * `excluir` es para quien calcula —P2 al generar la grilla, `validarGrilla` al
 * releerla— porque ahí hay que medir contra la estrategia que rige hoy.
 * `incluir` es para quien muestra, donde ocultar la fila es menos útil que
 * mostrarla con su estado.
 */
export type PoliticaDeArchivadas = 'excluir' | 'incluir'

/**
 * Se devuelve un resultado en vez de lanzar porque quien llama necesita
 * distinguir "no hay" de "hay pero no valida", y con dos errores
 * indistinguibles no podía: la grilla convierte el segundo caso en un
 * problema bloqueante con su remedio, y P2 los convierte a ambos en
 * `permanente` con mensajes distintos.
 *
 * `estado` viaja también en `invalida` porque la vista de solo lectura lo
 * muestra tal cual, y esa es su razón para incluir archivadas.
 */
export type LecturaDeEstrategia =
  | { tipo: 'ok'; periodo: string; id: string; estado: Estado; estrategia: TipoEstrategia }
  | { tipo: 'ausente'; periodo: string }
  | { tipo: 'invalida'; periodo: string; id: string; estado: Estado }

/**
 * La estrategia del trimestre al que pertenece `mes`.
 *
 * Reemplaza a tres funciones que leían lo mismo con cuatro diferencias entre
 * ellas —archivadas, forma del error, identificación de la marca y si
 * validaban— que ningún nombre delataba. La tercera, la de `perfiles.ts`, ni
 * siquiera validaba: devolvía la columna cruda y dejaba que la página la
 * parseara, así que una estrategia corrupta se comportaba distinto según por
 * dónde se entrara.
 */
export async function leerEstrategiaDelTrimestre(
  db: BaseDeDatos,
  brandId: string,
  mes: string,
  opciones: { archivadas: PoliticaDeArchivadas },
): Promise<LecturaDeEstrategia> {
  const periodo = trimestreDe(mes)

  // `(brand_id, period)` es único, así que hay a lo más una fila: no hace
  // falta ordenar, y "la más reciente" deja de ser un criterio.
  const filtro =
    opciones.archivadas === 'excluir'
      ? and(
          eq(esquema.strategies.brandId, brandId),
          eq(esquema.strategies.period, periodo),
          ne(esquema.strategies.status, 'archivada'),
        )
      : and(eq(esquema.strategies.brandId, brandId), eq(esquema.strategies.period, periodo))

  const [fila] = await db.select().from(esquema.strategies).where(filtro)

  if (!fila) return { tipo: 'ausente', periodo }

  const r = Estrategia.safeParse(fila.data)
  if (!r.success) return { tipo: 'invalida', periodo, id: fila.id, estado: fila.status }

  return { tipo: 'ok', periodo, id: fila.id, estado: fila.status, estrategia: r.data }
}
