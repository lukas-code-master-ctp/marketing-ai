import 'dotenv/config'
import { defineConfig } from 'drizzle-kit'

export default defineConfig({
  schema: './src/esquema.ts',
  out: './migraciones',
  dialect: 'postgresql',
  dbCredentials: { url: process.env.DATABASE_URL! },
})
