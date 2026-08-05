import { config } from 'dotenv'
import { defineConfig } from 'drizzle-kit'
import { fileURLToPath } from 'node:url'

config({ path: fileURLToPath(new URL('../../.env', import.meta.url)) })

// drizzle-kit corre las migraciones fuera del ciclo de vida de la app, así
// que puede —y en Neon, debe— ir contra la cadena **directa**: PgBouncer en
// modo transacción (la cadena agrupada que usa la app) no maneja bien las
// sentencias que las migraciones necesitan. `DATABASE_URL_DIRECTA` es
// opcional a propósito: en Docker local hay una sola base y una sola cadena,
// así que sin ella cae a `DATABASE_URL` y sigue funcionando igual que antes.
//
// Con `||` y no `??`: un clon nuevo que siga `cp .env.example .env` hereda
// `DATABASE_URL_DIRECTA=` sin valor, y dotenv la parsea como cadena vacía, no
// como ausente. `??` solo cae al respaldo con `null`/`undefined`, así que con
// la variable declarada vacía drizzle-kit recibía `''` y salía con `Please
// provide required params for Postgres driver`. Lo mismo protege contra una
// variable declarada vacía en Vercel o en un shell.
export default defineConfig({
  schema: './src/esquema.ts',
  out: './migraciones',
  dialect: 'postgresql',
  dbCredentials: { url: process.env.DATABASE_URL_DIRECTA || process.env.DATABASE_URL! },
})
