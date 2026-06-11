import type { CurrentState, CaseHealthStatus } from './types'
import type { SummaryJson } from '@/lib/ai/summary'

export function inferHealth(status: string | null): CaseHealthStatus {
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

// Minimal shape of the latest CaseAnalysis row that CurrentState needs.
// Kept structural so the case/ layer stays free of Prisma imports.
export type AnalysisStateInput = {
  health: CaseHealthStatus
  statusLabel: string | null
  blockers: unknown
  nextAction: string | null
  lastMeaningfulActivity: string | null
  createdAt: Date
  source: 'agent' | 'human'
} | null

export type SummaryStateInput = { summaryJson: unknown; generatedAt: Date } | null

// Builds the operational state of the case from the AI-interpretation layer.
// Priority: latest case_analysis row → ai_summaries (back-compat) → empty.
// Business facts are never read here — only interpretation.
export function buildCurrentState(
  analysis: AnalysisStateInput,
  summary: SummaryStateInput,
  openTaskCount: number
): CurrentState {
  if (analysis) {
    const blockers = Array.isArray(analysis.blockers) ? (analysis.blockers as string[]) : []
    return {
      status: analysis.statusLabel || null,
      health: analysis.health ?? 'unknown',
      blocker: blockers[0] ?? null,
      nextAction: analysis.nextAction || null,
      lastMeaningfulActivity: analysis.lastMeaningfulActivity || null,
      openTaskCount,
      generatedAt: analysis.createdAt,
      source: analysis.source === 'human' ? 'human' : 'ai',
    }
  }

  if (summary) {
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
