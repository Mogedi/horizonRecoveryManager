'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import useSWR from 'swr'
import { useBulkVerify } from '@/lib/context/bulk-verify-context'
import type { BulkVerifyDeal } from '@/lib/context/bulk-verify-context'
import { useBulkHubspotCheck } from '@/lib/context/bulk-hubspot-check-context'
import DealPanel from '@/components/DealPanel'
import { relativeDate } from '@/lib/utils/format'

const fetcher = (url: string) => fetch(url).then(r => r.ok ? r.json() : Promise.reject(new Error(r.statusText)))

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

function BulkVerifyPanel() {
  const {
    pending, running, loadError, results, runQueue, activeDealNames,
    currentRpm, cooldownSecsLeft, retryingSet,
    runAll, stop, retryDeal,
  } = useBulkVerify()

  const [selectedDealId, setSelectedDealId] = useState<string | null>(null)

  const runQueueSet = useMemo(() => new Set(runQueue.map(d => d.hubspotId)), [runQueue])
  const runDoneCount = results.filter(r => runQueueSet.has(r.hubspotId)).length
  const totalCount = pending?.length ?? 0
  const matchCount = results.filter(r => r.overallMatch).length
  const issueCount = results.filter(r => !r.overallMatch && !r.error && !r.skipped && r.confidence).length
  const errorCount = results.filter(r => !!r.error).length

  return (
    <>
      <div className="bg-white border border-gray-200 rounded-lg overflow-hidden">
        {/* Header */}
        <div className="px-5 py-3 bg-gray-50 border-b border-gray-200 flex items-center justify-between">
          <div>
            <h2 className="text-sm font-semibold text-gray-700">Document Verification</h2>
            {pending !== null && !running && (
              <p className="text-xs text-gray-400 mt-0.5">
                {totalCount === 0 ? 'All deals verified' : `${totalCount} pending`}
              </p>
            )}
          </div>
          <div className="flex items-center gap-3">
            {running && (
              <span className={`text-xs font-mono ${cooldownSecsLeft > 0 ? 'text-amber-500' : 'text-blue-400'}`}>
                {cooldownSecsLeft > 0 ? `⚠ cooling down ${cooldownSecsLeft}s` : `${currentRpm} RPM`}
              </span>
            )}
            {running ? (
              <>
                <span className="text-xs text-gray-400">{runDoneCount} / {runQueue.length}</span>
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
                {totalCount === 0 ? 'Nothing to verify' : `Verify ${totalCount}`}
              </button>
            )}
          </div>
        </div>

        {loadError && <div className="px-5 py-3 text-sm text-red-600">{loadError}</div>}

        {/* Progress bar */}
        {running && (
          <div className="px-5 py-2 bg-blue-50 border-b border-blue-100">
            <div className="flex items-center gap-2">
              <div className="w-full bg-blue-100 rounded-full h-1.5">
                <div className="bg-blue-500 h-1.5 rounded-full transition-all"
                     style={{ width: `${runQueue.length > 0 ? (runDoneCount / runQueue.length) * 100 : 0}%` }} />
              </div>
              <span className="text-xs text-blue-600 shrink-0">
                {Math.round(runQueue.length > 0 ? (runDoneCount / runQueue.length) * 100 : 0)}%
              </span>
            </div>
            {activeDealNames.length > 0 && (
              <p className="text-xs text-blue-500 mt-1 truncate">
                {activeDealNames.length > 1
                  ? `${activeDealNames.length} in parallel: ${activeDealNames.slice(0, 2).join(', ')}${activeDealNames.length > 2 ? ` +${activeDealNames.length - 2} more` : ''}`
                  : `Verifying: ${activeDealNames[0]}`
                }
              </p>
            )}
          </div>
        )}

        {/* Stats — always visible once there are results */}
        {results.length > 0 && (
          <div className="px-5 py-2 bg-gray-50 border-b border-gray-100 flex gap-4 text-xs">
            <span className="text-green-600">{matchCount} matched</span>
            <span className="text-amber-600">{issueCount} issues</span>
            {errorCount > 0 && <span className="text-red-600">{errorCount} errors</span>}
            <span className="text-gray-400 ml-auto">{results.length} total</span>
          </div>
        )}

        {/* Results list — persistent, survives Stop and page navigation */}
        {results.length > 0 && (
          <div className="divide-y divide-gray-50 max-h-96 overflow-y-auto">
            {results.map(r => {
              const isRetrying = retryingSet.has(r.hubspotId)
              const dealForRetry: BulkVerifyDeal = { hubspotId: r.hubspotId, name: r.name ?? null }
              return (
                <div key={r.hubspotId} className="px-5 py-2 flex items-start gap-2 hover:bg-gray-50 group">
                  <span className={`text-sm shrink-0 mt-0.5 ${isRetrying ? 'text-gray-400' : r.error ? 'text-red-400' : r.skipped ? 'text-gray-300' : r.overallMatch ? 'text-green-500' : 'text-amber-400'}`}>
                    {isRetrying ? '…' : r.error ? '✗' : r.skipped ? '—' : r.overallMatch ? '✓' : '~'}
                  </span>
                  <div className="min-w-0 flex-1">
                    <button
                      onClick={() => setSelectedDealId(r.hubspotId)}
                      className="text-xs font-medium text-gray-700 hover:text-blue-600 hover:underline truncate block text-left w-full"
                    >
                      {r.name ?? r.hubspotId}
                    </button>
                    {isRetrying ? (
                      <p className="text-xs text-gray-400">retrying…</p>
                    ) : r.error ? (
                      <p className="text-xs text-red-500 break-words">{r.error}</p>
                    ) : r.skipped ? (
                      <p className="text-xs text-gray-400">skipped — {r.skipReason ?? 'no Drive files'}</p>
                    ) : (
                      <p className="text-xs text-gray-400">
                        {r.confidence} confidence{r.summary ? ` — ${r.summary.slice(0, 80)}${r.summary.length > 80 ? '…' : ''}` : ''}
                      </p>
                    )}
                  </div>
                  {r.error && !running && (
                    <button
                      onClick={() => retryDeal(dealForRetry)}
                      disabled={isRetrying}
                      className="text-xs text-gray-400 hover:text-blue-600 shrink-0 opacity-0 group-hover:opacity-100 transition-opacity px-2 py-0.5 rounded border border-gray-200 hover:border-blue-200 disabled:opacity-40"
                    >
                      Retry
                    </button>
                  )}
                </div>
              )
            })}
          </div>
        )}
      </div>

      {/* Deal panel overlay — opens inline without navigating away */}
      {selectedDealId && (
        <DealPanel
          hubspotId={selectedDealId}
          onClose={() => setSelectedDealId(null)}
        />
      )}
    </>
  )
}

