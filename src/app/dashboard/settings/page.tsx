'use client'

import { useEffect, useState, useCallback, useRef } from 'react'
import useSWR from 'swr'

const fetcher = (url: string) => fetch(url).then(r => r.ok ? r.json() : Promise.reject(new Error(r.statusText)))
import { relativeDate } from '@/lib/utils/format'

type SettingItem = {
  key: string
  value: number
  label: string
  group: string
  unit: string
}

type SyncLogRow = {
  id: number
  syncType: string | null
  apiCallsMade: number | null
  dealsSynced: number | null
  startedAt: string
  completedAt: string | null
  error: string | null
}

type SettingsResponse = {
  settings: SettingItem[]
  recentSyncs: SyncLogRow[]
}

const GROUP_ORDER = ['Stage Staleness', 'Activity Rules', 'AI Settings']

const SYNC_TYPE_LABELS: Record<string, string> = {
  layer1_all: 'Layer 1 — All deals',
  layer1: 'Layer 1 — All deals',
  layer2_deal: 'Layer 2 — Single deal',
  manual: 'Manual',
}


function ThresholdGroup({
  group,
  items,
  onSave,
}: {
  group: string
  items: SettingItem[]
  onSave: (updates: { key: string; value: number }[]) => Promise<void>
}) {
  const [values, setValues] = useState<Record<string, string>>(() =>
    Object.fromEntries(items.map(i => [i.key, String(i.value)]))
  )
  const [saving, setSaving] = useState(false)
  const [saved, setSaved] = useState(false)
  const [error, setError] = useState<string | null>(null)

  // Sync if parent data changes (e.g., on initial load)
  useEffect(() => {
    setValues(Object.fromEntries(items.map(i => [i.key, String(i.value)])))
  }, [items])

  const isDirty = items.some(i => String(i.value) !== values[i.key])

  const save = async () => {
    setSaving(true)
    setSaved(false)
    setError(null)
    const updates = items.map(i => ({
      key: i.key,
      value: parseInt(values[i.key], 10),
    }))
    const invalid = updates.find(u => isNaN(u.value) || u.value <= 0)
    if (invalid) {
      setError('All values must be positive whole numbers.')
      setSaving(false)
      return
    }
    try {
      await onSave(updates)
      setSaved(true)
      setTimeout(() => setSaved(false), 2500)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Save failed')
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="bg-white border border-gray-200 rounded-lg overflow-hidden">
      <div className="px-5 py-3 bg-gray-50 border-b border-gray-200 flex items-center justify-between">
        <h2 className="text-sm font-semibold text-gray-700">{group}</h2>
        <div className="flex items-center gap-3">
          {saved && (
            <span className="text-xs text-green-600">Saved</span>
          )}
          {error && (
            <span className="text-xs text-red-600">{error}</span>
          )}
          <button
            onClick={save}
            disabled={saving || !isDirty}
            className="px-3 py-1 text-xs text-white bg-gray-900 rounded hover:bg-gray-700 disabled:opacity-40"
          >
            {saving ? 'Saving…' : 'Save'}
          </button>
        </div>
      </div>
      <div className="divide-y divide-gray-100">
        {items.map(item => (
          <div key={item.key} className="flex items-center justify-between px-5 py-3">
            <label className="text-sm text-gray-700">{item.label}</label>
            <div className="flex items-center gap-2">
              <input
                type="number"
                min={1}
                max={365}
                value={values[item.key]}
                onChange={e => setValues(v => ({ ...v, [item.key]: e.target.value }))}
                className="w-16 px-2 py-1 text-sm text-right border border-gray-300 rounded focus:outline-none focus:ring-1 focus:ring-gray-400"
              />
              <span className="text-xs text-gray-400 w-24">{item.unit}</span>
            </div>
          </div>
        ))}
      </div>
    </div>
  )
}

function SyncLog({ rows }: { rows: SyncLogRow[] }) {
  if (rows.length === 0) {
    return (
      <div className="text-sm text-gray-400 py-4">
        No sync history yet. Run a sync from the dashboard.
      </div>
    )
  }

  return (
    <div className="bg-white border border-gray-200 rounded-lg overflow-hidden">
      <div className="px-5 py-3 bg-gray-50 border-b border-gray-200">
        <h2 className="text-sm font-semibold text-gray-700">Sync Log — Last 10</h2>
      </div>
      <table className="w-full text-sm">
        <thead>
          <tr className="border-b border-gray-100 text-left">
            <th className="px-5 py-2 text-xs font-medium text-gray-400">Type</th>
            <th className="px-5 py-2 text-xs font-medium text-gray-400">Started</th>
            <th className="px-5 py-2 text-xs font-medium text-gray-400 text-right">Deals</th>
            <th className="px-5 py-2 text-xs font-medium text-gray-400 text-right">API calls</th>
            <th className="px-5 py-2 text-xs font-medium text-gray-400 text-right">Duration</th>
            <th className="px-5 py-2 text-xs font-medium text-gray-400">Status</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-gray-50">
          {rows.map(row => {
            const durationMs =
              row.completedAt && row.startedAt
                ? new Date(row.completedAt).getTime() - new Date(row.startedAt).getTime()
                : null
            const durationStr = durationMs != null
              ? durationMs < 1000 ? `${durationMs}ms` : `${(durationMs / 1000).toFixed(1)}s`
              : '—'

            return (
              <tr key={row.id} className="hover:bg-gray-50">
                <td className="px-5 py-2.5 text-gray-600">
                  {SYNC_TYPE_LABELS[row.syncType ?? ''] ?? row.syncType ?? '—'}
                </td>
                <td className="px-5 py-2.5 text-gray-500">
                  {relativeDate(row.startedAt)}
                </td>
                <td className="px-5 py-2.5 text-right text-gray-500">
                  {row.dealsSynced ?? '—'}
                </td>
                <td className="px-5 py-2.5 text-right text-gray-500">
                  {row.apiCallsMade ?? '—'}
                </td>
                <td className="px-5 py-2.5 text-right text-gray-500">
                  {durationStr}
                </td>
                <td className="px-5 py-2.5">
                  {row.error ? (
                    <span className="text-xs text-red-600" title={row.error}>
                      Error
                    </span>
                  ) : row.completedAt ? (
                    <span className="text-xs text-green-600">Done</span>
                  ) : (
                    <span className="text-xs text-gray-400">Running…</span>
                  )}
                </td>
              </tr>
            )
          })}
        </tbody>
      </table>
    </div>
  )
}

type BulkVerifyDeal = { hubspotId: string; name: string | null }
type BulkVerifyResult = {
  hubspotId: string
  name?: string | null
  overallMatch?: boolean
  confidence?: string
  summary?: string
  error?: string
  skipped?: boolean
}

function BulkVerifyPanel() {
  const [pending, setPending] = useState<BulkVerifyDeal[] | null>(null)
  const [running, setRunning] = useState(false)
  const [results, setResults] = useState<BulkVerifyResult[]>([])
  const [loadError, setLoadError] = useState<string | null>(null)
  const abortRef = useRef(false)

  const loadPending = useCallback(async () => {
    setLoadError(null)
    try {
      const res = await fetch('/api/admin/verify-all')
      if (!res.ok) throw new Error(`${res.status}`)
      const json = await res.json() as { count: number; deals: BulkVerifyDeal[] }
      setPending(json.deals)
    } catch (e) {
      setLoadError(e instanceof Error ? e.message : 'Failed to load')
    }
  }, [])

  useEffect(() => { loadPending() }, [loadPending])

  const runAll = async () => {
    if (!pending || pending.length === 0) return
    abortRef.current = false
    setRunning(true)
    setResults([])

    for (const deal of pending) {
      if (abortRef.current) break
      try {
        const res = await fetch('/api/admin/verify-all', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ hubspotId: deal.hubspotId }),
        })
        const json = await res.json() as BulkVerifyResult
        setResults(prev => [...prev, { ...json, name: json.name ?? deal.name }])
      } catch (e) {
        setResults(prev => [...prev, {
          hubspotId: deal.hubspotId,
          name: deal.name,
          error: e instanceof Error ? e.message : 'Failed',
        }])
      }
    }

    setRunning(false)
    loadPending()
  }

  const stop = () => { abortRef.current = true }

  const doneCount = results.length
  const totalCount = pending?.length ?? 0
  const matchCount = results.filter(r => r.overallMatch).length
  const errorCount = results.filter(r => r.error).length

  return (
    <div className="bg-white border border-gray-200 rounded-lg overflow-hidden">
      <div className="px-5 py-3 bg-gray-50 border-b border-gray-200 flex items-center justify-between">
        <div>
          <h2 className="text-sm font-semibold text-gray-700">Document Verification</h2>
          {pending !== null && !running && (
            <p className="text-xs text-gray-400 mt-0.5">
              {totalCount === 0 ? 'All deals verified' : `${totalCount} deal${totalCount !== 1 ? 's' : ''} pending verification`}
            </p>
          )}
        </div>
        <div className="flex items-center gap-2">
          {running ? (
            <>
              <span className="text-xs text-gray-400">{doneCount} / {totalCount}</span>
              <button onClick={stop}
                className="px-3 py-1 text-xs text-white bg-red-500 rounded hover:bg-red-600">
                Stop
              </button>
            </>
          ) : (
            <button
              onClick={runAll}
              disabled={!pending || totalCount === 0 || !!loadError}
              className="px-3 py-1 text-xs text-white bg-gray-900 rounded hover:bg-gray-700 disabled:opacity-40"
            >
              {totalCount === 0 ? 'Nothing to verify' : `Verify ${totalCount} deal${totalCount !== 1 ? 's' : ''}`}
            </button>
          )}
        </div>
      </div>

      {loadError && (
        <div className="px-5 py-3 text-sm text-red-600">{loadError}</div>
      )}

      {running && doneCount < totalCount && (
        <div className="px-5 py-2 bg-blue-50 border-b border-blue-100">
          <div className="flex items-center gap-2">
            <div className="w-full bg-blue-100 rounded-full h-1.5">
              <div className="bg-blue-500 h-1.5 rounded-full transition-all"
                   style={{ width: `${totalCount > 0 ? (doneCount / totalCount) * 100 : 0}%` }} />
            </div>
            <span className="text-xs text-blue-600 shrink-0">{Math.round(totalCount > 0 ? (doneCount / totalCount) * 100 : 0)}%</span>
          </div>
          <p className="text-xs text-blue-600 mt-1">
            Verifying: {pending?.[doneCount]?.name ?? '…'}
          </p>
        </div>
      )}

      {results.length > 0 && (
        <>
          {(running || doneCount === totalCount) && doneCount > 0 && (
            <div className="px-5 py-2 bg-gray-50 border-b border-gray-100 flex gap-4 text-xs text-gray-500">
              <span className="text-green-600">{matchCount} matched</span>
              <span className="text-amber-600">{doneCount - matchCount - errorCount} issues</span>
              {errorCount > 0 && <span className="text-red-600">{errorCount} errors</span>}
            </div>
          )}
          <div className="divide-y divide-gray-50 max-h-72 overflow-y-auto">
            {results.map(r => (
              <div key={r.hubspotId} className="px-5 py-2 flex items-start gap-2">
                <span className={`text-sm shrink-0 mt-0.5 ${r.error ? 'text-red-400' : r.skipped ? 'text-gray-300' : r.overallMatch ? 'text-green-500' : 'text-amber-400'}`}>
                  {r.error ? '✗' : r.skipped ? '—' : r.overallMatch ? '✓' : '~'}
                </span>
                <div className="min-w-0">
                  <p className="text-xs font-medium text-gray-700 truncate">{r.name ?? r.hubspotId}</p>
                  {r.error ? (
                    <p className="text-xs text-red-500">{r.error}</p>
                  ) : r.skipped ? (
                    <p className="text-xs text-gray-400">skipped</p>
                  ) : (
                    <p className="text-xs text-gray-400">
                      {r.confidence} confidence{r.summary ? ` — ${r.summary.slice(0, 80)}${r.summary.length > 80 ? '…' : ''}` : ''}
                    </p>
                  )}
                </div>
              </div>
            ))}
          </div>
        </>
      )}
    </div>
  )
}

