import { prisma } from './client'

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
