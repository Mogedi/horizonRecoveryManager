import { prisma } from './client'
import { withBatchTransaction } from './transaction'
import type { NormalizedDeal } from '@/lib/rules/types'
import type { MappedDeal } from '@/lib/hubspot/mapper'
import { asJson } from '@/lib/utils/json'

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

// Returns a single deal with all fields needed by the deal panel route.
export async function getDealById(hubspotId: string) {
  return prisma.deal.findUnique({
    where: { hubspotId },
    select: {
      hubspotId: true,
      name: true,
      stage: true,
      ownerId: true,
      amount: true,
      hubspotUrl: true,
      propertyAddress: true,
      county: true,
      parcelId: true,
      taxSaleDate: true,
      contactCount: true,
      lastActivityDate: true,
      stageEnteredAt: true,
      syncedAt: true,
    },
  })
}

// Upserts all deals in a single batched transaction with a 30s timeout.
// Replaces the direct prisma.$transaction call in layer1.ts.
export async function upsertDeals(deals: MappedDeal[]): Promise<void> {
  if (deals.length === 0) return

  await withBatchTransaction(
    deals.map(deal =>
      prisma.deal.upsert({
        where: { hubspotId: deal.hubspotId },
        update: {
          name: deal.name,
          stage: deal.stage,
          pipeline: deal.pipeline,
          ownerId: deal.ownerId,
          amount: deal.amount,
          estimatedSurplus: deal.estimatedSurplus,
          closeDate: deal.closeDate,
          lastActivityDate: deal.lastActivityDate,
          stageEnteredAt: deal.stageEnteredAt,
          lastModified: deal.lastModified,
          contactCount: deal.contactCount,
          propertyAddress: deal.propertyAddress,
          county: deal.county,
          parcelId: deal.parcelId,
          taxSaleDate: deal.taxSaleDate,
          hubspotUrl: deal.hubspotUrl,
          rawPayload: asJson(deal.rawPayload),
          syncedAt: new Date(),
        },
        create: {
          hubspotId: deal.hubspotId,
          name: deal.name,
          stage: deal.stage,
          pipeline: deal.pipeline,
          ownerId: deal.ownerId,
          amount: deal.amount,
          estimatedSurplus: deal.estimatedSurplus,
          closeDate: deal.closeDate,
          lastActivityDate: deal.lastActivityDate,
          stageEnteredAt: deal.stageEnteredAt,
          lastModified: deal.lastModified,
          contactCount: deal.contactCount,
          propertyAddress: deal.propertyAddress,
          county: deal.county,
          parcelId: deal.parcelId,
          taxSaleDate: deal.taxSaleDate,
          hubspotUrl: deal.hubspotUrl,
          rawPayload: asJson(deal.rawPayload),
          syncedAt: new Date(),
        },
      })
    )
  )
}
