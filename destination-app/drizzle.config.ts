import { defineConfig } from 'drizzle-kit'

function getDatabaseUrl() {
  const host = process.env.POSTGRES_HOST ?? 'localhost'
  const port = process.env.POSTGRES_PORT ?? '5432'
  const database = process.env.POSTGRES_DB ?? 'spatial_db'
  const user = process.env.POSTGRES_USER ?? 'pi'
  const password = process.env.POSTGRES_PASSWORD ?? 'your_password_here'

  return (
    process.env.DATABASE_URL ??
    `postgres://${user}:${password}@${host}:${port}/${database}`
  )
}

export default defineConfig({
  out: './drizzle',
  schema: './src/server/db/schema.ts',
  dialect: 'postgresql',
  schemaFilter: ['app'],
  dbCredentials: {
    url: getDatabaseUrl(),
  },
})
