'use client'

import { useEffect, useState, useCallback, useRef, Suspense } from 'react'
import { useSearchParams, useRouter } from 'next/navigation'
import useSWR from 'swr'

const fetcher = (url: string) => fetch(url).then(r => r.ok ? r.json() : Promise.reject(new Error(r.statusText)))
import DealPanel from '@/components/DealPanel'
import DealSearch from '@/components/DealSearch'
import { formatAmount, relativeDate } from '@/lib/utils/format'

// ─── Types ────────────────────────────────────────────────────────────────────

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
  stageEnteredAt: string | null
  contactCount: number
  syncedAt: string
}

type DealWithFlags = {
  deal: DealRow
  flags: AttentionFlag[]
}

type WeeklyCallStats = {
  totalCalls: number
  liveCount: number
  voicemailCount: number
  disconnectedCount: number
  noAnswerCount: number
  dealsCalledCount: number
}

type PipelineStats = {
  byStage: unknown[]
  kpi: {
    totalPipelineValue: number
    totalActiveDeals: number
    closingValue: number
    closingCount: number
    needsAttentionCount: number
    urgentCount: number
  }
  weeklyCalls: WeeklyCallStats
}

type DealsResponse = {
  groups: Record<string, DealWithFlags[]>
  stageMap: Record<string, string>
  lastSyncedAt: string | null
  lastSyncError: string | null
  totalDeals: number
  classifiedCallCounts: Record<string, number>
  pipelineStats: PipelineStats
}

// ─── Bucket config ────────────────────────────────────────────────────────────

type BucketKey = 'call_today' | 'follow_up' | 'ready_work' | 'move_close'

type BucketConfig = {
  key: BucketKey
  label: string
  description: string
  emptyMessage: string
  // Tailwind color token (must be complete classes — no dynamic construction)
  tabActive: string
  tabInactive: string
  badge: string
  cardSelected: string
  dot: string
}

const BUCKET_CONFIG: Record<BucketKey, BucketConfig> = {
  call_today: {
    key: 'call_today',
    label: 'Call Today',
    description: 'Outreach stage deals that need a call',
    emptyMessage: 'No calls needed — outreach pipeline is current.',
    tabActive: 'border-rose-500 text-rose-700',
    tabInactive: 'border-transparent text-gray-500 hover:text-gray-700 hover:border-gray-300',
    badge: 'bg-rose-100 text-rose-700',
    cardSelected: 'border-l-rose-400 bg-rose-50',
    dot: 'bg-rose-500',
  },
  follow_up: {
    key: 'follow_up',
    label: 'Follow Up',
    description: 'Agreements, signed cases, and Mo-action items',
    emptyMessage: 'Nothing waiting on a response — all cases are moving.',
    tabActive: 'border-amber-500 text-amber-700',
    tabInactive: 'border-transparent text-gray-500 hover:text-gray-700 hover:border-gray-300',
    badge: 'bg-amber-100 text-amber-700',
    cardSelected: 'border-l-amber-400 bg-amber-50',
    dot: 'bg-amber-500',
  },
  ready_work: {
    key: 'ready_work',
    label: 'Ready to Work',
    description: 'New cases waiting to enter the calling cycle',
    emptyMessage: 'No new cases staged — add fresh leads to grow the pipeline.',
    tabActive: 'border-blue-500 text-blue-700',
    tabInactive: 'border-transparent text-gray-500 hover:text-gray-700 hover:border-gray-300',
    badge: 'bg-blue-100 text-blue-700',
    cardSelected: 'border-l-blue-400 bg-blue-50',
    dot: 'bg-blue-500',
  },
  move_close: {
    key: 'move_close',
    label: 'Move or Close',
    description: 'Stuck deals — decide to push forward or clear the slot',
    emptyMessage: 'Pipeline is clean — no stuck or blocked deals.',
    tabActive: 'border-orange-500 text-orange-700',
    tabInactive: 'border-transparent text-gray-500 hover:text-gray-700 hover:border-gray-300',
    badge: 'bg-orange-100 text-orange-700',
    cardSelected: 'border-l-orange-400 bg-orange-50',
    dot: 'bg-orange-500',
  },
}