export default function SettingsPage() {
  const { data, error, isLoading, mutate } = useSWR<SettingsResponse>('/api/settings', fetcher)

  const handleSave = useCallback(async (updates: { key: string; value: number }[]) => {
    const res = await fetch('/api/settings', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ settings: updates }),
    })
    const json = await res.json()
    if (!res.ok) throw new Error(json.error ?? 'Save failed')
    await mutate({ ...data!, settings: json.settings }, false)
  }, [data, mutate])

  const groups = data
    ? GROUP_ORDER.map(group => ({
        group,
        items: data.settings.filter(s => s.group === group),
      })).filter(g => g.items.length > 0)
    : []

  return (
    <div className="p-8 max-w-2xl mx-auto">
      <div className="mb-6">
        <h1 className="text-2xl font-semibold text-gray-900">Settings</h1>
        <p className="text-sm text-gray-500 mt-1">
          Staleness thresholds take effect immediately on the next dashboard refresh.
        </p>
      </div>

      {error && (
        <div className="mb-4 px-4 py-3 bg-red-50 border border-red-200 rounded-lg text-sm text-red-700">
          {error.message ?? 'Failed to load settings'}
        </div>
      )}

      {isLoading && (
        <div className="space-y-3">
          {[0, 1, 2].map(i => (
            <div key={i} className="h-32 bg-gray-100 rounded-lg animate-pulse" />
          ))}
        </div>
      )}

      {!isLoading && (
        <div className="space-y-4">
          {groups.map(({ group, items }) => (
            <ThresholdGroup
              key={group}
              group={group}
              items={items}
              onSave={handleSave}
            />
          ))}

          {/* Sync schedule note */}
          <div className="px-4 py-3 bg-gray-50 border border-gray-200 rounded-lg text-sm text-gray-500">
            Sync schedule runs 4× daily (6am, 12pm, 6pm, 12am ET). To change the schedule, update{' '}
            <code className="text-xs bg-gray-100 px-1 rounded">vercel.json</code> and redeploy.
          </div>

          {/* Sync log */}
          <SyncLog rows={data?.recentSyncs ?? []} />

          {/* Bulk document verification */}
          <BulkVerifyPanel />
        </div>
      )}
    </div>
  )
}
