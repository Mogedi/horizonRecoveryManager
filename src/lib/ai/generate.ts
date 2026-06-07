import { callClaude } from './client'
import { AIError } from './errors'
import { buildSummaryPrompt } from './prompts'
import { parseSummaryResponse } from './summary'
import { getLatestSummary, upsertSummary } from '@/lib/db/summaries'
import { getActivitiesForDeal } from '@/lib/db/activities'
import { getContactsForDeal } from '@/lib/db/contacts'
import { prisma } from '@/lib/db/client'
import { loadStageMap } from '@/lib/db/settings'
import { AI_SUMMARY_LOOKBACK_DAYS } from '@/lib/utils/thresholds'
import type { SummaryJson } from './summary'

export async function runSummaryGeneration(hubspotId: string): Promise<{
  summary: SummaryJson
  generatedAt: Date
}> {
  const deal = await prisma.deal.findUnique({
    where: { hubspotId },
    select: {
      hubspotId: true,
      name: true,
      stage: true,
      amount: true,
      stageEnteredAt: true,
      lastActivityDate: true,
      contactCount: true,
      syncedAt: true,
    },
  })
  if (!deal) throw new AIError(`Deal not found: ${hubspotId}`)

  const [contacts, activities, stageMap] = await Promise.all([
    getContactsForDeal(hubspotId),
    getActivitiesForDeal(hubspotId),
    loadStageMap(),
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
  }

  const prompt = buildSummaryPrompt(
    normalizedDeal,
    contacts,
    activities,
    stageMap,
    AI_SUMMARY_LOOKBACK_DAYS
  )

  const rawText = await callClaude(prompt)
  const summary = parseSummaryResponse(rawText)

  await upsertSummary(hubspotId, summary)

  const stored = await getLatestSummary(hubspotId)
  return { summary, generatedAt: stored?.generatedAt ?? new Date() }
}
