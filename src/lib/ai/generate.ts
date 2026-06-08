import { callClaude } from './client'
import { AIError } from './errors'
import { buildSummaryPrompt } from './prompts'
import { parseSummaryResponse } from './summary'
import { upsertSummary } from '@/lib/db/summaries'
import { getActivitiesForDeal } from '@/lib/db/activities'
import { getContactsForDeal } from '@/lib/db/contacts'
import { getDealById } from '@/lib/db/deals'
import { loadStageMap, loadThresholds } from '@/lib/db/settings'
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
  return { summary, generatedAt: stored.generatedAt }
}
