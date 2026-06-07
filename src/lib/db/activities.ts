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

export async function getLayer2SyncedAt(hubspotId: string): Promise<Date | null> {
  const row = await prisma.dealActivity.findFirst({
    where: { dealHubspotId: hubspotId },
    orderBy: { syncedAt: 'desc' },
    select: { syncedAt: true },
  })
  return row?.syncedAt ?? null
}
