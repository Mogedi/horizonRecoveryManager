'use client'

import { useEffect, useState, useCallback } from 'react'

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

function relativeTime(dateStr: string): string {
  const diffMs = Date.now() - new Date(dateStr).getTime()
  const mins = Math.floor(diffMs / 60_000)
  if (mins < 1) return 'just now'
  if (mins < 60) return `${mins}m ago`
  const hrs = Math.floor(mins / 60)
  if (hrs < 24) return `${hrs}h ago`
  const days = Math.floor(hrs / 24)
  return `${days}d ago`
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
                  {relativeTime(row.startedAt)}
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

export default function SettingsPage() {
  const [data, setData] = useState<SettingsResponse | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const fetchSettings = useCallback(async () => {
    try {
      const res = await fetch('/api/settings')
      if (!res.ok) throw new Error(`${res.status}`)
      setData(await res.json())
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to load settings')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => { fetchSettings() }, [fetchSettings])

  const handleSave = useCallback(async (updates: { key: string; value: number }[]) => {
    const res = await fetch('/api/settings', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ settings: updates }),
    })
    const json = await res.json()
    if (!res.ok) throw new Error(json.error ?? 'Save failed')
    setData(prev => prev ? { ...prev, settings: json.settings } : prev)
  }, [])

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
          {error}
        </div>
      )}

      {loading && (
        <div className="space-y-3">
          {[0, 1, 2].map(i => (
            <div key={i} className="h-32 bg-gray-100 rounded-lg animate-pulse" />
          ))}
        </div>
      )}

      {!loading && (
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
        </div>
      )}
    </div>
  )
}
