import { prisma } from './client'

// Load once per sync invocation and pass to mapper — do not call repeatedly.
export async function loadStageMap(): Promise<Record<string, string>> {
  const row = await prisma.appSetting.findUnique({ where: { key: 'stage_map' } })
  if (!row) throw new Error('stage_map not found in app_settings — run db:seed')
  return JSON.parse(row.value) as Record<string, string>
}

export async function loadOwnerMap(): Promise<Record<string, string>> {
  const row = await prisma.appSetting.findUnique({ where: { key: 'owner_map' } })
  if (!row) throw new Error('owner_map not found in app_settings — run db:seed')
  return JSON.parse(row.value) as Record<string, string>
}