const BUCKET_ORDER: BucketKey[] = ['call_today', 'follow_up', 'ready_work', 'move_close']

// ─── Sorting ──────────────────────────────────────────────────────────────────

function sortDeals(items: DealWithFlags[], bucket: BucketKey): DealWithFlags[] {
  return [...items].sort((a, b) => {
    if (bucket === 'ready_work') {
      // Longest waiting first (oldest stageEnteredAt), then by amount desc
      const aDate = a.deal.stageEnteredAt ? new Date(a.deal.stageEnteredAt).getTime() : 0
      const bDate = b.deal.stageEnteredAt ? new Date(b.deal.stageEnteredAt).getTime() : 0
      if (aDate !== bDate) return aDate - bDate
    } else {
      // Most overdue first, then by severity, then by amount
      const aOver = a.flags[0]?.daysOverdue ?? -1
      const bOver = b.flags[0]?.daysOverdue ?? -1
      if (aOver !== bOver) return bOver - aOver
      const sev = { urgent: 2, warning: 1, info: 0 }
      const aSev = sev[a.flags[0]?.severity ?? 'info'] ?? 0
      const bSev = sev[b.flags[0]?.severity ?? 'info'] ?? 0
      if (aSev !== bSev) return bSev - aSev
    }
    return (b.deal.amount ?? 0) - (a.deal.amount ?? 0)
  })
}

// ─── Mini card key metric ─────────────────────────────────────────────────────

function getKeyMetric(item: DealWithFlags, bucket: BucketKey): { text: string; urgent: boolean } {
  const { deal, flags } = item
  const flag = flags[0]

  if (flag?.daysOverdue !== undefined && flag.daysOverdue >= 0) {
    return { text: `${flag.daysOverdue}d overdue`, urgent: flag.severity === 'urgent' }
  }
  if (bucket === 'move_close' && flag?.type === 'no_contacts') {
    return { text: 'No phone number', urgent: false }
  }
  if (bucket === 'move_close' && flag) {
    return { text: flag.message.slice(0, 32), urgent: false }
  }
  if (deal.lastActivityDate) {
    return { text: `Active ${relativeDate(deal.lastActivityDate)}`, urgent: false }
  }
  if (deal.stageEnteredAt) {
    return { text: `In stage ${relativeDate(deal.stageEnteredAt)}`, urgent: false }
  }
  return { text: 'No activity recorded', urgent: false }
}

// ─── KpiHeader ────────────────────────────────────────────────────────────────

