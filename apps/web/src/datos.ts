import { crearConexion, esquema, type BaseDeDatos } from '@gc/db'
import { resolverOrganizacion } from '@gc/operaciones'
import { asc, eq } from 'drizzle-orm'
import { cache } from 'react'

/**
 * Next.js reejecuta módulos entre peticiones en desarrollo; una conexión por
 * petición agotaría el pool en minutos. Una variable de módulo normal no
 * alcanza: cada hot reload invalida y reejecuta el módulo, perdiendo la
 * referencia al pool anterior sin cerrarlo — el pool viejo (`max: 5`) queda
 * abierto y cada recarga suma otras 5 conexiones hacia el límite de
 * Postgres. Guardar el pool en `globalThis` sobrevive a la reejecución del
 * módulo; es el workaround estándar para este patrón en Next dev.
 *
 * `crearConexion` es asíncrona: se cachea la **promesa**, no su resultado. Si
 * se cacheara el resultado, dos peticiones simultáneas verían
 * `cacheGlobal.__gcDb__` vacío antes de que la primera termine de resolver, y
 * cada una abriría su propio pool — justo lo que este caché existe para
 * evitar. Cachear la promesa hace que la segunda petición reciba la misma
 * promesa en vuelo y espere el mismo pool, en vez de abrir uno nuevo.
 *
 * En Cloud SQL este caché deja de ser solo una optimización de desarrollo:
 * medido contra la instancia real desde Vercel, un proceso nuevo tarda ~1,6 s
 * en construir el conector y hacer la primera consulta; uno ya tibio, ~123
 * ms. Perderlo multiplica por trece el costo de cada petición.
 *
 * Si la promesa cacheada rechaza —una caída transitoria de red construyendo
 * el conector, por ejemplo— se limpia el caché antes de relanzar. Sin esto,
 * un solo fallo de arranque envenenaría el proceso tibio para siempre: todas
 * las peticiones siguientes fallarían con el mismo error ya resuelto, en vez
 * de reintentar contra un proceso que perfectamente podría conectar bien la
 * próxima vez.
 */
const cacheGlobal = globalThis as unknown as { __gcDb__?: Promise<BaseDeDatos> | undefined }

export function conexion(): Promise<BaseDeDatos> {
  if (!cacheGlobal.__gcDb__) {
    cacheGlobal.__gcDb__ = crearConexion()
      .then(({ db }) => db)
      .catch((error: unknown) => {
        cacheGlobal.__gcDb__ = undefined
        throw error
      })
  }
  return cacheGlobal.__gcDb__
}

export interface MarcaListada {
  id: string
  slug: string
  name: string
}

export async function marcasDeLaOrganizacion(
  db: BaseDeDatos,
  organizationId: string,
): Promise<MarcaListada[]> {
  return db
    .select({
      id: esquema.brands.id,
      slug: esquema.brands.slug,
      name: esquema.brands.name,
    })
    .from(esquema.brands)
    .where(eq(esquema.brands.organizationId, organizationId))
    .orderBy(asc(esquema.brands.createdAt))
}

/**
 * `cache` de React deduplica la llamada dentro de una misma petición:
 * `layout.tsx` y `page.tsx` la piden por separado y antes eran dos consultas
 * idénticas. No es estado global —el ámbito es la petición— así que no
 * comparte nada entre usuarios ni entre peticiones.
 *
 * `crearSiFalta: false` porque esto corre en el camino de lectura: sin él, un
 * `GET /` sobre una base vacía insertaba una fila. Crear la organización es
 * del CLI.
 */
export const organizacionPorDefecto = cache(async (db: BaseDeDatos): Promise<string> => {
  return resolverOrganizacion(db, { crearSiFalta: false })
})
