import { NextRequest, NextResponse } from 'next/server'
import { getDealById } from '@/lib/db/deals'
import { getDealEnrichedById } from '@/lib/db/analytics'
import { loadStageMap, loadOwnerMap } from '@/lib/db/settings'
import { getActivitiesForDeal, getLayer2SyncedAt } from '@/lib/db/activities'
import { getContactsForDeal } from '@/lib/db/contacts'
import { getActiveSnooze, getSnoozeHistory } from '@/lib/db/snoozes'
import { getLatestSummary } from '@/lib/db/summaries'

export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params

  const [deal, activities, contacts, snooze, snoozeHistory, stageMap, ownerMap, summary, enriched] = await Promise.all([
    getDealById(id),
    getActivitiesForDeal(id),
    getContactsForDeal(id),
    getActiveSnooze(id),
    getSnoozeHistory(id),
    loadStageMap(),
    loadOwnerMap(),
    getLatestSummary(id),
    getDealEnrichedById(id),
  ])

  if (!deal) return NextResponse.json({ error: 'Not found' }, { status: 404 })

  const layer2SyncedAt = await getLayer2SyncedAt(id)

  return NextResponse.json({
    deal: {
      hubspotId: deal.hubspotId,
      name: deal.name,
      stage: deal.stage,
      stageName: deal.stage ? (stageMap[deal.stage] ?? deal.stage) : null,
      ownerId: deal.ownerId,
      ownerName: deal.ownerId ? (ownerMap[deal.ownerId] ?? null) : null,
      amount: deal.amount !== null ? Number(deal.amount) : null,
      hubspotUrl: deal.hubspotUrl,
      propertyAddress: deal.propertyAddress,
      county: deal.county,
      parcelId: deal.parcelId,
      taxSaleDate: deal.taxSaleDate,
      caseType: deal.caseType,
      contactCount: deal.contactCount,
      lastActivityDate: deal.lastActivityDate,
      stageEnteredAt: deal.stageEnteredAt,
      syncedAt: deal.syncedAt,
    },
    activities: activities.map(a => ({
      id: a.id,
      type: a.type,
      body: a.body,
      authorOwnerId: a.authorOwnerId,
      authorName: a.authorOwnerId ? (ownerMap[a.authorOwnerId] ?? null) : null,
      direction: a.direction,
      timestamp: a.timestamp,
      metadata: a.metadata,
    })),
    contacts: contacts.map(c => ({
      id: c.id,
      contactHubspotId: c.contactHubspotId,
      name: c.name,
      contactType: c.contactType,
      ownershipStatus: c.ownershipStatus,
      isDeceased: c.isDeceased,
      doNotContact: c.doNotContact,
      phoneNumbers: Array.isArray(c.phoneNumbers) ? c.phoneNumbers : [],
      emailList: Array.isArray(c.emailList) ? c.emailList : [],
      address: c.address ?? null,
      city: c.city ?? null,
      state: c.state ?? null,
      zip: c.zip ?? null,
    })),
    snooze: snooze
      ? {
          id: snooze.id,
          category: snooze.category,
          freeformNote: snooze.freeformNote,
          snoozeUntil: snooze.snoozeUntil,
          createdAt: snooze.createdAt,
        }
      : null,
    snoozeHistory: snoozeHistory.map(s => ({
      id: s.id,
      category: s.category,
      freeformNote: s.freeformNote,
      snoozeUntil: s.snoozeUntil,
      createdAt: s.createdAt,
      wokeAt: s.wokeAt,
    })),
    layer2SyncedAt,
    summaryData: summary
      ? { json: summary.summaryJson, generatedAt: summary.generatedAt }
      : null,
    enriched,
  })
}
