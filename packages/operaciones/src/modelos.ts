import { esquema, type BaseDeDatos, type Nivel } from '@gc/db'
import { permanente } from '@gc/shared'
import { and, asc, eq } from 'drizzle-orm'
import { alias } from 'drizzle-orm/pg-core'

/**
 * `organization_models` referencia `model_catalog` dos veces —principal y
 * respaldo—, así que leer las dos en la misma consulta exige un alias para
 * el segundo `JOIN`: sin él, Postgres no sabría a cuál de las dos columnas
 * (`principal_id` o `respaldo_id`) atarlo.
 */
const catalogoDeRespaldo = alias(esquema.modelCatalog, 'model_catalog_respaldo')

export interface ModeloDelCatalogo {
  id: string
  nivel: Nivel
  modelId: string
  etiqueta: string
  descripcion: string
  precioEntradaUsd: number
  precioSalidaUsd: number
}

export interface EleccionDeNivel {
  nivel: Nivel
  principal: ModeloDelCatalogo
  respaldo: ModeloDelCatalogo | null
}

/**
 * `numeric` llega de Drizzle como `string` —para no perder precisión—, así
 * que hay que convertir a mano al leer. Mismo criterio que
 * `verificarPresupuesto` (`packages/ai/src/costos.ts`) usa para
 * `brands.monthlyBudgetUsd`: un `Number()` liso, porque estos precios son
 * para mostrar en pantalla y elegir, no para sumarlos con precisión de
 * centavos (lo que sí se cobró de verdad lo registra `ai_calls`).
 */
function convertirModelo(fila: typeof esquema.modelCatalog.$inferSelect): ModeloDelCatalogo {
  return {
    id: fila.id,
    nivel: fila.level,
    modelId: fila.modelId,
    etiqueta: fila.label,
    descripcion: fila.description,
    precioEntradaUsd: Number(fila.priceInputUsd),
    precioSalidaUsd: Number(fila.priceOutputUsd),
  }
}

/**
 * El catálogo entero, agrupado por nivel, ordenado por precio de salida y,
 * a igual precio, por `model_id`. El desempate importa de verdad: la siembra
 * de la migración 0009 deja empatados `upstage/solar-pro4` y
 * `poolside/laguna-xs-2.1` en 0.1200 para `razonamiento`, así que sin un
 * segundo criterio el orden entre esos dos —y por tanto cuál aparece primero
 * en el desplegable— podía cambiar de una carga a otra, porque Postgres no
 * garantiza el orden entre filas que empatan en la columna del `ORDER BY`.
 */
export async function catalogoDeModelos(db: BaseDeDatos): Promise<Map<Nivel, ModeloDelCatalogo[]>> {
  const filas = await db
    .select()
    .from(esquema.modelCatalog)
    .orderBy(asc(esquema.modelCatalog.priceOutputUsd), asc(esquema.modelCatalog.modelId))

  const mapa = new Map<Nivel, ModeloDelCatalogo[]>()
  for (const fila of filas) {
    const modelo = convertirModelo(fila)
    const lista = mapa.get(modelo.nivel)
    if (lista) lista.push(modelo)
    else mapa.set(modelo.nivel, [modelo])
  }
  return mapa
}

/** Lo que esta organización eligió, por nivel. Los niveles sin elegir no aparecen. */
export async function eleccionesDeModelo(
  db: BaseDeDatos, organizationId: string,
): Promise<EleccionDeNivel[]> {
  const filas = await db
    .select({
      nivel: esquema.organizationModels.level,
      principal: esquema.modelCatalog,
      respaldo: catalogoDeRespaldo,
    })
    .from(esquema.organizationModels)
    .innerJoin(esquema.modelCatalog, eq(esquema.organizationModels.principalId, esquema.modelCatalog.id))
    .leftJoin(catalogoDeRespaldo, eq(esquema.organizationModels.respaldoId, catalogoDeRespaldo.id))
    .where(eq(esquema.organizationModels.organizationId, organizationId))

  return filas.map((fila) => ({
    nivel: fila.nivel,
    principal: convertirModelo(fila.principal),
    respaldo: fila.respaldo ? convertirModelo(fila.respaldo) : null,
  }))
}

/**
 * Los identificadores que hay que mandarle al modelo, en el orden en que se
 * intentan. Lanza `permanente` si la organización no eligió ese nivel.
 *
 * Sin respaldo elegido devuelve el principal en los dos: es el mismo criterio
 * que aplicaba la resolución por variable de entorno que este catálogo
 * reemplazó, con la variable de respaldo vacía, para que este cambio no
 * altere comportamiento.
 */
export async function modelosDelNivel(
  db: BaseDeDatos, organizationId: string, nivel: Nivel,
): Promise<{ principal: string; respaldo: string }> {
  const [fila] = await db
    .select({
      principal: esquema.modelCatalog.modelId,
      respaldo: catalogoDeRespaldo.modelId,
    })
    .from(esquema.organizationModels)
    .innerJoin(esquema.modelCatalog, eq(esquema.organizationModels.principalId, esquema.modelCatalog.id))
    .leftJoin(catalogoDeRespaldo, eq(esquema.organizationModels.respaldoId, catalogoDeRespaldo.id))
    .where(and(
      eq(esquema.organizationModels.organizationId, organizationId),
      eq(esquema.organizationModels.level, nivel),
    ))

  if (!fila) {
    throw permanente(
      `La organización no eligió un modelo para el nivel "${nivel}". Elígelo en /configuracion.`,
    )
  }

  return { principal: fila.principal, respaldo: fila.respaldo ?? fila.principal }
}

export async function guardarEleccionDeModelo(
  db: BaseDeDatos, organizationId: string,
  args: { nivel: Nivel; principalId: string; respaldoId: string | null },
  usuarioId?: string,
): Promise<void> {
  const idsAComprobar = args.respaldoId
    ? [args.principalId, args.respaldoId]
    : [args.principalId]

  const candidatos = await db
    .select({ id: esquema.modelCatalog.id })
    .from(esquema.modelCatalog)
    .where(eq(esquema.modelCatalog.level, args.nivel))

  const idsDelNivel = new Set(candidatos.map((c) => c.id))
  for (const id of idsAComprobar) {
    if (!idsDelNivel.has(id)) {
      throw permanente(
        `El modelo elegido no pertenece al nivel "${args.nivel}".`,
      )
    }
  }

  await db
    .insert(esquema.organizationModels)
    .values({
      organizationId,
      level: args.nivel,
      principalId: args.principalId,
      respaldoId: args.respaldoId,
      updatedAt: new Date(),
      ...(usuarioId !== undefined ? { updatedBy: usuarioId } : {}),
    })
    .onConflictDoUpdate({
      target: [esquema.organizationModels.organizationId, esquema.organizationModels.level],
      set: {
        principalId: args.principalId,
        respaldoId: args.respaldoId,
        // Sin `$onUpdate` en la columna, un `UPDATE` que no la ponga a mano
        // deja la fecha congelada en la de la primera elección (ver el
        // comentario de la columna en `esquema.ts`).
        updatedAt: new Date(),
        ...(usuarioId !== undefined ? { updatedBy: usuarioId } : {}),
      },
    })
}
