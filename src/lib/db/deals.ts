import { prisma } from './client'
import type { NormalizedDeal } from '@/lib/rules/types'

// Single source for all deal data consumed by the rules pipeline.
// Converts Prisma Decimal → number so rules never see Decimal objects.
// Preloads active snoozes as a Set for O(1) lookup — one query, not 150.
export async function getDealsForQueue(): Promise<{
  deals: NormalizedDeal[]
  snoozedDealIds: Set<string>
}> {
  const today = new Date()

  const [rawDeals, activeSnoozes] = await Promise.all([
    prisma.deal.findMany({
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
    }),
    prisma.dealSnooze.findMany({
      where: {
        snoozeUntil: { gte: today },
        wokeAt: null,
      },
      select: { dealHubspotId: true },
    }),
  ])

  const deals: NormalizedDeal[] = rawDeals.map(d => ({
    hubspotId: d.hubspotId,
    name: d.name,
    stage: d.stage,
    amount: d.amount !== null ? Number(d.amount) : null,
    stageEnteredAt: d.stageEnteredAt,
    lastActivityDate: d.lastActivityDate,
    contactCount: d.contactCount,
    syncedAt: d.syncedAt,
  }))

  const snoozedDealIds = new Set(activeSnoozes.map(s => s.dealHubspotId))

  return { deals, snoozedDealIds }
}
