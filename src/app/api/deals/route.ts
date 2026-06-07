import { NextResponse } from 'next/server'
import { getDealsForQueue } from '@/lib/db/deals'
import { evaluateAll, buildRuleCtx } from '@/lib/rules'
import { loadStageMap } from '@/lib/db/settings'
import { getLastSyncedAt } from '@/lib/db/sync-log'
import { getMoActionDealIds } from '@/lib/db/summaries'
import type { DealWithFlags } from '@/lib/rules'

export async function GET() {
  const [{ deals, snoozedDealIds }, stageMap, lastSyncedAt, moActionIds] = await Promise.all([
    getDealsForQueue(),
    loadStageMap(),
    getLastSyncedAt(),
    getMoActionDealIds(),
  ])

  const ctx = await buildRuleCtx(stageMap, snoozedDealIds)
  const results = evaluateAll(deals, ctx)

  // Group by primary flag type. A deal with multiple flags appears under its first (highest-priority) flag.
  // Snooze always wins — it is an explicit Mo decision and overrides AI inference.
  // mo_action_required is injected from ai_summaries for non-snoozed deals only.
  // Healthy = no flags.
  const groups: Record<string, DealWithFlags[]> = {}
  for (const result of results) {
    const primaryFlag = result.flags[0]?.type ?? null
    let key: string
    if (primaryFlag === 'snoozed') {
      key = 'snoozed'
    } else if (moActionIds.has(result.deal.hubspotId)) {
      key = 'mo_action_required'
    } else {
      key = primaryFlag ?? 'healthy'
    }
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
