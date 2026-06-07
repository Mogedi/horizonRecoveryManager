'use client'

import { useEffect, useState, useCallback } from 'react'

// ─── Types ────────────────────────────────────────────────────────────────────

type Activity = {
  id: number
  type: string
  body: string | null
  authorName: string | null
  authorOwnerId: string | null
  direction: string | null
  timestamp: string | null
  metadata: unknown
}

type Contact = {
  id: number
  name: string | null
  contactType: string | null
  ownershipStatus: string | null
  isDeceased: boolean
  doNotContact: boolean
  phoneNumbers: string[]
  emailList: string[]
}

type Snooze = {
  id: number
  category: string
  freeformNote: string | null
  snoozeUntil: string
  createdAt: string
}

type SnoozeHistoryItem = Snooze & { wokeAt: string | null }

type DealDetail = {
  hubspotId: string
  name: string | null
  stage: string | null
  stageName: string | null
  ownerName: string | null
  amount: number | null
  hubspotUrl: string | null
  propertyAddress: string | null
  county: string | null
  parcelId: string | null
  taxSaleDate: string | null
  contactCount: number
  lastActivityDate: string | null
  syncedAt: string
}

type PanelData = {
  deal: DealDetail
  activities: Activity[]
  contacts: Contact[]
  snooze: Snooze | null
  snoozeHistory: SnoozeHistoryItem[]
  layer2SyncedAt: string | null
}

// ─── Constants ────────────────────────────────────────────────────────────────

const SNOOZE_CATEGORY_LABELS: Record<string, string> = {
  waiting_on_attorney: 'Waiting on Attorney',
  waiting_on_county: 'Waiting on County',
  waiting_on_client: 'Waiting on Client',
  waiting_on_documents: 'Waiting on Documents',
  waiting_on_probate: 'Waiting on Probate',
  filed_normal_wait: 'Filed — Normal Wait',
  other: 'Other',
}

