import { sql } from 'drizzle-orm'
import { migrate } from 'drizzle-orm/node-postgres/migrator'
import { fileURLToPath } from 'node:url'
import { crearConexion, type BaseDeDatos, type Conexion } from '../cliente.js'
import { esquema } from '../esquema.js'

const CARPETA_MIGRACIONES = fileURLToPath(new URL('../../migraciones', import.meta.url))

/**
 * `crearConexion` ya no recibe una URL: resuelve su destino de
 * `process.env.DATABASE_URL` (ver `destinoDeConexion`). Las pruebas quieren
 * conectar a `DATABASE_URL_TEST`, no a esa — así que este ayudante le presta
 * la variable durante la llamada y la devuelve a su valor original apenas
 * termina, para no dejarla pisada para el resto del proceso ni para el resto
 * del archivo de prueba que la haya llamado.
 */
export async function crearConexionDePrueba(url: string): Promise<Conexion> {
  const original = process.env.DATABASE_URL
  process.env.DATABASE_URL = url
  try {
    return await crearConexion()
  } finally {
    if (original === undefined) delete process.env.DATABASE_URL
    else process.env.DATABASE_URL = original
  }
}

/**
 * Borra los disparadores y las funciones que dejó viva una corrida anterior.
 *
 * Varias pruebas instalan un disparador sobre una tabla real para simular una
 * caída de Postgres y lo quitan en su `finally`. Ese `finally` no corre si la
 * suite muere antes: un Ctrl-C, un timeout de CI, un proceso caído. El residuo
 * queda sobre `strategies` o `plan_slots` y revienta el primer insert de todas
 * las corridas siguientes, en todos los paquetes, con un error que parece una
 * caída genuina de la base.
 *
 * El criterio de "no pertenece al esquema" no necesita lista blanca: una base
 * recién migrada tiene CERO funciones propias y CERO disparadores que no sean
 * los internos con los que Postgres implementa las claves foráneas
 * (`tgisinternal`). Las migraciones no crean ninguno, así que todo lo que
 * aparezca es residuo. Si algún día una migración crea una función, hay que
 * volver aquí y excluirla a mano.
 */
async function barrerResiduos(db: BaseDeDatos): Promise<void> {
  await db.execute(sql`
    do $$
    declare r record;
    begin
      for r in
        select n.nspname as esquema, c.relname as tabla, t.tgname as disparador
          from pg_trigger t
          join pg_class c on c.oid = t.tgrelid
          join pg_namespace n on n.oid = c.relnamespace
         where not t.tgisinternal
           and n.nspname !~ '^pg_' and n.nspname <> 'information_schema'
      loop
        execute format(
          'drop trigger if exists %I on %I.%I', r.disparador, r.esquema, r.tabla
        );
      end loop;

      for r in
        select p.oid::regprocedure::text as firma,
               case p.prokind when 'p' then 'procedure'
                              when 'a' then 'aggregate'
                              else 'function' end as tipo
          from pg_proc p
          join pg_namespace n on n.oid = p.pronamespace
         where n.nspname !~ '^pg_' and n.nspname <> 'information_schema'
      loop
        execute format('drop %s if exists %s cascade', r.tipo, r.firma);
      end loop;
    end $$;
  `)
}

/**
 * Abre una conexión a la base de pruebas, barre los residuos de corridas
 * anteriores, aplica migraciones, vacía las tablas y ejecuta `fn`. Siempre
 * cierra la conexión.
 */
export async function conBaseDeDatosDePrueba(
  fn: (db: BaseDeDatos) => Promise<void>,
): Promise<void> {
  const url = process.env.DATABASE_URL_TEST
  if (!url) throw new Error('Falta DATABASE_URL_TEST')

  const { db, cerrar } = await crearConexionDePrueba(url)
  try {
    // Antes de migrar: alguna migración rellena columnas con UPDATE y un
    // disparador residual sobre esa tabla la haría fallar.
    await barrerResiduos(db)
    await migrate(db, { migrationsFolder: CARPETA_MIGRACIONES })
    await db.delete(esquema.organizations)
    // `users` no cuelga de `organization_id` (a propósito: ver el comentario
    // de la tabla en esquema.ts), así que el borrado de arriba no la alcanza
    // por cascada. Sin esta línea, una persona que una prueba deja insertada
    // sobrevive a la siguiente corrida y su correo único choca contra la
    // próxima prueba que intente crear la misma persona.
    await db.delete(esquema.users)
    await fn(db)
  } finally {
    await cerrar()
  }
}
