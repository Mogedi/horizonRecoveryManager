import { type Prisma } from '@prisma/client'
import { hubspotSearchAll } from '@/lib/hubspot/client'
import { mapDeal } from '@/lib/hubspot/mapper'
import { loadStageMap } from '@/lib/db/settings'
import {
  assertDailyLimitOk,
  startSyncLog,
  completeSyncLog,
  failSyncLog,
  getLastSyncedAt,
} from '@/lib/db/sync-log'
import { prisma } from '@/lib/db/client'

// Safely cast unknown/object values to Prisma's Json type.
function asJson(v: unknown): Prisma.InputJsonValue | undefined {
  if (v === undefined) return undefined
  return v as Prisma.InputJsonValue
}

const PIPELINE_ID = '2172337854'

const DEAL_PROPERTIES = [
  'dealname', 'dealstage', 'pipeline', 'amount', 'estimated_surplus',
  'hubspot_owner_id', 'closedate', 'notes_last_updated',
  'hs_v2_date_entered_current_stage', 'hs_lastmodifieddate',
  'num_associated_contacts', 'hs_is_stalled', 'hs_is_closed_won', 'hs_is_closed_lost',
  'properties_address', 'county', 'parcel_id__deal', 'tax_sale_date',
]

export type Layer1SyncResult = {
  dealsSynced: number
  apiCallsMade: number
  mode: 'smart' | 'full'
}

// Smart sync: only pulls deals modified since last successful sync.
// Falls back to full refresh if no prior sync exists.
export async function runLayer1Sync(force = false): Promise<Layer1SyncResult> {
  await assertDailyLimitOk()

  const logEntry = await startSyncLog('layer1')
  const stageMap = await loadStageMap()

  const lastSyncedAt = force ? null : await getLastSyncedAt()
  const mode: 'smart' | 'full' = lastSyncedAt ? 'smart' : 'full'

  const filterGroups: object[] = [
    {
      filters: [
        { propertyName: 'pipeline', operator: 'EQ', value: PIPELINE_ID },
        ...(lastSyncedAt
          ? [{ propertyName: 'hs_lastmodifieddate', operator: 'GTE', value: lastSyncedAt.getTime().toString() }]
          : []),
      ],
    },
  ]

  let dealsSynced = 0
  let apiCallsMade = 0

  try {
    const { results, callCount } = await hubspotSearchAll<{
      id: string
      properties: Record<string, string | null>
      url?: string | null
    }>({
      filterGroups,
      properties: DEAL_PROPERTIES,
      sorts: [{ propertyName: 'hs_lastmodifieddate', direction: 'DESCENDING' }],
      limit: 100,
    })
    apiCallsMade += callCount

    for (const raw of results) {
      const deal = mapDeal(raw, stageMap)
      await prisma.deal.upsert({
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
        },
      })
      dealsSynced++
    }

    await completeSyncLog(logEntry.id, apiCallsMade, dealsSynced)
    return { dealsSynced, apiCallsMade, mode }
  } catch (err) {
    await failSyncLog(logEntry.id, err instanceof Error ? err.message : String(err))
    throw err
  }
}
