import { NextResponse } from 'next/server'
import { getDealsForQueue } from '@/lib/db/deals'
import { evaluateAll, buildRuleCtx } from '@/lib/rules'
import { loadStageMap, PIPELINE_GROUP, TERMINAL_STAGE_IDS } from '@/lib/db/settings'
import { getLastSyncStatus } from '@/lib/db/sync-log'
import { getMoActionDealIds } from '@/lib/db/summaries'
import { getClassifiedCallCountsByDeal } from '@/lib/db/call-transcripts'
import { getWeeklyCallStats, computePipelineStats } from '@/lib/db/pipeline-stats'
import type { DealWithFlags } from '@/lib/rules'

// Action-based buckets — maps each deal to one of four work queues.
// Priority order: snoozed → follow_up → move_close → call_today → ready_work
function assignBucket(
  result: DealWithFlags,
  moActionIds: Set<string>,
  snoozedDealIds: Set<string>,
): string {
  const { deal, flags } = result
  const flagTypes = new Set(flags.map(f => f.type))
  const stageId = deal.stage ?? ''
  const group = PIPELINE_GROUP[stageId] ?? null

  if (TERMINAL_STAGE_IDS.has(stageId)) return '__hidden__'
  if (snoozedDealIds.has(deal.hubspotId)) return 'snoozed'

  // Follow Up: agreement or active case needs a response from Mo
  if (flagTypes.has('agreement_no_followup') || flagTypes.has('signed_no_activity')) return 'follow_up'
  if (moActionIds.has(deal.hubspotId)) return 'follow_up'

  // Move or Close: can't make progress without action on blocking issue
  if (flagTypes.has('no_contacts')) return 'move_close'
  if (flagTypes.has('calls_exhausted')) return 'move_close'
  // Setup stage + stale = deal never entered outreach, stuck in limbo
  if (group === 'setup' && flagTypes.has('stage_stale')) return 'move_close'

  // Call Today: in the calling cycle (stale = overdue, or actively working the lead)
  if (group === 'outreach') return 'call_today'

  // Ready to Work: new case, no blocking issues — enter the calling cycle
  if (group === 'setup') return 'ready_work'

  // Case mgmt (Signed/In Progress) with no flags — watching
  return 'follow_up'
}

export async function GET() {
  const [{ deals, snoozedDealIds }, stageMap, syncStatus, moActionIds, classifiedMap, weeklyCalls] = await Promise.all([
    getDealsForQueue(),
    loadStageMap(),
    getLastSyncStatus(),
    getMoActionDealIds(),
    getClassifiedCallCountsByDeal(),
    getWeeklyCallStats(),
  ])

  const ctx = await buildRuleCtx(stageMap, snoozedDealIds)
  const results = evaluateAll(deals, ctx)

  const groups: Record<string, DealWithFlags[]> = {}
  for (const result of results) {
    const key = assignBucket(result, moActionIds, snoozedDealIds)
    if (key === '__hidden__') continue
    if (!groups[key]) groups[key] = []
    groups[key].push(result)
  }

  const pipelineStats = computePipelineStats(results, stageMap, snoozedDealIds, weeklyCalls)

  return NextResponse.json({
    groups,
    stageMap,
    lastSyncedAt: syncStatus.lastSyncedAt?.toISOString() ?? null,
    lastSyncError: syncStatus.lastSyncError,
    totalDeals: deals.length,
    classifiedCallCounts: Object.fromEntries(classifiedMap),
    pipelineStats,
  })
}