function KpiHeader({
  data,
  onSync,
  onForceSync,
  syncing,
  loading,
  onBriefing,
}: {
  data: DealsResponse | null
  onSync: () => void
  onForceSync: () => void
  syncing: boolean
  loading: boolean
  onBriefing: () => void
}) {
  const kpi = data?.pipelineStats?.kpi
  const calls = data?.pipelineStats?.weeklyCalls
  const answeredCalls = calls ? calls.totalCalls - calls.noAnswerCount : 0
  const convRate = answeredCalls > 0 && calls ? Math.round((calls.liveCount / answeredCalls) * 100) : null

  return (
    <div className="bg-white border-b border-gray-200 shrink-0">
      {/* Top row: title + actions */}
      <div className="flex items-center justify-between px-6 py-3 border-b border-gray-100">
        <div className="flex items-center gap-3">
          <h1 className="text-sm font-semibold text-gray-900">Horizon Recovery</h1>
          {data?.lastSyncError && (
            <span className="text-xs text-amber-600 bg-amber-50 border border-amber-200 rounded px-2 py-0.5">
              Sync error — showing stale data
            </span>
          )}
          {data?.lastSyncedAt && !data.lastSyncError && (
            <span className="text-xs text-gray-400">Synced {relativeDate(data.lastSyncedAt)}</span>
          )}
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={onBriefing}
            className="text-xs text-gray-500 hover:text-gray-800 px-2.5 py-1.5 rounded border border-gray-200 hover:border-gray-300 transition-colors"
          >
            Daily Briefing
          </button>
          <button
            onClick={onSync}
            disabled={syncing || loading}
            className="text-xs text-gray-500 hover:text-gray-800 px-2.5 py-1.5 rounded border border-gray-200 hover:border-gray-300 disabled:opacity-40 transition-colors"
          >
            {syncing ? 'Syncing…' : 'Sync'}
          </button>
          <button
            onClick={onForceSync}
            disabled={syncing || loading}
            className="text-xs text-white bg-gray-900 hover:bg-gray-700 px-2.5 py-1.5 rounded disabled:opacity-40 transition-colors"
          >
            Force Refresh
          </button>
        </div>
      </div>

      {/* KPI metrics row */}
      <div className="flex divide-x divide-gray-100 px-0">
        <KpiTile
          label="Pipeline"
          primary={kpi ? (formatAmount(kpi.totalPipelineValue) ?? '$0') : '—'}
          sub={kpi ? `${kpi.totalActiveDeals} active deals` : 'loading'}
        />
        <KpiTile
          label="Needs Attention"
          primary={kpi ? `${kpi.needsAttentionCount}` : '—'}
          sub={kpi ? `${kpi.urgentCount} urgent` : 'loading'}
          highlight={!!kpi && kpi.urgentCount > 0}
        />
        <KpiTile
          label="Closing"
          primary={kpi ? (formatAmount(kpi.closingValue) ?? '$0') : '—'}
          sub={kpi ? `${kpi.closingCount} deal${kpi.closingCount !== 1 ? 's' : ''}` : 'loading'}
        />
        <KpiTile
          label="Calls / Week"
          primary={calls ? `${calls.totalCalls}` : '—'}
          sub={calls ? `${calls.liveCount} live · ${calls.voicemailCount} VM · ${calls.noAnswerCount} no ans` : 'loading'}
        />
        <KpiTile
          label="Conv. Rate"
          primary={convRate !== null ? `${convRate}%` : '—'}
          sub={calls && calls.totalCalls > 0 ? `${calls.dealsCalledCount} deals reached` : 'no data yet'}
        />
        <KpiTile
          label="Total Deals"
          primary={data ? `${data.totalDeals}` : '—'}
          sub={data?.lastSyncedAt ? `as of ${relativeDate(data.lastSyncedAt)}` : 'not synced'}
        />
      </div>
    </div>
  )
}

function KpiTile({
  label,
  primary,
  sub,
  highlight = false,
}: {
  label: string
  primary: string
  sub: string
  highlight?: boolean
}) {
  return (
    <div className="flex-1 px-5 py-3 min-w-0">
      <p className="text-[10px] font-semibold uppercase tracking-wider text-gray-400">{label}</p>
      <p className={`text-xl font-bold mt-0.5 leading-none ${highlight ? 'text-rose-600' : 'text-gray-900'}`}>
        {primary}
      </p>
      <p className="text-[11px] text-gray-400 mt-1 truncate">{sub}</p>
    </div>
  )
}

// ─── Tab bar ──────────────────────────────────────────────────────────────────

function TabBar({
  activeTab,
  onTabChange,
  counts,
}: {
  activeTab: BucketKey
  onTabChange: (tab: BucketKey) => void
  counts: Record<BucketKey, number>
}) {
  return (
    <div className="bg-white border-b border-gray-200 shrink-0 flex px-6 gap-0">
      {BUCKET_ORDER.map(key => {
        const cfg = BUCKET_CONFIG[key]
        const count = counts[key]
        const isActive = activeTab === key
        return (
          <button
            key={key}
            onClick={() => onTabChange(key)}
            title={cfg.description}
            className={`flex items-center gap-2 px-4 py-3 text-sm font-medium border-b-2 transition-colors mr-1 ${
              isActive ? cfg.tabActive : cfg.tabInactive
            }`}
          >
            {cfg.label}
            {count > 0 && (
              <span className={`text-xs px-1.5 py-0.5 rounded-full font-semibold ${
                isActive ? cfg.badge : 'bg-gray-100 text-gray-500'
              }`}>
                {count}
              </span>
            )}
          </button>
        )
      })}
    </div>
  )
}

// ─── Mini card ────────────────────────────────────────────────────────────────

