import { sql } from 'drizzle-orm'
import { describe, expect, it } from 'vitest'
import { esquema } from '../esquema.js'
import { conBaseDeDatosDePrueba } from './entorno.js'

/**
 * Cuenta lo que una base recién migrada tiene en cero: ninguna función propia
 * y ningún disparador que no sea el interno con el que Postgres implementa las
 * claves foráneas (`tgisinternal`). Todo lo que aparezca aquí es residuo.
 */
const RESIDUOS = sql`
  select
    (select count(*) from pg_trigger t
       join pg_class c on c.oid = t.tgrelid
       join pg_namespace n on n.oid = c.relnamespace
      where not t.tgisinternal
        and n.nspname !~ '^pg_' and n.nspname <> 'information_schema')::int
      as disparadores,
    (select count(*) from pg_proc p
       join pg_namespace n on n.oid = p.pronamespace
      where n.nspname !~ '^pg_' and n.nspname <> 'information_schema')::int
      as funciones
`

interface Conteo {
  disparadores: number
  funciones: number
}

describe('conBaseDeDatosDePrueba', () => {
  it('barre disparadores y funciones que dejó viva una corrida interrumpida', async () => {
    await conBaseDeDatosDePrueba(async (db) => {
      // Sin `finally` a propósito: así queda la base compartida cuando alguien
      // corta la suite con Ctrl-C —o CI la mata por tiempo— entre el
      // `create trigger` de una prueba y la limpieza que nunca llega a correr.
      await db.execute(sql`
        create or replace function gc_residuo_de_prueba() returns trigger as $$
        begin raise exception 'residuo de una prueba anterior'; end $$ language plpgsql;
        create trigger t_gc_residuo_de_prueba before insert on organizations
          for each row execute function gc_residuo_de_prueba();
      `)
    })

    await conBaseDeDatosDePrueba(async (db) => {
      const [conteo] = (await db.execute(RESIDUOS)) as unknown as Conteo[]
      expect(conteo).toEqual({ disparadores: 0, funciones: 0 })

      // Lo que de verdad importa: el primer insert de la corrida siguiente no
      // muere con un error que parece una caída genuina de Postgres.
      await db.insert(esquema.organizations).values({ name: 'X', slug: 'x' })
    })
  })
})