type GoogleSyncStatus = {
  configured: boolean
  isActive: boolean
  lastSyncedAt: string | null
  totalEmailsStored: number
}

type SyncReport = {
  mode: string
  since: string
  until: string
  messagesFetched: number
  messagesMatched: number
  messagesUnmatched: number
  matchRate: string
  durationMs: number
}

function GoogleSyncPanel() {
  const { data, error, mutate } = useSWR<GoogleSyncStatus>('/api/sync/google/gmail', fetcher)
  const [running, setRunning] = useState(false)
  const [runError, setRunError] = useState<string | null>(null)
  const [lastReport, setLastReport] = useState<SyncReport | null>(null)
  const [confirmingFull, setConfirmingFull] = useState(false)

  const runSync = async (mode: 'sample' | 'full') => {
    setRunning(true)
    setRunError(null)
    setConfirmingFull(false)
    try {
      const res = await fetch('/api/sync/google/gmail', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ mode }),
      })
      const json = await res.json()
      if (!res.ok || !json.ok) throw new Error(json.error ?? 'Sync failed')
      setLastReport(json.report)
      await mutate()
    } catch (e) {
      setRunError(e instanceof Error ? e.message : 'Sync failed')
    } finally {
      setRunning(false)
    }
  }

  const sampleAlreadyRun = (data?.totalEmailsStored ?? 0) > 0
  const fullSyncDone = !!data?.lastSyncedAt

  return (
    <div className="bg-white border border-gray-200 rounded-lg overflow-hidden">
      <div className="px-5 py-3 bg-gray-50 border-b border-gray-200 flex items-center justify-between">
        <div>
          <h2 className="text-sm font-semibold text-gray-700">Google Workspace — Gmail</h2>
          {data && (
            <p className="text-xs text-gray-400 mt-0.5">
              {data.totalEmailsStored} emails stored
              {fullSyncDone ? ` · Full sync ${relativeDate(data.lastSyncedAt!)}` : ' · No full sync yet'}
            </p>
          )}
        </div>
        <div className="flex items-center gap-2">
          {!data && !error && (
            <span className="text-xs text-gray-400">Loading…</span>
          )}
          {error && (
            <span className="text-xs text-red-600">Failed to load status</span>
          )}
          {data && !data.configured && (
            <span className="text-xs text-amber-600">Not configured</span>
          )}
          {data?.configured && (
            <>
              <button
                onClick={() => runSync('sample')}
                disabled={running}
                className="px-3 py-1 text-xs text-gray-700 bg-white border border-gray-300 rounded hover:bg-gray-50 disabled:opacity-40"
              >
                {running ? 'Running…' : 'Sample (7 days)'}
              </button>
              {confirmingFull ? (
                <>
                  <button
                    onClick={() => setConfirmingFull(false)}
                    className="px-3 py-1 text-xs text-gray-500 bg-white border border-gray-300 rounded hover:bg-gray-50"
                  >
                    Cancel
                  </button>
                  <button
                    onClick={() => runSync('full')}
                    disabled={running}
                    className="px-3 py-1 text-xs text-white bg-red-600 rounded hover:bg-red-700 disabled:opacity-40"
                  >
                    Confirm Full Sync
                  </button>
                </>
              ) : (
                <button
                  onClick={() => setConfirmingFull(true)}
                  disabled={running || !sampleAlreadyRun}
                  title={!sampleAlreadyRun ? 'Run a sample sync first' : undefined}
                  className="px-3 py-1 text-xs text-white bg-gray-900 rounded hover:bg-gray-700 disabled:opacity-40"
                >
                  Approve Full Sync
                </button>
              )}
            </>
          )}
        </div>
      </div>

      {confirmingFull && !running && (
        <div className="px-5 py-3 bg-amber-50 border-b border-amber-100 text-xs text-amber-800">
          This will pull all Gmail matching deal contacts from the last 90 days (or since last sync).
          Click <strong>Confirm Full Sync</strong> to proceed.
        </div>
      )}

      {runError && (
        <div className="px-5 py-3 text-xs text-red-600 border-b border-gray-100">{runError}</div>
      )}

      {lastReport && (
        <div className="px-5 py-3 bg-green-50 border-b border-green-100 text-xs text-green-800 space-y-0.5">
          <p className="font-semibold">{lastReport.mode === 'full' ? 'Full' : 'Sample'} sync complete</p>
          <p>{lastReport.messagesFetched} fetched · {lastReport.messagesMatched} matched ({lastReport.matchRate}) · {Math.round(lastReport.durationMs / 1000)}s</p>
          <p className="text-green-600">{new Date(lastReport.since).toLocaleDateString()} – {new Date(lastReport.until).toLocaleDateString()}</p>
        </div>
      )}

      <div className="px-5 py-3 text-xs text-gray-400 space-y-1">
        <p>Sample: last 7 days, max 50 emails. Does not update last-synced timestamp.</p>
        <p>Full sync: last 90 days on first run; since last sync thereafter. Requires sample review first.</p>
      </div>
    </div>
  )
}

