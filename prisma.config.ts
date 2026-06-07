import { defineConfig } from 'prisma/config'

// DIRECT_URL is used by Prisma CLI (migrate, generate).
// Load with: npm run db:migrate (uses dotenv-cli to read .env.local)
export default defineConfig({
  schema: 'prisma/schema.prisma',
  datasource: {
    url: process.env.DIRECT_URL ?? '',
  },
})
