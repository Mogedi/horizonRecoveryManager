// Operational kill switch for Hermes agent writes.
//   npx dotenv -e .env.local -- node scripts/agent-writes.mjs <on|off|status>
// Upserts app_settings.agent_writes_enabled. Default-on when the key is absent.
import { PrismaClient } from '@prisma/client'
import { PrismaPg } from '@prisma/adapter-pg'

const KEY = 'agent_writes_enabled'
const mode = process.argv[2]
if (!['on', 'off', 'status'].includes(mode)) {
  console.error('usage: agent-writes <on|off|status>')
  process.exit(1)
}

const adapter = new PrismaPg({ connectionString: process.env.DATABASE_URL })
const prisma = new PrismaClient({ adapter })

try {
  if (mode === 'status') {
    const row = await prisma.appSetting.findUnique({ where: { key: KEY } })
    const enabled = !row || row.value !== 'false'
    console.log(`agent writes: ${enabled ? 'ENABLED' : 'DISABLED (423)'}${row ? '' : ' (default — key unset)'}`)
  } else {
    const value = mode === 'on' ? 'true' : 'false'
    await prisma.appSetting.upsert({
      where: { key: KEY },
      create: { key: KEY, value },
      update: { value },
    })
    console.log(`agent writes ${value === 'true' ? 'ENABLED' : 'DISABLED'} (agent_writes_enabled=${value})`)
  }
} finally {
  await prisma.$disconnect()
}
