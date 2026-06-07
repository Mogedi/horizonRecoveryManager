import { prisma } from './client'
import type { NormalizedDeal } from '@/lib/rules/types'

// Single source for all deal data consumed by the rules pipeline.
// Converts Prisma Decimal → number so rules never see Decimal objects.
// Preloads active snoozes as a Set for O(1) lookup — one query, not 150.
// Checks deal_contacts phone numbers for Layer 2 phone-check upgrade.
export async function getDealsForQueue(): Promise<{
  deals: NormalizedDeal[]
  snoozedDealIds: Set<string>
}> {
  const today = new Date()

  const [rawDeals, activeSnoozes, contactPhoneRows] = await Promise.all([
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
      where: { snoozeUntil: { gte: today }, wokeAt: null },
      select: { dealHubspotId: true },
    }),
    // One query for all Layer 2 phone data. Empty when no Layer 2 synced yet (cheap).
    prisma.dealContact.findMany({
      select: { dealHubspotId: true, phoneNumbers: true },
    }),
  ])

  // Build phone map: dealHubspotId → hasValidPhone (true if any contact has phones)
  // If a deal has no rows in deal_contacts, it won't be in this map → hasValidPhone = null
  const phoneMap = new Map<string, boolean>()
  for (const c of contactPhoneRows) {
    const phones = Array.isArray(c.phoneNumbers) ? c.phoneNumbers : []
    if (!phoneMap.has(c.dealHubspotId)) phoneMap.set(c.dealHubspotId, false)
    if (phones.length > 0) phoneMap.set(c.dealHubspotId, true)
  }

  const deals: NormalizedDeal[] = rawDeals.map(d => ({
    hubspotId: d.hubspotId,
    name: d.name,
    stage: d.stage,
    amount: d.amount !== null ? Number(d.amount) : null,
    stageEnteredAt: d.stageEnteredAt,
    lastActivityDate: d.lastActivityDate,
    contactCount: d.contactCount,
    // null = no Layer 2 data for this deal; true/false = phone check result
    hasValidPhone: phoneMap.has(d.hubspotId) ? (phoneMap.get(d.hubspotId) ?? false) : null,
    syncedAt: d.syncedAt,
  }))

  const snoozedDealIds = new Set(activeSnoozes.map(s => s.dealHubspotId))

  return { deals, snoozedDealIds }
}
