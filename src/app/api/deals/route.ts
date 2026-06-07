import { NextResponse } from 'next/server'
import { getDealsForQueue } from '@/lib/db/deals'
import { evaluateAll } from '@/lib/rules'
import { loadStageMap } from '@/lib/db/settings'
import { getLastSyncedAt } from '@/lib/db/sync-log'
import {
  STAGE_STALE_THRESHOLDS_DAYS,
  TERMINAL_STAGE_IDS,
  AGREEMENT_SENT_NO_FOLLOWUP_DAYS,
  SIGNED_IN_PROGRESS_NO_ACTIVITY_DAYS,
} from '@/lib/utils/thresholds'
import type { DealWithFlags } from '@/lib/rules'

export async function GET() {
  const [{ deals, snoozedDealIds }, stageMap, lastSyncedAt] = await Promise.all([
    getDealsForQueue(),
    loadStageMap(),
    getLastSyncedAt(),
  ])

  const ctx = {
    today: new Date(),
    timezone: 'America/New_York' as const,
    stageMap,
    staleThresholds: STAGE_STALE_THRESHOLDS_DAYS,
    agreementNoFollowupDays: AGREEMENT_SENT_NO_FOLLOWUP_DAYS,
    signedNoActivityDays: SIGNED_IN_PROGRESS_NO_ACTIVITY_DAYS,
    terminalStageIds: TERMINAL_STAGE_IDS,
    snoozedDealIds,
  }

  const results = evaluateAll(deals, ctx)

  // Group by primary flag type. A deal with multiple flags appears under its first (highest-priority) flag.
  // Healthy = no flags. Snoozed = in snoozed bucket.
  const groups: Record<string, DealWithFlags[]> = {}
  for (const result of results) {
    const key = result.flags.length > 0 ? result.flags[0].type : 'healthy'
    if (!groups[key]) groups[key] = []
    groups[key].push(result)
  }

  return NextResponse.json({
    groups,
    stageMap,
    lastSyncedAt: lastSyncedAt?.toISOString() ?? null,
    totalDeals: deals.length,
  })
}
