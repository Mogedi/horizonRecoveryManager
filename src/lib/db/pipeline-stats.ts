import { prisma } from './client'
import { PIPELINE_GROUP, TERMINAL_STAGE_IDS } from './settings'
import type { DealWithFlags } from '@/lib/rules'

// ─── Types ────────────────────────────────────────────────────────────────────

export type StageStats = {
  stageId: string
  stageName: string
  group: 'setup' | 'outreach' | 'case_mgmt' | 'terminal'
  dealCount: number
  totalValue: number
  urgentCount: number
  warnCount: number
  healthyCount: number
  snoozedCount: number
}

export type WeeklyCallStats = {
  totalCalls: number
  liveCount: number
  voicemailCount: number
  disconnectedCount: number
  noAnswerCount: number
  dealsCalledCount: number
}

export type PipelineStats = {
  byStage: StageStats[]
  kpi: {
    totalPipelineValue: number
    totalActiveDeals: number
    closingValue: number
    closingCount: number
    needsAttentionCount: number
    urgentCount: number
  }
  weeklyCalls: WeeklyCallStats
}

// ─── Constants ────────────────────────────────────────────────────────────────

const CLOSING_STAGE_IDS = new Set(['3477730040', '3478695644'])

// Active stages in funnel order — terminal stages excluded
const STAGE_DISPLAY_ORDER = [
  '3477730034', // New Case
  '3477730035', // Ready for Outreach
  '3477730036', // Attempted Contact
  '3477730037', // Contact Made
  '3477730038', // Follow-Up Needed
  '3477730039', // Engaged / Interested
  '3551234806', // Letter Outreach - Final Attempt
  '3477730040', // Agreement Sent
  '3478695644', // Signed / In Progress
]

// ─── computePipelineStats (pure) ──────────────────────────────────────────────

export function computePipelineStats(
  results: DealWithFlags[],
  stageMap: Record<string, string>,
  snoozedDealIds: Set<string>,
  weeklyCalls: WeeklyCallStats,
): PipelineStats {
  // Accumulator maps for per-stage buckets
  const buckets = new Map<string, {
    dealCount: number
    totalValue: number
    urgentCount: number
    warnCount: number
    healthyCount: number
    snoozedCount: number
  }>()

  let totalPipelineValue = 0
  let totalActiveDeals = 0
  let closingValue = 0
  let closingCount = 0
  let needsAttentionCount = 0
  let urgentCount = 0

  for (const { deal, flags } of results) {
    const stageId = deal.stage ?? 'unknown'
    const isTerminal = TERMINAL_STAGE_IDS.has(stageId)
    const amount = deal.amount ?? 0
    const isSnoozed = snoozedDealIds.has(deal.hubspotId)
    const primarySeverity = flags[0]?.severity ?? null

    // KPI totals: only non-terminal deals
    if (!isTerminal) {
      totalPipelineValue += amount
      totalActiveDeals++

      if (CLOSING_STAGE_IDS.has(stageId)) {
        closingValue += amount
        closingCount++
      }

      if (!isSnoozed) {
        if (primarySeverity === 'urgent') {
          needsAttentionCount++
          urgentCount++
        } else if (primarySeverity === 'warning') {
          needsAttentionCount++
        }
      }
    }

    // Per-stage bar: only stages in STAGE_DISPLAY_ORDER
    if (!STAGE_DISPLAY_ORDER.includes(stageId)) continue

    if (!buckets.has(stageId)) {
      buckets.set(stageId, { dealCount: 0, totalValue: 0, urgentCount: 0, warnCount: 0, healthyCount: 0, snoozedCount: 0 })
    }
    const b = buckets.get(stageId)!
    b.dealCount++
    b.totalValue += deal.amount ?? 0

    if (isSnoozed) {
      b.snoozedCount++
    } else if (primarySeverity === 'urgent') {
      b.urgentCount++
    } else if (primarySeverity === 'warning') {
      b.warnCount++
    } else {
      b.healthyCount++
    }
  }

  const byStage: StageStats[] = STAGE_DISPLAY_ORDER
    .filter(id => buckets.has(id))
    .map(id => ({
      stageId: id,
      stageName: stageMap[id] ?? id,
      group: PIPELINE_GROUP[id] ?? 'outreach',
      ...buckets.get(id)!,
    }))

  return {
    byStage,
    kpi: { totalPipelineValue, totalActiveDeals, closingValue, closingCount, needsAttentionCount, urgentCount },
    weeklyCalls,
  }
}

// ─── getWeeklyCallStats (DB) ──────────────────────────────────────────────────

type CallStatsRow = {
  total_calls: number
  live_count: number
  voicemail_count: number
  disconnected_count: number
  no_answer_count: number
  deals_called_count: number
}

export async function getWeeklyCallStats(daysBack = 7): Promise<WeeklyCallStats> {
  const rows = await prisma.$queryRaw<CallStatsRow[]>`
    SELECT
      COUNT(ae.id)::int                                                      AS total_calls,
      COUNT(CASE WHEN ct.classification = 'live' THEN 1 END)::int           AS live_count,
      COUNT(CASE WHEN ct.classification = 'voicemail' THEN 1 END)::int      AS voicemail_count,
      COUNT(CASE WHEN ct.classification = 'disconnected' THEN 1 END)::int   AS disconnected_count,
      COUNT(CASE WHEN ae.outcome = 'no_answer' THEN 1 END)::int             AS no_answer_count,
      COUNT(DISTINCT ae.deal_hubspot_id)::int                                AS deals_called_count
    FROM activity_events ae
    LEFT JOIN call_transcripts ct ON ct.activity_event_id = ae.id
    WHERE ae.source = 'JUSTCALL'
      AND ae.direction = 'outbound'
      AND ae.happened_at >= NOW() - (${daysBack} || ' days')::INTERVAL
  `

  const row = rows[0] ?? {
    total_calls: 0, live_count: 0, voicemail_count: 0,
    disconnected_count: 0, no_answer_count: 0, deals_called_count: 0,
  }

  return {
    totalCalls: Number(row.total_calls),
    liveCount: Number(row.live_count),
    voicemailCount: Number(row.voicemail_count),
    disconnectedCount: Number(row.disconnected_count),
    noAnswerCount: Number(row.no_answer_count),
    dealsCalledCount: Number(row.deals_called_count),
  }
}
