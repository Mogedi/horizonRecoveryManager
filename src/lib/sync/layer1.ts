import { hubspotSearchAll } from '@/lib/hubspot/client'
import { mapDeal } from '@/lib/hubspot/mapper'
import {
  assertDailyLimitOk,
  startSyncLog,
  completeSyncLog,
  failSyncLog,
  getLastSyncedAt,
} from '@/lib/db/sync-log'
import { upsertDeals } from '@/lib/db/deals'

// "Cases – Surplus Funds" pipeline — see docs/research/pipeline-stages.json for stage IDs
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
  // hubspot_ids of the deals this sync touched. In 'smart' mode these are exactly the deals
  // modified since the last sync — i.e. the "something changed" set, used to drive a targeted
  // Layer 2 refresh without re-pulling all 150.
  changedDealIds: string[]
}

// Smart sync: only pulls deals modified since last successful sync.
// Falls back to full refresh if no prior sync exists.
export async function runLayer1Sync(force = false): Promise<Layer1SyncResult> {
  await assertDailyLimitOk()

  const logEntry = await startSyncLog('layer1')

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

    const deals = results.map(raw => mapDeal(raw))
    dealsSynced = deals.length

    await upsertDeals(deals)

    await completeSyncLog(logEntry.id, apiCallsMade, dealsSynced)
    return { dealsSynced, apiCallsMade, mode, changedDealIds: deals.map(d => d.hubspotId) }
  } catch (err) {
    await failSyncLog(logEntry.id, err instanceof Error ? err.message : String(err))
    throw err
  }
}
