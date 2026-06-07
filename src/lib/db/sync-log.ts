import { prisma } from './client'

const DAILY_WARN_THRESHOLD = 60_000
const DAILY_HARD_STOP = 75_000

// Sum of all api_calls_made in sync_log for today (UTC day).
export async function getDailyCallCount(): Promise<number> {
  const todayStart = new Date()
  todayStart.setUTCHours(0, 0, 0, 0)

  const rows = await prisma.syncLog.findMany({
    where: { startedAt: { gte: todayStart } },
    select: { apiCallsMade: true },
  })

  return rows.reduce((sum, r) => sum + (r.apiCallsMade ?? 0), 0)
}

// Throws if daily hard stop is reached. Logs warning if approaching limit.
export async function assertDailyLimitOk(): Promise<void> {
  const count = await getDailyCallCount()
  if (count >= DAILY_HARD_STOP) {
    throw new Error(`Daily API call hard stop reached: ${count} >= ${DAILY_HARD_STOP}. Manual override required.`)
  }
  if (count >= DAILY_WARN_THRESHOLD) {
    console.warn(`[WARN] Daily HubSpot API calls: ${count} — approaching limit. Auto syncs paused.`)
  }
}

type StartSyncResult = { id: number }

export async function startSyncLog(syncType: string): Promise<StartSyncResult> {
  const row = await prisma.syncLog.create({
    data: { syncType, apiCallsMade: 0, dealsSynced: 0 },
  })
  return { id: row.id }
}

export async function completeSyncLog(
  id: number,
  apiCallsMade: number,
  dealsSynced: number
): Promise<void> {
  await prisma.syncLog.update({
    where: { id },
    data: { apiCallsMade, dealsSynced, completedAt: new Date() },
  })
}

export async function failSyncLog(id: number, error: string): Promise<void> {
  await prisma.syncLog.update({
    where: { id },
    data: { error, completedAt: new Date() },
  })
}

export type SyncLogRow = {
  id: number
  syncType: string | null
  apiCallsMade: number | null
  dealsSynced: number | null
  startedAt: Date
  completedAt: Date | null
  error: string | null
}

export async function getRecentSyncs(limit = 10): Promise<SyncLogRow[]> {
  return prisma.syncLog.findMany({
    orderBy: { startedAt: 'desc' },
    take: limit,
    select: { id: true, syncType: true, apiCallsMade: true, dealsSynced: true, startedAt: true, completedAt: true, error: true },
  })
}

// Returns the most recent completed sync timestamp, or null if never synced.
export async function getLastSyncedAt(): Promise<Date | null> {
  const row = await prisma.syncLog.findFirst({
    where: { syncType: 'layer1', completedAt: { not: null }, error: null },
    orderBy: { completedAt: 'desc' },
    select: { completedAt: true },
  })
  return row?.completedAt ?? null
}
