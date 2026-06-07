'use client'

import { useEffect, useState, useCallback } from 'react'
import DealPanel from '@/components/DealPanel'

type AttentionFlag = {
  type: string
  severity: 'urgent' | 'warning' | 'info'
  message: string
  daysOverdue?: number
}

type DealRow = {
  hubspotId: string
  name: string | null
  stage: string | null
  amount: number | null
  lastActivityDate: string | null
  contactCount: number
  syncedAt: string
}

type DealWithFlags = {
  deal: DealRow
  flags: AttentionFlag[]
}

type DealsResponse = {
  groups: Record<string, DealWithFlags[]>
  stageMap: Record<string, string>
  lastSyncedAt: string | null
  totalDeals: number
}

type GroupConfig = {
  label: string
  headerCls: string
  dotCls: string
  cardBorderCls: string
}

const FLAG_CONFIG: Record<string, GroupConfig> = {
  mo_action_required: {
    label: 'Mo Action Required',
    headerCls: 'bg-red-50 border-red-200 text-red-900',
    dotCls: 'bg-red-600',
    cardBorderCls: 'border-red-300',
  },
  agreement_no_followup: {
    label: 'Agreement — No Follow-Up',
    headerCls: 'bg-red-50 border-red-200 text-red-800',
    dotCls: 'bg-red-500',
    cardBorderCls: 'border-red-200',
  },
  stage_stale: {
    label: 'Stage Stale',
    headerCls: 'bg-yellow-50 border-yellow-200 text-yellow-800',
    dotCls: 'bg-yellow-500',
    cardBorderCls: 'border-yellow-200',
  },
  signed_no_activity: {
    label: 'Signed — No Activity',
    headerCls: 'bg-orange-50 border-orange-200 text-orange-800',
    dotCls: 'bg-orange-500',
    cardBorderCls: 'border-orange-200',
  },
  no_contacts: {
    label: 'No Contacts',
    headerCls: 'bg-orange-50 border-orange-200 text-orange-800',
    dotCls: 'bg-orange-400',
    cardBorderCls: 'border-orange-200',
  },
  snoozed: {
    label: 'Snoozed',
    headerCls: 'bg-gray-50 border-gray-200 text-gray-500',
    dotCls: 'bg-gray-400',
    cardBorderCls: 'border-gray-200',
  },
  healthy: {
    label: 'Healthy',
    headerCls: 'bg-green-50 border-green-200 text-green-800',
    dotCls: 'bg-green-500',
    cardBorderCls: 'border-green-200',
  },
}

const DISPLAY_ORDER = [
  'mo_action_required',
  'agreement_no_followup',
  'stage_stale',
  'signed_no_activity',
  'no_contacts',
  'snoozed',
  'healthy',
]

const COLLAPSED_BY_DEFAULT = new Set(['snoozed', 'healthy'])

function relativeTime(dateStr: string | null | undefined): string {
  if (!dateStr) return '—'
  const diffMs = Date.now() - new Date(dateStr).getTime()
  const mins = Math.floor(diffMs / 60_000)
  if (mins < 1) return 'just now'
  if (mins < 60) return `${mins}m ago`
  const hrs = Math.floor(mins / 60)
  if (hrs < 24) return `${hrs}h ago`
  const days = Math.floor(hrs / 24)
  if (days === 1) return 'yesterday'
  if (days < 30) return `${days}d ago`
  return `${Math.floor(days / 30)}mo ago`
}

function formatAmount(n: number | null): string {
  if (n === null) return ''
  return '$' + Math.round(n).toLocaleString('en-US')
}

function DealCard({
  item,
  stageMap,
  cardBorderCls,
  dotCls,
  onOpen,
}: {
  item: DealWithFlags
  stageMap: Record<string, string>
  cardBorderCls: string
  dotCls: string
  onOpen: (hubspotId: string) => void
}) {
  const { deal, flags } = item
  const primaryFlag = flags[0] ?? null
  const stageName = (deal.stage ? stageMap[deal.stage] : null) ?? deal.stage ?? '—'
  const amount = formatAmount(deal.amount)

  return (
    <button
      onClick={() => onOpen(deal.hubspotId)}
      className={`w-full text-left bg-white rounded-lg border ${cardBorderCls} p-4 hover:shadow-sm hover:border-gray-400 transition-all cursor-pointer`}
    >
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="font-medium text-gray-900 truncate">{deal.name ?? 'Unnamed deal'}</p>
          <p className="text-xs text-gray-500 mt-0.5">
            {stageName} · Activity {relativeTime(deal.lastActivityDate)}
          </p>
        </div>
        {amount && <p className="text-sm font-medium text-gray-600 shrink-0">{amount}</p>}
      </div>
      {primaryFlag && (
        <div className="mt-2 flex items-center gap-2">
          <span className={`w-1.5 h-1.5 rounded-full ${dotCls} shrink-0`} />
          <p className="text-sm text-gray-700 flex-1">{primaryFlag.message}</p>
          {primaryFlag.daysOverdue !== undefined && primaryFlag.daysOverdue > 0 && (
            <span className="text-xs font-medium text-red-600 shrink-0">
              {primaryFlag.daysOverdue}d overdue
            </span>
          )}
        </div>
      )}
    </button>
  )
}

