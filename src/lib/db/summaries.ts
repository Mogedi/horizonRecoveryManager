import { prisma } from './client'
import type { SummaryJson } from '@/lib/ai/summary'

export async function getLatestSummary(hubspotId: string) {
  return prisma.aiSummary.findUnique({
    where: { dealHubspotId: hubspotId },
    select: { summaryJson: true, generatedAt: true },
  })
}

export async function upsertSummary(hubspotId: string, json: SummaryJson) {
  return prisma.aiSummary.upsert({
    where: { dealHubspotId: hubspotId },
    create: {
      dealHubspotId: hubspotId,
      summaryJson: JSON.parse(JSON.stringify(json)),
      generatedAt: new Date(),
    },
    update: {
      summaryJson: JSON.parse(JSON.stringify(json)),
      generatedAt: new Date(),
    },
  })
}

export async function getMoActionDealIds(): Promise<Set<string>> {
  // Filter on the JSON field in SQL (Postgres JSON-path) instead of loading every summaryJson
  // blob and filtering in JS — returns only the matching deal ids.
  const rows = await prisma.aiSummary.findMany({
    where: { summaryJson: { path: ['mo_action_required'], equals: true } },
    select: { dealHubspotId: true },
  })
  return new Set(rows.map(r => r.dealHubspotId))
}