const ACTIVITY_ICONS: Record<string, string> = {
  note: '📝',
  email: '✉️',
  call: '📞',
  task: '✓',
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

function fmt(dateStr: string | null | undefined, opts?: Intl.DateTimeFormatOptions): string {
  if (!dateStr) return '—'
  return new Date(dateStr).toLocaleDateString('en-US', {
    timeZone: 'America/New_York',
    month: 'short',
    day: 'numeric',
    year: 'numeric',
    ...opts,
  })
}

function relTime(dateStr: string | null): string {
  if (!dateStr) return '—'
  const diffMs = Date.now() - new Date(dateStr).getTime()
  const days = Math.floor(diffMs / 86_400_000)
  if (days === 0) return 'today'
  if (days === 1) return 'yesterday'
  if (days < 30) return `${days}d ago`
  return `${Math.floor(days / 30)}mo ago`
}

function formatAmount(n: number | null): string {
  if (n === null) return ''
  return '$' + Math.round(n).toLocaleString('en-US')
}

function tomorrowISO(): string {
  const d = new Date()
  d.setDate(d.getDate() + 1)
  return d.toISOString().slice(0, 10)
}

// ─── Sub-components ───────────────────────────────────────────────────────────

function SectionHeader({ title }: { title: string }) {
  return (
    <h3 className="text-xs font-semibold text-gray-400 uppercase tracking-wider mb-2 mt-6">
      {title}
    </h3>
  )
}

function ActivityItem({ activity }: { activity: Activity }) {
  const icon = ACTIVITY_ICONS[activity.type] ?? '·'
  const label = activity.type.charAt(0).toUpperCase() + activity.type.slice(1)
  const who = activity.authorName ?? activity.authorOwnerId ?? 'Unknown'
  const direction = activity.direction === 'inbound' ? ' · Inbound' : activity.direction === 'outbound' ? ' · Outbound' : ''

  return (
    <div className="py-3 border-b border-gray-100 last:border-0">
      <div className="flex items-center gap-1.5 text-xs text-gray-400 mb-1">
        <span>{icon}</span>
        <span className="font-medium text-gray-500">{label}{direction}</span>
        <span>·</span>
        <span>{who}</span>
        <span>·</span>
        <span>{fmt(activity.timestamp)}</span>
      </div>
      {activity.body && (
        <p className="text-sm text-gray-700 whitespace-pre-wrap leading-relaxed">
          {activity.body.length > 400 ? activity.body.slice(0, 400) + '…' : activity.body}
        </p>
      )}
    </div>
  )
}

function ContactItem({ contact }: { contact: Contact }) {
  return (
    <div className="py-2.5 border-b border-gray-100 last:border-0">
      <div className="flex items-start justify-between gap-2">
        <div>
          <span className="font-medium text-gray-900 text-sm">{contact.name ?? 'Unknown'}</span>
          {contact.isDeceased && (
            <span className="ml-2 text-xs text-gray-400">Deceased</span>
          )}
          {contact.doNotContact && (
            <span className="ml-2 text-xs bg-red-50 text-red-600 px-1.5 py-0.5 rounded">DNC</span>
          )}
        </div>
        <span className="text-xs text-gray-400 shrink-0">
          {contact.contactType ?? '—'}
          {contact.ownershipStatus ? ` · ${contact.ownershipStatus}` : ''}
        </span>
      </div>
      {contact.phoneNumbers.length > 0 && (
        <p className="text-xs text-gray-600 mt-0.5">{contact.phoneNumbers.join(' · ')}</p>
      )}
      {contact.emailList.length > 0 && (
        <p className="text-xs text-gray-500 mt-0.5">{contact.emailList.join(' · ')}</p>
      )}
      {contact.phoneNumbers.length === 0 && contact.emailList.length === 0 && (
        <p className="text-xs text-gray-400 mt-0.5">No contact info</p>
      )}
    </div>
  )
}

// ─── Snooze Modal ─────────────────────────────────────────────────────────────

function SnoozeModal({
  hubspotId,
  onClose,
  onSuccess,
}: {
  hubspotId: string
  onClose: () => void
  onSuccess: () => void
}) {
  const [category, setCategory] = useState('waiting_on_attorney')
  const [snoozeUntil, setSnoozeUntil] = useState(tomorrowISO())
  const [note, setNote] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const submit = async () => {
    setSubmitting(true)
    setError(null)
    try {
      const res = await fetch(`/api/deals/${hubspotId}/snooze`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ category, snoozeUntil, freeformNote: note || undefined }),
      })
      if (!res.ok) {
        const body = await res.json().catch(() => ({}))
        throw new Error(body?.error ?? `Failed: ${res.status}`)
      }
      onSuccess()
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to snooze')
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <div className="fixed inset-0 z-60 flex items-center justify-center">
      <div className="absolute inset-0 bg-black/30" onClick={onClose} />
      <div className="relative bg-white rounded-xl shadow-xl p-6 w-full max-w-sm mx-4 z-10">
        <h2 className="text-base font-semibold text-gray-900 mb-4">Snooze this deal</h2>

        <div className="space-y-3">
          <div>
            <label className="block text-xs text-gray-500 mb-1">Reason</label>
            <select
              value={category}
              onChange={e => setCategory(e.target.value)}
              className="w-full text-sm border border-gray-300 rounded-md px-3 py-2 text-gray-900 focus:outline-none focus:ring-1 focus:ring-gray-400"
            >
              {Object.entries(SNOOZE_CATEGORY_LABELS).map(([val, label]) => (
                <option key={val} value={val}>{label}</option>
              ))}
            </select>
          </div>

          <div>
            <label className="block text-xs text-gray-500 mb-1">Wake on</label>
            <input
              type="date"
              value={snoozeUntil}
              min={tomorrowISO()}
              onChange={e => setSnoozeUntil(e.target.value)}
              className="w-full text-sm border border-gray-300 rounded-md px-3 py-2 text-gray-900 focus:outline-none focus:ring-1 focus:ring-gray-400"
            />
          </div>

          <div>
            <label className="block text-xs text-gray-500 mb-1">Note (optional)</label>
            <textarea
              value={note}
              onChange={e => setNote(e.target.value)}
              rows={2}
              placeholder="e.g. Filed with county 6/5, typical 90-day wait"
              className="w-full text-sm border border-gray-300 rounded-md px-3 py-2 text-gray-700 resize-none focus:outline-none focus:ring-1 focus:ring-gray-400"
            />
          </div>
        </div>

        {error && (
          <p className="mt-3 text-xs text-red-600">{error}</p>
        )}

        <div className="flex items-center gap-2 mt-4">
          <button
            onClick={submit}
            disabled={submitting}
            className="flex-1 py-2 text-sm font-medium text-white bg-gray-900 rounded-md hover:bg-gray-700 disabled:opacity-40"
          >
            {submitting ? 'Saving…' : 'Snooze'}
          </button>
          <button
            onClick={onClose}
            className="flex-1 py-2 text-sm text-gray-600 bg-white border border-gray-300 rounded-md hover:bg-gray-50"
          >
            Cancel
          </button>
        </div>
      </div>
    </div>
  )
}

// ─── Main Panel ───────────────────────────────────────────────────────────────

