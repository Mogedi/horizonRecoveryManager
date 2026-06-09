import type { CurrentState, CaseHealthStatus } from './types'
import type { SummaryJson } from '@/lib/ai/summary'

function inferHealth(status: string | null): CaseHealthStatus {
  if (!status) return 'unknown'
  const s = status.toLowerCase()

  // Check most specific patterns first
  if (s.includes('blocked') || s.includes('on hold') || s.includes('cannot')) return 'blocked'
  if (s.includes('on track')) return 'on_track'
  if (s.includes('signed') || s.includes('in progress')) return 'on_track'
  if (s.includes('filed') || s.includes('submitted') || s.includes('scheduled')) return 'active'
  if (s.includes('waiting') || s.includes('pending') || s.includes('awaiting')) return 'waiting'

  return 'unknown'
}

// Builds the operational state of the case from available sources.
// Today reads from AiSummary; designed to accept future sources without breaking callers.
export function buildCurrentState(
  summary: { summaryJson: unknown; generatedAt: Date } | null,
  openTaskCount: number
): CurrentState {
  if (!summary) {
    return {
      status: null,
      health: 'unknown',
      blocker: null,
      nextAction: null,
      lastMeaningfulActivity: null,
      openTaskCount,
      generatedAt: null,
      source: null,
    }
  }

  const json = summary.summaryJson as SummaryJson
  const blockers = Array.isArray(json.blockers) ? json.blockers : []

  return {
    status: json.current_status || null,
    health: inferHealth(json.current_status),
    blocker: blockers[0] ?? null,
    nextAction: json.suggested_next_step || null,
    lastMeaningfulActivity: json.last_meaningful_activity || null,
    openTaskCount,
    generatedAt: summary.generatedAt,
    source: 'ai',
  }
}