function MiniCard({
  item,
  isSelected,
  onClick,
  bucket,
  stageMap,
  classifiedCallCount,
}: {
  item: DealWithFlags
  isSelected: boolean
  onClick: () => void
  bucket: BucketKey
  stageMap: Record<string, string>
  classifiedCallCount: number
}) {
  const { deal, flags } = item
  const cfg = BUCKET_CONFIG[bucket]
  const metric = getKeyMetric(item, bucket)
  const stageName = (deal.stage ? stageMap[deal.stage] : null) ?? '—'
  const hasFlagBeyondSnooze = flags.length > 0

  return (
    <button
      onClick={onClick}
      className={`w-full text-left px-4 py-3 border-b border-gray-100 transition-all border-l-2 ${
        isSelected
          ? `${cfg.cardSelected} border-l-[3px]`
          : 'border-l-transparent hover:bg-gray-50'
      }`}
    >
      <div className="flex items-start justify-between gap-2 mb-0.5">
        <p className="text-[13px] font-semibold text-gray-900 truncate leading-snug">
          {deal.name ?? 'Unnamed deal'}
        </p>
        {deal.amount != null && (
          <p className="text-[11px] text-gray-400 shrink-0 mt-0.5">{formatAmount(deal.amount)}</p>
        )}
      </div>

      <p className="text-[11px] text-gray-400 truncate mb-1">{stageName}</p>

      <div className="flex items-center justify-between gap-2">
        {hasFlagBeyondSnooze ? (
          <span className={`text-[11px] font-medium ${metric.urgent ? 'text-rose-600' : 'text-amber-600'}`}>
            {metric.text}
          </span>
        ) : (
          <span className="text-[11px] text-gray-400">{metric.text}</span>
        )}
        {classifiedCallCount > 0 && (
          <span className="text-[10px] text-indigo-500 shrink-0">{classifiedCallCount} tx</span>
        )}
      </div>
    </button>
  )
}

// ─── Empty states ─────────────────────────────────────────────────────────────

function EmptyBucket({ bucket }: { bucket: BucketKey }) {
  const cfg = BUCKET_CONFIG[bucket]
  return (
    <div className="flex flex-col items-center justify-center h-full text-center px-8">
      <div className={`w-2 h-2 rounded-full ${cfg.dot} mb-4 opacity-40`} />
      <p className="text-sm font-medium text-gray-500">{cfg.emptyMessage}</p>
    </div>
  )
}

function EmptyDetailPane({ bucket }: { bucket: BucketKey }) {
  const cfg = BUCKET_CONFIG[bucket]
  return (
    <div className="flex flex-col items-center justify-center h-full text-center px-8 bg-gray-50">
      <div className={`w-2.5 h-2.5 rounded-full ${cfg.dot} mb-3 opacity-30`} />
      <p className="text-sm font-medium text-gray-400 mb-1">Select a deal</p>
      <p className="text-xs text-gray-400">{cfg.description}</p>
    </div>
  )
}

// ─── Briefing modal ───────────────────────────────────────────────────────────