export default function DealPanel({
  hubspotId,
  onClose,
}: {
  hubspotId: string
  onClose: () => void
}) {
  const [data, setData] = useState<PanelData | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const [layer2State, setLayer2State] = useState<'idle' | 'confirming' | 'loading' | 'done'>('idle')
  const [layer2CallMsg, setLayer2CallMsg] = useState<string | null>(null)
  const [layer2Error, setLayer2Error] = useState<string | null>(null)

  const [showSnooze, setShowSnooze] = useState(false)
  const [snoozeRemoving, setSnoozeRemoving] = useState(false)
  const [showSnoozeHistory, setShowSnoozeHistory] = useState(false)

  const fetchDeal = useCallback(async () => {
    setError(null)
    try {
      const res = await fetch(`/api/deals/${hubspotId}`)
      if (!res.ok) throw new Error(`${res.status} ${res.statusText}`)
      const json = await res.json()
      setData(json)
      if (json.layer2SyncedAt) setLayer2State('done')
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to load deal')
    } finally {
      setLoading(false)
    }
  }, [hubspotId])

  useEffect(() => { fetchDeal() }, [fetchDeal])

  const startLayer2 = async () => {
    setLayer2State('confirming')
    const res = await fetch(`/api/sync/layer2/${hubspotId}`)
    const json = await res.json()
    setLayer2CallMsg(json.callRangeMessage ?? '5–50+ API calls')
  }

  const confirmLayer2 = async () => {
    setLayer2State('loading')
    setLayer2Error(null)
    try {
      const res = await fetch(`/api/sync/layer2/${hubspotId}`, { method: 'POST' })
      if (!res.ok) {
        const body = await res.json().catch(() => ({}))
        throw new Error(body?.error ?? `Sync failed: ${res.status}`)
      }
      await fetchDeal()
      setLayer2State('done')
    } catch (e) {
      setLayer2Error(e instanceof Error ? e.message : 'Layer 2 sync failed')
      setLayer2State('idle')
    }
  }

  const removeSnooze = async () => {
    setSnoozeRemoving(true)
    try {
      await fetch(`/api/deals/${hubspotId}/snooze`, { method: 'DELETE' })
      await fetchDeal()
    } finally {
      setSnoozeRemoving(false)
    }
  }

  const { deal, activities, contacts, snooze, snoozeHistory } = data ?? {}

  return (
    <>
      {/* Backdrop */}
      <div
        className="fixed inset-0 z-40 bg-black/20"
        onClick={onClose}
      />

      {/* Panel */}
      <div className="fixed right-0 top-0 h-full z-50 w-full max-w-xl bg-white shadow-2xl flex flex-col overflow-hidden">
        {/* Header */}
        <div className="px-6 py-4 border-b border-gray-200 shrink-0">
          <div className="flex items-start justify-between gap-3">
            <button onClick={onClose} className="text-xs text-gray-400 hover:text-gray-600 mt-0.5 shrink-0">
              ✕ Close
            </button>
            {deal?.hubspotUrl && (
              <a
                href={deal.hubspotUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="text-xs text-blue-600 hover:underline shrink-0"
              >
                Open in HubSpot ↗
              </a>
            )}
          </div>

          {loading && <div className="mt-3 h-5 w-48 bg-gray-100 rounded animate-pulse" />}
          {!loading && deal && (
            <div className="mt-2">
              <h2 className="font-semibold text-gray-900 text-base leading-snug">{deal.name ?? 'Unnamed deal'}</h2>
              <p className="text-xs text-gray-500 mt-1">
                {deal.stageName ?? deal.stage ?? '—'}
                {deal.ownerName ? ` · ${deal.ownerName}` : ''}
                {deal.amount ? ` · ${formatAmount(deal.amount)}` : ''}
              </p>
              {deal.propertyAddress && (
                <p className="text-xs text-gray-500 mt-0.5">{deal.propertyAddress}</p>
              )}
              {(deal.county || deal.parcelId || deal.taxSaleDate) && (
                <p className="text-xs text-gray-400 mt-0.5">
                  {[
                    deal.county,
                    deal.parcelId,
                    deal.taxSaleDate ? `Tax sale ${fmt(deal.taxSaleDate, { month: 'short', day: 'numeric', year: 'numeric' })}` : null,
                  ].filter(Boolean).join(' · ')}
                </p>
              )}
            </div>
          )}
        </div>

        {/* Scrollable body */}
        <div className="flex-1 overflow-y-auto px-6 py-4">
          {error && (
            <div className="mb-4 px-4 py-3 bg-red-50 border border-red-200 rounded-lg text-sm text-red-700">
              {error}
            </div>
          )}

          {!loading && deal && (
            <>
              {/* Snooze status + actions */}
              <div className="flex items-center gap-2 mb-4">
                {snooze ? (
                  <div className="flex-1 flex items-center gap-2 px-3 py-2 bg-gray-50 border border-gray-200 rounded-lg">
                    <span className="text-xs text-gray-500 flex-1">
                      Snoozed until {fmt(snooze.snoozeUntil)} · {SNOOZE_CATEGORY_LABELS[snooze.category] ?? snooze.category}
                      {snooze.freeformNote ? ` — ${snooze.freeformNote}` : ''}
                    </span>
                    <button
                      onClick={removeSnooze}
                      disabled={snoozeRemoving}
                      className="text-xs text-gray-400 hover:text-red-600 disabled:opacity-40 shrink-0"
                    >
                      {snoozeRemoving ? '…' : 'Remove'}
                    </button>
                  </div>
                ) : (
                  <button
                    onClick={() => setShowSnooze(true)}
                    className="px-3 py-1.5 text-sm text-gray-700 bg-white border border-gray-300 rounded-md hover:bg-gray-50"
                  >
                    Snooze
                  </button>
                )}
              </div>

              {/* Layer 2 pull */}
              {layer2State === 'idle' && (
                <button
                  onClick={startLayer2}
                  className="w-full py-2 text-sm text-gray-700 bg-white border border-gray-300 rounded-md hover:bg-gray-50 mb-4"
                >
                  Load Full Detail
                </button>
              )}
              {layer2State === 'confirming' && (
                <div className="mb-4 px-4 py-3 bg-yellow-50 border border-yellow-200 rounded-lg">
                  <p className="text-sm text-yellow-800 mb-2">{layer2CallMsg}</p>
                  <div className="flex gap-2">
                    <button
                      onClick={confirmLayer2}
                      className="px-3 py-1.5 text-sm text-white bg-gray-900 rounded-md hover:bg-gray-700"
                    >
                      Confirm — Load
                    </button>
                    <button
                      onClick={() => setLayer2State('idle')}
                      className="px-3 py-1.5 text-sm text-gray-600 bg-white border border-gray-300 rounded-md hover:bg-gray-50"
                    >
                      Cancel
                    </button>
                  </div>
                </div>
              )}
              {layer2State === 'loading' && (
                <div className="mb-4 px-4 py-3 bg-gray-50 border border-gray-200 rounded-lg text-sm text-gray-500 animate-pulse">
                  Loading full detail from HubSpot…
                </div>
              )}
              {layer2Error && (
                <div className="mb-4 px-4 py-3 bg-red-50 border border-red-200 rounded-lg text-sm text-red-700">
                  {layer2Error}
                </div>
              )}

              {/* Contacts */}
              <SectionHeader title={
                layer2State === 'done'
                  ? `Contacts (${contacts?.length ?? 0})`
                  : `Contacts (${deal.contactCount > 0 ? `${deal.contactCount} — load full detail for names` : '0'})`
              } />
              {contacts && contacts.length > 0 ? (
                contacts.map(c => <ContactItem key={c.id} contact={c} />)
              ) : (
                <p className="text-sm text-gray-400">
                  {layer2State === 'done' ? 'No contacts linked' : 'Load full detail to see contacts'}
                </p>
              )}

              {/* Activity timeline */}
              <SectionHeader title={`Activity (${activities?.length ?? 0})`} />
              {activities && activities.length > 0 ? (
                activities.map(a => <ActivityItem key={a.id} activity={a} />)
              ) : (
                <p className="text-sm text-gray-400">
                  {layer2State === 'done' ? 'No activity recorded' : 'Load full detail to see activity timeline'}
                </p>
              )}

              {/* Snooze history */}
              {snoozeHistory && snoozeHistory.length > 0 && (
                <>
                  <button
                    onClick={() => setShowSnoozeHistory(v => !v)}
                    className="mt-6 text-xs text-gray-400 hover:text-gray-600"
                  >
                    {showSnoozeHistory ? '▾' : '▸'} Snooze history ({snoozeHistory.length})
                  </button>
                  {showSnoozeHistory && (
                    <div className="mt-2 space-y-1">
                      {snoozeHistory.map(s => (
                        <div key={s.id} className="text-xs text-gray-400 py-1">
                          {SNOOZE_CATEGORY_LABELS[s.category] ?? s.category} · until {fmt(s.snoozeUntil)}
                          {s.wokeAt ? ` · removed ${relTime(s.wokeAt)}` : ' · active'}
                          {s.freeformNote ? ` — ${s.freeformNote}` : ''}
                        </div>
                      ))}
                    </div>
                  )}
                </>
              )}
            </>
          )}
        </div>
      </div>

      {/* Snooze modal (rendered above panel) */}
      {showSnooze && (
        <SnoozeModal
          hubspotId={hubspotId}
          onClose={() => setShowSnooze(false)}
          onSuccess={() => {
            setShowSnooze(false)
            fetchDeal()
            onClose() // deal disappears from queue — close the panel and let parent re-fetch
          }}
        />
      )}
    </>
  )
}