function BulkHubspotCheckPanel() {
  const {
    pending, running, results, progress, activeDealName, loadError,
    uncheckedOnly, setUncheckedOnly, reload, runAll, stop,
  } = useBulkHubspotCheck()

  const [selectedDealId, setSelectedDealId] = useState<string | null>(null)

  const totalCount = pending?.length ?? 0

  const linkedCount = results.filter(r => r.filesLinked).length
  const missingCount = results.filter(r => !r.filesLinked && !r.sessionExpired && !r.error && !r.skipped).length
  const expiredCount = results.filter(r => r.sessionExpired).length
  const errorCount = results.filter(r => !!r.error).length
  const skippedCount = results.filter(r => r.skipped).length

  return (
    <>
      <div className="bg-white border border-gray-200 rounded-lg overflow-hidden">
        {/* Header */}
        <div className="px-5 py-3 bg-gray-50 border-b border-gray-200 flex items-center justify-between">
          <div>
            <h2 className="text-sm font-semibold text-gray-700">HubSpot Check</h2>
            {!running && (
              <p className="text-xs text-gray-400 mt-0.5">
                {totalCount === 0 && pending !== null ? 'All deals checked' : totalCount > 0 ? `${totalCount} to check` : 'Click load to begin'}
              </p>
            )}
          </div>
          <div className="flex items-center gap-3">
            <label className="flex items-center gap-1.5 text-xs text-gray-500 cursor-pointer">
              <input
                type="checkbox"
                checked={uncheckedOnly}
                onChange={e => setUncheckedOnly(e.target.checked)}
                disabled={running}
                className="rounded border-gray-300"
              />
              Unchecked only
            </label>
            {!running && pending === null && (
              <button
                onClick={reload}
                className="px-3 py-1 text-xs text-gray-700 bg-white border border-gray-300 rounded hover:bg-gray-50"
              >
                Load
              </button>
            )}
            {running ? (
              <>
                <span className="text-xs text-gray-400">{progress} / {totalCount}</span>
                <button onClick={stop}
                  className="px-3 py-1 text-xs text-white bg-red-500 rounded hover:bg-red-600">
                  Stop
                </button>
              </>
            ) : pending !== null && (
              <button
                onClick={runAll}
                disabled={totalCount === 0 || !!loadError}
                className="px-3 py-1 text-xs text-white bg-gray-900 rounded hover:bg-gray-700 disabled:opacity-40"
              >
                {totalCount === 0 ? 'All checked' : `Run ${totalCount}`}
              </button>
            )}
          </div>
        </div>

        {loadError && <div className="px-5 py-3 text-sm text-red-600">{loadError}</div>}

        {/* Progress bar */}
        {running && (
          <div className="px-5 py-2 bg-blue-50 border-b border-blue-100">
            <div className="flex items-center gap-2">
              <div className="w-full bg-blue-100 rounded-full h-1.5">
                <div className="bg-blue-500 h-1.5 rounded-full transition-all"
                     style={{ width: `${totalCount > 0 ? (progress / totalCount) * 100 : 0}%` }} />
              </div>
              <span className="text-xs text-blue-600 shrink-0">
                {Math.round(totalCount > 0 ? (progress / totalCount) * 100 : 0)}%
              </span>
            </div>
            {activeDealName && (
              <p className="text-xs text-blue-500 mt-1 truncate">Checking: {activeDealName}</p>
            )}
            <p className="text-xs text-gray-400 mt-0.5">8–15s between deals to avoid bot detection</p>
          </div>
        )}

        {/* Stats */}
        {results.length > 0 && (
          <div className="px-5 py-2 bg-gray-50 border-b border-gray-100 flex gap-4 text-xs">
            <span className="text-green-600">{linkedCount} linked</span>
            {missingCount > 0 && <span className="text-red-500">{missingCount} not linked</span>}
            {expiredCount > 0 && <span className="text-gray-400">{expiredCount} expired</span>}
            {skippedCount > 0 && <span className="text-gray-400">{skippedCount} skipped</span>}
            {errorCount > 0 && <span className="text-red-600">{errorCount} errors</span>}
            <span className="text-gray-400 ml-auto">{results.length} total</span>
          </div>
        )}

        {/* Results */}
        {results.length > 0 && (
          <div className="divide-y divide-gray-50 max-h-96 overflow-y-auto">
            {results.map(r => (
              <div key={r.hubspotId} className="px-5 py-2 flex items-start gap-2 hover:bg-gray-50">
                <span className={`text-sm shrink-0 mt-0.5 ${
                  r.error ? 'text-red-400'
                  : r.skipped ? 'text-gray-300'
                  : r.sessionExpired ? 'text-gray-300'
                  : r.filesLinked ? 'text-green-500'
                  : 'text-red-400'
                }`}>
                  {r.error ? '✗' : r.skipped ? '—' : r.sessionExpired ? '⚠' : r.filesLinked ? '✓' : '✗'}
                </span>
                <div className="min-w-0 flex-1">
                  <button
                    onClick={() => setSelectedDealId(r.hubspotId)}
                    className="text-xs font-medium text-gray-700 hover:text-blue-600 hover:underline truncate block text-left w-full"
                  >
                    {r.name ?? r.hubspotId}
                  </button>
                  <p className="text-xs text-gray-400">
                    {r.error ? r.error
                      : r.skipped ? `${r.skipCode ? `${r.skipCode}: ` : ''}${r.skipReason ?? 'skipped'}`
                      : r.sessionExpired ? 'session expired — re-capture cookies'
                      : r.filesLinked ? 'linked in HubSpot'
                      : 'not linked in HubSpot'}
                    {r.checkedAt && !r.error && !r.skipped && (
                      <span className="ml-1">· {relativeDate(r.checkedAt)}</span>
                    )}
                  </p>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {selectedDealId && (
        <DealPanel
          hubspotId={selectedDealId}
          onClose={() => setSelectedDealId(null)}
        />
      )}
    </>
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

          {/* Bulk HubSpot screenshot check */}
          <BulkHubspotCheckPanel />

          {/* Google Workspace sync */}
          <GoogleSyncPanel />
        </div>
      )}
    </div>
  )
}