function BriefingModal({ onClose }: { onClose: () => void }) {
  const [state, setState] = useState<'loading' | 'streaming' | 'done' | 'error'>('loading')
  const [briefing, setBriefing] = useState('')
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    const controller = new AbortController()
    const timeout = setTimeout(() => controller.abort(), 90_000)
    ;(async () => {
      try {
        const res = await fetch('/api/briefing', { method: 'POST', signal: controller.signal })
        if (!res.ok) {
          const body = await res.json().catch(() => ({}))
          throw new Error(body?.error ?? `Failed: ${res.status}`)
        }
        if (!res.body) throw new Error('No response body')
        const reader = res.body.getReader()
        const decoder = new TextDecoder()
        setState('streaming')
        while (true) {
          const { done, value } = await reader.read()
          if (done) break
          setBriefing(prev => prev + decoder.decode(value, { stream: true }))
        }
        setState('done')
      } catch (e) {
        setError((e as Error).name === 'AbortError' ? 'Timed out after 90s.' : (e instanceof Error ? e.message : 'Failed'))
        setState('error')
      } finally {
        clearTimeout(timeout)
      }
    })()
    return () => { controller.abort(); clearTimeout(timeout) }
  }, [])

  return (
    <>
      <div className="fixed inset-0 z-50 bg-black/40" onClick={onClose} />
      <div className="fixed inset-x-4 top-16 bottom-8 z-50 max-w-3xl mx-auto bg-white rounded-xl shadow-2xl flex flex-col overflow-hidden">
        <div className="flex items-center justify-between px-6 py-4 border-b border-gray-200 shrink-0">
          <h2 className="text-base font-semibold text-gray-900">Daily Briefing</h2>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-700 text-lg leading-none">✕</button>
        </div>
        <div className="flex-1 overflow-auto px-6 py-5">
          {state === 'loading' && (
            <div className="flex items-center gap-3 text-sm text-gray-500">
              <div className="w-4 h-4 border-2 border-gray-300 border-t-gray-700 rounded-full animate-spin shrink-0" />
              Preparing briefing…
            </div>
          )}
          {state === 'error' && <p className="text-sm text-red-600">{error}</p>}
          {(state === 'streaming' || state === 'done') && (
            <p className="text-sm text-gray-800 leading-relaxed whitespace-pre-wrap">
              {briefing}
              {state === 'streaming' && (
                <span className="inline-block w-0.5 h-4 bg-gray-400 ml-0.5 animate-pulse align-middle" />
              )}
            </p>
          )}
        </div>
      </div>
    </>
  )
}

// ─── Main dashboard ───────────────────────────────────────────────────────────

