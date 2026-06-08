import { prisma } from './client'
import { withTransaction } from './transaction'
import type { MappedActivity, MappedContact } from '@/lib/hubspot/mapper'
import { asJson } from '@/lib/utils/json'

export type EmployeeActivity = { ownerName: string; notes: number; calls: number }

// Aggregates notes and calls per owner for the last 7 days.
// Returns null when no activity data exists (prompts AI to omit the section).
export async function getEmployeeActivitySummary(
  ownerMap: Record<string, string>
): Promise<EmployeeActivity[] | null> {
  const sevenDaysAgo = new Date()
  sevenDaysAgo.setDate(sevenDaysAgo.getDate() - 7)

  const rows = await prisma.dealActivity.groupBy({
    by: ['authorOwnerId', 'type'],
    where: {
      timestamp: { gte: sevenDaysAgo },
      type: { in: ['note', 'call'] },
    },
    _count: { id: true },
  })

  if (rows.length === 0) return null

  const byOwner = new Map<string, { notes: number; calls: number }>()
  for (const row of rows) {
    const id = row.authorOwnerId ?? 'unknown'
    if (!byOwner.has(id)) byOwner.set(id, { notes: 0, calls: 0 })
    const entry = byOwner.get(id)!
    if (row.type === 'note') entry.notes += row._count.id
    else if (row.type === 'call') entry.calls += row._count.id
  }

  return Array.from(byOwner.entries()).map(([id, counts]) => ({
    ownerName: ownerMap[id] ?? id,
    ...counts,
  }))
}

// Atomically replaces all Layer 2 data for a deal (delete + reinsert).
// Uses withTransaction to enforce the 30s timeout and guarantee consistency.
export async function replaceLayer2Data(
  dealHubspotId: string,
  activities: MappedActivity[],
  contacts: MappedContact[]
): Promise<void> {
  await withTransaction(async tx => {
    await tx.dealActivity.deleteMany({ where: { dealHubspotId } })
    await tx.dealContact.deleteMany({ where: { dealHubspotId } })

    if (activities.length > 0) {
      await tx.dealActivity.createMany({
        data: activities.map(a => ({
          dealHubspotId,
          type: a.type,
          body: a.body,
          authorOwnerId: a.authorOwnerId,
          direction: a.direction,
          timestamp: a.timestamp,
          metadata: asJson(a.metadata ?? undefined),
          rawPayload: asJson(a.rawPayload ?? undefined),
        })),
      })
    }

    if (contacts.length > 0) {
      await tx.dealContact.createMany({
        data: contacts.map(c => ({
          dealHubspotId,
          contactHubspotId: c.contactHubspotId,
          name: c.name,
          contactType: c.contactType,
          ownershipStatus: c.ownershipStatus,
          isDeceased: c.isDeceased,
          doNotContact: c.doNotContact,
          phoneNumbers: c.phoneNumbers,
          emailList: c.emailList,
          rawPayload: asJson(c.rawPayload ?? undefined),
        })),
      })
    }
  })
}

export async function getActivitiesForDeal(hubspotId: string) {
  return prisma.dealActivity.findMany({
    where: { dealHubspotId: hubspotId },
    orderBy: { timestamp: 'desc' },
    select: {
      id: true,
      type: true,
      body: true,
      authorOwnerId: true,
      direction: true,
      timestamp: true,
      metadata: true,
      syncedAt: true,
    },
  })
}

// Returns the most recent Layer 2 sync timestamp for this deal, or null if not synced.
// Checks both deal_activities and deal_contacts — a deal may have contacts but no activities.
export async function getLayer2SyncedAt(hubspotId: string): Promise<Date | null> {
  const [activityRow, contactRow] = await Promise.all([
    prisma.dealActivity.findFirst({
      where: { dealHubspotId: hubspotId },
      orderBy: { syncedAt: 'desc' },
      select: { syncedAt: true },
    }),
    prisma.dealContact.findFirst({
      where: { dealHubspotId: hubspotId },
      orderBy: { syncedAt: 'desc' },
      select: { syncedAt: true },
    }),
  ])

  const activityAt = activityRow?.syncedAt ?? null
  const contactAt = contactRow?.syncedAt ?? null
  if (!activityAt && !contactAt) return null
  if (!activityAt) return contactAt
  if (!contactAt) return activityAt
  return activityAt > contactAt ? activityAt : contactAt
}
