// Seeds app_settings with stageMap and ownerMap from M1 research files.
// Run: npm run db:seed
import { PrismaClient } from '@prisma/client'
import { PrismaPg } from '@prisma/adapter-pg'
import { readFileSync } from 'fs'
import { fileURLToPath } from 'url'
import { dirname, resolve } from 'path'

const __dirname = dirname(fileURLToPath(import.meta.url))
const ROOT = resolve(__dirname, '..')

const adapter = new PrismaPg({ connectionString: process.env.DATABASE_URL })
const prisma = new PrismaClient({ adapter })

async function main() {
  // stageMap: { [stageId]: stageName }
  const pipelineData = JSON.parse(readFileSync(`${ROOT}/docs/research/pipeline-stages.json`, 'utf8'))
  const stageMap = {}
  for (const stage of pipelineData.results[0].stages) {
    stageMap[stage.id] = stage.label.trim()
  }

  // ownerMap: { [ownerId]: ownerName }
  const ownersData = JSON.parse(readFileSync(`${ROOT}/docs/research/owners.json`, 'utf8'))
  const ownerMap = {}
  for (const owner of ownersData.results) {
    const name = [owner.firstName, owner.lastName].filter(Boolean).join(' ').trim()
    ownerMap[owner.id] = name || owner.email || owner.id
  }

  await prisma.appSetting.upsert({
    where: { key: 'stage_map' },
    update: { value: JSON.stringify(stageMap) },
    create: { key: 'stage_map', value: JSON.stringify(stageMap) },
  })

  await prisma.appSetting.upsert({
    where: { key: 'owner_map' },
    update: { value: JSON.stringify(ownerMap) },
    create: { key: 'owner_map', value: JSON.stringify(ownerMap) },
  })

  console.log(`Seeded stage_map: ${Object.keys(stageMap).length} stages`)
  console.log(`Seeded owner_map: ${Object.keys(ownerMap).length} owners`)
  console.log('stageMap:', stageMap)
  console.log('ownerMap:', ownerMap)
}

main()
  .catch(console.error)
  .finally(() => prisma.$disconnect())