function FlagGroup({
  groupKey,
  items,
  stageMap,
  onOpenDeal,
}: {
  groupKey: string
  items: DealWithFlags[]
  stageMap: Record<string, string>
  onOpenDeal: (hubspotId: string) => void
}) {
  const [open, setOpen] = useState(!COLLAPSED_BY_DEFAULT.has(groupKey))
  const config: GroupConfig = FLAG_CONFIG[groupKey] ?? {
    label: groupKey,
    headerCls: 'bg-gray-50 border-gray-200 text-gray-600',
    dotCls: 'bg-gray-400',
    cardBorderCls: 'border-gray-200',
  }

  return (
    <div className="space-y-2">
      <button
        onClick={() => setOpen(v => !v)}
        className={`w-full flex items-center justify-between px-4 py-3 rounded-lg border ${config.headerCls} text-sm font-medium text-left`}
      >
        <span className="flex items-center gap-2">
          <span className={`w-2 h-2 rounded-full ${config.dotCls} shrink-0`} />
          {config.label}
          <span className="font-normal opacity-60">({items.length})</span>
        </span>
        <span className="text-xs opacity-50">{open ? '▾' : '▸'}</span>
      </button>
      {open && (
        <div className="space-y-2 pl-1">
          {items.map(item => (
            <DealCard
              key={item.deal.hubspotId}
              item={item}
              stageMap={stageMap}
              cardBorderCls={config.cardBorderCls}
              dotCls={config.dotCls}
              onOpen={onOpenDeal}
            />
          ))}
        </div>
      )}
    </div>
  )
}

export default function DashboardPage() {
  const [data, setData] = useState<DealsResponse | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)
  const [syncing, setSyncing] = useState(false)
  const [selectedDealId, setSelectedDealId] = useState<string | null>(null)

  const fetchDeals = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const res = await fetch('/api/deals')
      if (!res.ok) throw new Error(`${res.status} ${res.statusText}`)
      setData(await res.json())
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to load deals')
    } finally {
      setLoading(false)
    }
  }, [])

  const syncNow = useCallback(
    async (force: boolean) => {
      setSyncing(true)
      setError(null)
      try {
        const url = force ? '/api/sync/layer1?force=true' : '/api/sync/layer1'
        const res = await fetch(url, { method: 'POST' })
        if (!res.ok) {
          const body = await res.json().catch(() => ({}))
          throw new Error(body?.error ?? `Sync failed: ${res.status}`)
        }
        await fetchDeals()
      } catch (e) {
        setError(e instanceof Error ? e.message : 'Sync failed')
        setSyncing(false)
      }
    },
    [fetchDeals]
  )

  useEffect(() => {
    fetchDeals()
  }, [fetchDeals])

  const orderedGroups = DISPLAY_ORDER.filter(key => data?.groups[key]?.length).map(key => ({
    key,
    items: data!.groups[key],
  }))

  const flaggedCount = orderedGroups
    .filter(g => !COLLAPSED_BY_DEFAULT.has(g.key))
    .reduce((sum, g) => sum + g.items.length, 0)

  return (
    <>
    <div className="p-8 max-w-2xl mx-auto">
      {/* Header */}
      <div className="flex items-start justify-between mb-6 gap-4">
        <div>
          <h1 className="text-2xl font-semibold text-gray-900">Attention Queue</h1>
          <p className="text-sm text-gray-500 mt-1">
            {data ? (
              <>
                {flaggedCount} deal{flaggedCount !== 1 ? 's' : ''} need attention · {data.totalDeals} total
                {data.lastSyncedAt && (
                  <> · Synced {relativeTime(data.lastSyncedAt)}</>
                )}
              </>
            ) : loading ? (
              'Loading…'
            ) : (
              'No sync data — run Sync Now to populate'
            )}
          </p>
        </div>
        <div className="flex items-center gap-2 shrink-0">
          <button
            onClick={fetchDeals}
            disabled={loading || syncing}
            className="px-3 py-1.5 text-sm text-gray-700 bg-white border border-gray-300 rounded-md hover:bg-gray-50 disabled:opacity-40 transition-colors"
          >
            {loading && !syncing ? 'Loading…' : 'Refresh'}
          </button>
          <button
            onClick={() => syncNow(false)}
            disabled={syncing || loading}
            className="px-3 py-1.5 text-sm text-white bg-gray-900 rounded-md hover:bg-gray-700 disabled:opacity-40 transition-colors"
          >
            {syncing ? 'Syncing…' : 'Sync Now'}
          </button>
          <button
            onClick={() => syncNow(true)}
            disabled={syncing || loading}
            className="px-3 py-1.5 text-sm text-gray-600 bg-white border border-gray-300 rounded-md hover:bg-gray-50 disabled:opacity-40 transition-colors"
            title="Force full refresh — re-fetches all 150 deals from HubSpot"
          >
            Force Refresh
          </button>
        </div>
      </div>

      {/* Error banner */}
      {error && (
        <div className="mb-4 px-4 py-3 bg-red-50 border border-red-200 rounded-lg text-sm text-red-700">
          {error}
        </div>
      )}

      {/* Loading skeleton */}
      {loading && !data && (
        <div className="space-y-3">
          {[0, 1, 2].map(i => (
            <div key={i} className="h-14 bg-gray-100 rounded-lg animate-pulse" />
          ))}
        </div>
      )}

      {/* Empty state */}
      {!loading && data && orderedGroups.length === 0 && (
        <div className="text-center py-16 text-gray-400 text-sm">
          No deals yet. Run Sync Now to pull data from HubSpot.
        </div>
      )}

      {/* Groups */}
      {data && orderedGroups.length > 0 && (
        <div className="space-y-4">
          {orderedGroups.map(({ key, items }) => (
            <FlagGroup
              key={key}
              groupKey={key}
              items={items}
              stageMap={data.stageMap}
              onOpenDeal={setSelectedDealId}
            />
          ))}
        </div>
      )}
    </div>

    {/* Deal detail panel */}
    {selectedDealId && (
      <DealPanel
        hubspotId={selectedDealId}
        onClose={() => {
          setSelectedDealId(null)
          fetchDeals()
        }}
      />
    )}
    </>
  )
}
