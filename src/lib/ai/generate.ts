import { callClaude } from './client'
import { AIError } from './errors'
import { buildSummaryPrompt } from './prompts'
import { parseSummaryResponse } from './summary'
import { upsertSummary } from '@/lib/db/summaries'
import { insertAnalysis, AnalysisSource } from '@/lib/db/case-analysis'
import { inferHealth } from '@/lib/case/state'
import { getActivitiesForDeal } from '@/lib/db/activities'
import { getContactsForDeal } from '@/lib/db/contacts'
import { getDealById } from '@/lib/db/deals'
import { loadStageMap, loadThresholds } from '@/lib/db/settings'
import { log } from '@/lib/logger'
import type { SummaryJson } from './summary'

export async function runSummaryGeneration(hubspotId: string): Promise<{
  summary: SummaryJson
  generatedAt: Date
}> {
  const deal = await getDealById(hubspotId)
  if (!deal) throw new AIError(`Deal not found: ${hubspotId}`)

  const [contacts, activities, stageMap, thresholds] = await Promise.all([
    getContactsForDeal(hubspotId),
    getActivitiesForDeal(hubspotId),
    loadStageMap(),
    loadThresholds(),
  ])

  const normalizedDeal = {
    hubspotId: deal.hubspotId,
    name: deal.name,
    stage: deal.stage,
    amount: deal.amount?.toNumber() ?? null,
    stageEnteredAt: deal.stageEnteredAt,
    lastActivityDate: deal.lastActivityDate,
    contactCount: deal.contactCount,
    hasValidPhone: null as boolean | null,
    syncedAt: deal.syncedAt,
    uniqueCallDays: 0,
  }

  const prompt = buildSummaryPrompt(
    normalizedDeal,
    contacts,
    activities,
    stageMap,
    thresholds.aiSummaryLookbackDays
  )

  const rawText = await callClaude(prompt)
  const summary = parseSummaryResponse(rawText)

  const stored = await upsertSummary(hubspotId, summary)

  // Phase 1 (Hermes): mirror the summary into the append-only AI-interpretation layer, so the
  // manual button and Hermes share one case_analysis timeline. Best-effort — a mirror failure
  // must never fail the summary the user just requested.
  try {
    await insertAnalysis({
      dealHubspotId: hubspotId,
      analysisType: 'triage',
      source: AnalysisSource.agent,
      actor: 'manual-button',
      provider: 'anthropic',
      model: 'claude-sonnet-4-6',
      health: inferHealth(summary.current_status),
      statusLabel: summary.current_status || null,
      blockers: summary.blockers ?? [],
      recommendations: summary.suggested_next_step ? [summary.suggested_next_step] : [],
      nextAction: summary.suggested_next_step || null,
      lastMeaningfulActivity: summary.last_meaningful_activity || null,
      moActionRequired: summary.mo_action_required ?? false,
      generatedFrom: 'manual-summary',
      raw: summary,
    })
  } catch (err) {
    log.warn('case_analysis mirror failed (summary still saved)', {
      dealId: hubspotId,
      error: err instanceof Error ? err.message : String(err),
    })
  }

  return { summary, generatedAt: stored.generatedAt }
}
