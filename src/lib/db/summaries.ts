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
  const rows = await prisma.aiSummary.findMany({
    select: { dealHubspotId: true, summaryJson: true },
  })
  const ids = new Set<string>()
  for (const row of rows) {
    const json = row.summaryJson as { mo_action_required?: boolean }
    if (json?.mo_action_required === true) {
      ids.add(row.dealHubspotId)
    }
  }
  return ids
}