function DashboardContent() {
  const searchParams = useSearchParams()
  const router = useRouter()

  const { data, error, isLoading, mutate } = useSWR<DealsResponse>('/api/deals', fetcher, { dedupingInterval: 30_000 })
  const [syncError, setSyncError] = useState<string | null>(null)
  const [syncing, setSyncing] = useState(false)
  const [activeTab, setActiveTab] = useState<BucketKey>('call_today')
  const [selectedDealId, setSelectedDealId] = useState<string | null>(null)
  const [showBriefing, setShowBriefing] = useState(false)
  const [showSnoozed, setShowSnoozed] = useState(false)
  const [searchQuery, setSearchQuery] = useState('')
  const searchActive = searchQuery.length >= 2
  const dealParamHandled = useRef(false)

  // Auto-select first deal when data loads or tab changes
  useEffect(() => {
    if (!data) return
    setSelectedDealId(prev => {
      if (prev) return prev
      const items = data.groups[activeTab]
      if (items && items.length > 0) return items[0].deal.hubspotId
      return null
    })
  }, [data, activeTab])

  const syncNow = useCallback(async (force: boolean) => {
    setSyncing(true)
    setSyncError(null)
    try {
      const url = force ? '/api/sync/layer1?force=true' : '/api/sync/layer1'
      const res = await fetch(url, { method: 'POST' })
      if (!res.ok) {
        const body = await res.json().catch(() => ({}))
        throw new Error(body?.error ?? `Sync failed: ${res.status}`)
      }
      await mutate()
    } catch (e) {
      setSyncError(e instanceof Error ? e.message : 'Sync failed')
    } finally {
      setSyncing(false)
    }
  }, [mutate])

  useEffect(() => {
    if (!data || dealParamHandled.current) return
    const dealId = searchParams.get('deal')
    if (!dealId) return
    dealParamHandled.current = true
    setSelectedDealId(dealId)
    router.replace('/dashboard')
  }, [data, searchParams, router])

  // When tab changes, auto-select the first deal in that tab
  const handleTabChange = (tab: BucketKey) => {
    setActiveTab(tab)
    setSelectedDealId(prev => {
      const items = data?.groups[tab]
      if (items && items.length > 0) {
        // Keep current selection if it lives in the new tab
        if (prev && items.some(i => i.deal.hubspotId === prev)) return prev
        return items[0].deal.hubspotId
      }
      return null
    })
  }

  const currentItems = data?.groups[activeTab] ?? []
  const sortedItems = sortDeals(currentItems, activeTab)

  const counts: Record<BucketKey, number> = {
    call_today: data?.groups.call_today?.length ?? 0,
    follow_up: data?.groups.follow_up?.length ?? 0,
    ready_work: data?.groups.ready_work?.length ?? 0,
    move_close: data?.groups.move_close?.length ?? 0,
  }
  const snoozedCount = data?.groups.snoozed?.length ?? 0

  return (
    <div className="flex flex-col bg-gray-50 overflow-hidden" style={{ height: '100dvh' }}>

      {/* KPI header */}
      <KpiHeader
        data={data ?? null}
        onSync={() => syncNow(false)}
        onForceSync={() => syncNow(true)}
        syncing={syncing}
        loading={isLoading}
        onBriefing={() => setShowBriefing(true)}
      />

      {/* Error banner */}
      {(error || syncError) && (
        <div className="shrink-0 mx-4 mt-2 px-4 py-2 bg-red-50 border border-red-200 rounded-lg text-sm text-red-700">
          {syncError ?? error?.message ?? 'Failed to load deals'}
        </div>
      )}

      {/* Tab bar — hidden while search is active */}
      {!searchActive && (
        <TabBar activeTab={activeTab} onTabChange={handleTabChange} counts={counts} />
      )}

      {/* Master-detail content */}
      <div className="flex-1 flex min-h-0">

        {/* Left: search + mini card list */}
        <div className="w-72 shrink-0 border-r border-gray-200 bg-white flex flex-col min-h-0">

          {/* Search — always visible, manages its own results when active */}
          <DealSearch
            onSelect={id => setSelectedDealId(id)}
            selectedId={selectedDealId}
            onQueryChange={setSearchQuery}
          />

          {/* Normal queue — hidden while search is showing results */}
          {!searchActive && (
            isLoading && !data ? (
              <div className="p-4 space-y-3">
                {[0, 1, 2, 3, 4].map(i => (
                  <div key={i} className="h-14 bg-gray-100 rounded animate-pulse" />
                ))}
              </div>
            ) : sortedItems.length === 0 ? (
              <EmptyBucket bucket={activeTab} />
            ) : (
              <div className="flex-1 overflow-y-auto">
                {sortedItems.map(item => (
                  <MiniCard
                    key={item.deal.hubspotId}
                    item={item}
                    isSelected={selectedDealId === item.deal.hubspotId}
                    onClick={() => setSelectedDealId(item.deal.hubspotId)}
                    bucket={activeTab}
                    stageMap={data!.stageMap}
                    classifiedCallCount={data?.classifiedCallCounts[item.deal.hubspotId] ?? 0}
                  />
                ))}

                {/* Snoozed toggle at bottom */}
                {snoozedCount > 0 && (
                  <div className="border-t border-gray-100 mt-2">
                    <button
                      onClick={() => setShowSnoozed(v => !v)}
                      className="w-full flex items-center justify-between px-4 py-2.5 text-[11px] text-gray-400 hover:text-gray-600 hover:bg-gray-50 transition-colors"
                    >
                      <span>Set aside ({snoozedCount})</span>
                      <span>{showSnoozed ? '▾' : '▸'}</span>
                    </button>
                    {showSnoozed && data?.groups.snoozed?.map(item => (
                      <MiniCard
                        key={item.deal.hubspotId}
                        item={item}
                        isSelected={selectedDealId === item.deal.hubspotId}
                        onClick={() => setSelectedDealId(item.deal.hubspotId)}
                        bucket={'call_today'}
                        stageMap={data.stageMap}
                        classifiedCallCount={data?.classifiedCallCounts[item.deal.hubspotId] ?? 0}
                      />
                    ))}
                  </div>
                )}
              </div>
            )
          )}
        </div>

        {/* Right: deal detail panel */}
        <div className="flex-1 min-w-0 overflow-hidden">
          {selectedDealId ? (
            <DealPanel
              key={selectedDealId}
              hubspotId={selectedDealId}
              inline
              onClose={() => {
                setSelectedDealId(null)
                mutate()
              }}
            />
          ) : (
            <EmptyDetailPane bucket={activeTab} />
          )}
        </div>

      </div>

      {/* Daily Briefing modal */}
      {showBriefing && <BriefingModal onClose={() => setShowBriefing(false)} />}

    </div>
  )
}

export default function DashboardPage() {
  return (
    <Suspense>
      <DashboardContent />
    </Suspense>
  )
}
