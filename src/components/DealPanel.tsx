'use client'

import { useEffect, useState, useCallback } from 'react'
import { formatAmount, relativeDate, formatDate } from '@/lib/utils/format'

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

type SummaryJson = {
  current_status: string
  last_meaningful_activity: string
  blockers: string[]
  who_needs_something: string | null
  suggested_next_step: string
  mo_action_required: boolean
  documents_mentioned_missing: string[]
}

type PanelData = {
  deal: DealDetail
  activities: Activity[]
  contacts: Contact[]
  snooze: Snooze | null
  snoozeHistory: SnoozeHistoryItem[]
  layer2SyncedAt: string | null
  summaryData: { json: SummaryJson; generatedAt: string } | null
}

type OutreachPhone = {
  numberE164: string
  attempts: { happenedAt: string; outcome: string; durationSecs: number | null }[]
  lastOutcome: 'answered' | 'voicemail' | 'no_answer' | 'busy' | null
  lastCalledAt: string | null
  everAnswered: boolean
}

type OutreachContact = {
  contactHubspotId: string | null
  name: string | null
  contactType: string | null
  phones: OutreachPhone[]
  reached: boolean
  totalAttempts: number
}

type OutreachDay = {
  date: string
  callCount: number
  answeredCount: number
  contactsReached: string[]
}

type OutreachMatrix = {
  outreachDays: number
  totalOutboundCalls: number
  contactsTotal: number
  contactsReached: number
  lastCalledAt: string | null
  contacts: OutreachContact[]
  days: OutreachDay[]
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

function tomorrowISO(): string {
  const d = new Date()
  d.setDate(d.getDate() + 1)
  return d.toISOString().slice(0, 10)
}

function formatPhone(e164: string): string {
  const m = e164.match(/^\+1(\d{3})(\d{3})(\d{4})$/)
  return m ? `(${m[1]}) ${m[2]}-${m[3]}` : e164
}

function OutcomeDot({ outcome, everAnswered }: { outcome: OutreachPhone['lastOutcome']; everAnswered: boolean }) {
  if (!outcome) return <span className="text-gray-300 text-sm">○</span>
  if (outcome === 'answered') return <span className="text-green-500 text-sm">●</span>
  if (outcome === 'voicemail') return <span className="text-amber-400 text-sm">●</span>
  // no_answer / busy
  return everAnswered
    ? <span className="text-amber-400 text-sm">●</span>  // was answered before, now not
    : <span className="text-red-400 text-sm">●</span>
}

function outcomeLabel(outcome: OutreachPhone['lastOutcome']): string {
  if (!outcome) return 'not called'
  if (outcome === 'answered') return 'answered'
  if (outcome === 'voicemail') return 'voicemail'
  if (outcome === 'busy') return 'busy'
  return 'no answer'
}

// ─── Outreach Section ─────────────────────────────────────────────────────────

function OutreachSection({ matrix }: { matrix: OutreachMatrix }) {
  const [showDays, setShowDays] = useState(false)

  if (matrix.totalOutboundCalls === 0) {
    return (
      <>
        <SectionHeader title="Call Outreach" />
        <p className="text-sm text-gray-400 mb-4">No JustCall activity recorded for this deal.</p>
      </>
    )
  }

  const lastDate = matrix.lastCalledAt
    ? new Date(matrix.lastCalledAt).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
    : null

  return (
    <>
      <SectionHeader title="Call Outreach" />

      {/* Summary bar */}
      <div className="mb-3 flex flex-wrap gap-x-3 gap-y-1 text-xs text-gray-500">
        <span className="font-medium text-gray-700">{matrix.outreachDays} day{matrix.outreachDays !== 1 ? 's' : ''}</span>
        <span>·</span>
        <span>{matrix.totalOutboundCalls} calls</span>
        <span>·</span>
        <span
          className={matrix.contactsReached === matrix.contactsTotal ? 'text-green-600 font-medium' : 'text-amber-600 font-medium'}
        >
          {matrix.contactsReached}/{matrix.contactsTotal} contacts reached
        </span>
        {lastDate && (
          <>
            <span>·</span>
            <span>Last {lastDate}</span>
          </>
        )}
      </div>

      {/* Day-by-day toggle */}
      {matrix.days.length > 0 && (
        <button
          onClick={() => setShowDays(v => !v)}
          className="text-xs text-gray-400 hover:text-gray-600 mb-3"
        >
          {showDays ? '▾' : '▸'} {showDays ? 'Hide' : 'Show'} day-by-day ({matrix.days.length} sessions)
        </button>
      )}
      {showDays && (
        <div className="mb-4 rounded-lg border border-gray-100 overflow-hidden text-xs">
          {matrix.days.map(day => (
            <div key={day.date} className="flex items-baseline gap-3 px-3 py-2 border-b border-gray-100 last:border-0">
              <span className="text-gray-400 w-20 shrink-0">
                {new Date(day.date + 'T12:00:00').toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}
              </span>
              <span className="text-gray-600">{day.callCount} calls</span>
              {day.answeredCount > 0 ? (
                <span className="text-green-600">{day.answeredCount} answered</span>
              ) : (
                <span className="text-gray-400">0 answered</span>
              )}
              {day.contactsReached.length > 0 && (
                <span className="text-gray-500 truncate">{day.contactsReached.join(', ')}</span>
              )}
            </div>
          ))}
        </div>
      )}

      {/* Contact × phone grid */}
      <div className="space-y-3 mb-4">
        {matrix.contacts.map((contact, i) => (
          <div key={contact.contactHubspotId ?? i} className="rounded-lg border border-gray-100 overflow-hidden">
            {/* Contact header */}
            <div className="flex items-center justify-between px-3 py-2 bg-gray-50 border-b border-gray-100">
              <span className="text-sm font-medium text-gray-800">
                {contact.name ?? 'Unknown contact'}
              </span>
              <span className={`text-xs px-1.5 py-0.5 rounded-full ${contact.reached ? 'bg-green-100 text-green-700' : 'bg-gray-100 text-gray-500'}`}>
                {contact.reached ? 'reached' : `${contact.totalAttempts} attempts`}
              </span>
            </div>
            {/* Phone rows */}
            {contact.phones.length === 0 ? (
              <div className="px-3 py-2 text-xs text-gray-400">No phone numbers</div>
            ) : (
              <div className="divide-y divide-gray-50">
                {contact.phones.map(phone => (
                  <div key={phone.numberE164} className="flex items-center gap-2 px-3 py-1.5">
                    <OutcomeDot outcome={phone.lastOutcome} everAnswered={phone.everAnswered} />
                    <span className="text-xs text-gray-700 font-mono w-32 shrink-0">
                      {formatPhone(phone.numberE164)}
                    </span>
                    <span className="text-xs text-gray-400">
                      {phone.attempts.length > 0
                        ? `${phone.attempts.length} call${phone.attempts.length !== 1 ? 's' : ''} · ${outcomeLabel(phone.lastOutcome)}`
                        : 'not called'}
                    </span>
                  </div>
                ))}
              </div>
            )}
          </div>
        ))}
      </div>
    </>
  )
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
        <span>{formatDate(activity.timestamp)}</span>
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

// ─── AI Summary Block ─────────────────────────────────────────────────────────

function AiSummaryBlock({
  summary,
  generatedAt,
  lastActivityDate,
  onRegenerate,
}: {
  summary: SummaryJson
  generatedAt: string
  lastActivityDate: string | null
  onRegenerate: () => void
}) {
  const generatedDate = new Date(generatedAt)
  const isStale = lastActivityDate && new Date(lastActivityDate) > generatedDate

  const diffMs = Date.now() - generatedDate.getTime()
  const diffMins = Math.floor(diffMs / 60_000)
  const timeAgo =
    diffMins < 1 ? 'just now' :
    diffMins < 60 ? `${diffMins}m ago` :
    `${Math.floor(diffMins / 60)}h ago`

  return (
    <div className="mb-4 rounded-lg border border-gray-200 overflow-hidden">
      {summary.mo_action_required && (
        <div className="px-4 py-2 bg-red-50 border-b border-red-100 text-xs font-semibold text-red-700">
          Mo Action Required
        </div>
      )}

      <div className="px-4 py-3 space-y-3 text-sm text-gray-700">
        <div>
          <span className="block text-xs font-semibold text-gray-400 uppercase tracking-wider mb-0.5">Status</span>
          <p>{summary.current_status}</p>
        </div>
        <div>
          <span className="block text-xs font-semibold text-gray-400 uppercase tracking-wider mb-0.5">Last Activity</span>
          <p>{summary.last_meaningful_activity}</p>
        </div>
        {summary.blockers.length > 0 && (
          <div>
            <span className="block text-xs font-semibold text-gray-400 uppercase tracking-wider mb-0.5">Blockers</span>
            <ul className="list-disc list-inside space-y-0.5">
              {summary.blockers.map((b, i) => <li key={i}>{b}</li>)}
            </ul>
          </div>
        )}
        {summary.who_needs_something && (
          <div>
            <span className="block text-xs font-semibold text-gray-400 uppercase tracking-wider mb-0.5">Who Needs Something</span>
            <p>{summary.who_needs_something}</p>
          </div>
        )}
        <div>
          <span className="block text-xs font-semibold text-gray-400 uppercase tracking-wider mb-0.5">Suggested Next Step</span>
          <p className="font-medium">{summary.suggested_next_step}</p>
        </div>
        {summary.documents_mentioned_missing.length > 0 && (
          <div>
            <span className="block text-xs font-semibold text-gray-400 uppercase tracking-wider mb-0.5">Documents Missing</span>
            <ul className="list-disc list-inside space-y-0.5">
              {summary.documents_mentioned_missing.map((d, i) => <li key={i}>{d}</li>)}
            </ul>
          </div>
        )}
      </div>

      <div className="px-4 py-2 border-t border-gray-100 flex items-center justify-between">
        <div className="flex items-center gap-2 text-xs text-gray-400">
          <span>Generated {timeAgo}</span>
          {isStale && (
            <span className="px-1.5 py-0.5 bg-yellow-50 border border-yellow-200 text-yellow-700 rounded text-xs">
              New activity since summary
            </span>
          )}
        </div>
        <button
          onClick={onRegenerate}
          className="text-xs text-gray-400 hover:text-gray-700"
        >
          ↻ Regenerate
        </button>
      </div>
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

// ─── Task Prompt ──────────────────────────────────────────────────────────────

function TaskPromptInline({
  suggestedTitle,
  hubspotId,
  onDone,
  onDismiss,
}: {
  suggestedTitle: string
  hubspotId: string
  onDone: () => void
  onDismiss: () => void
}) {
  const [title, setTitle] = useState(suggestedTitle)
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const create = async () => {
    setSubmitting(true)
    setError(null)
    try {
      const res = await fetch('/api/tasks', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ title: title.trim(), category: 'case', dealHubspotId: hubspotId }),
      })
      if (!res.ok) {
        const body = await res.json().catch(() => ({}))
        throw new Error(body?.error ?? `Failed: ${res.status}`)
      }
      onDone()
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to create task')
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <div className="mb-4 p-3 bg-amber-50 border border-amber-200 rounded-lg">
      <p className="text-xs font-semibold text-amber-800 mb-2">Mo Action Required — Create a task?</p>
      <input
        type="text"
        value={title}
        onChange={e => setTitle(e.target.value)}
        className="w-full px-2 py-1.5 text-sm border border-amber-200 rounded bg-white mb-2 focus:outline-none focus:ring-1 focus:ring-amber-400"
      />
      {error && <p className="text-xs text-red-600 mb-2">{error}</p>}
      <div className="flex gap-2">
        <button
          onClick={create}
          disabled={submitting || !title.trim()}
          className="px-3 py-1 text-xs text-white bg-amber-700 rounded hover:bg-amber-800 disabled:opacity-40"
        >
          {submitting ? 'Creating…' : 'Create Task'}
        </button>
        <button
          onClick={onDismiss}
          className="px-3 py-1 text-xs text-amber-700 hover:text-amber-900"
        >
          Dismiss
        </button>
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

  const [outreachData, setOutreachData] = useState<OutreachMatrix | null>(null)

  const [layer2State, setLayer2State] = useState<'idle' | 'confirming' | 'loading' | 'done'>('idle')
  const [layer2CallMsg, setLayer2CallMsg] = useState<string | null>(null)
  const [layer2Error, setLayer2Error] = useState<string | null>(null)

  const [showSnooze, setShowSnooze] = useState(false)
  const [snoozeRemoving, setSnoozeRemoving] = useState(false)
  const [showSnoozeHistory, setShowSnoozeHistory] = useState(false)

  const [summaryState, setSummaryState] = useState<'idle' | 'loading' | 'done' | 'error'>('idle')
  const [summaryError, setSummaryError] = useState<string | null>(null)
  const [taskPromptState, setTaskPromptState] = useState<'idle' | 'open' | 'done' | 'dismissed'>('idle')

  const fetchDeal = useCallback(async () => {
    setError(null)
    try {
      const [dealRes, outreachRes] = await Promise.all([
        fetch(`/api/deals/${hubspotId}`),
        fetch(`/api/deals/${hubspotId}/outreach`),
      ])
      if (!dealRes.ok) throw new Error(`${dealRes.status} ${dealRes.statusText}`)
      const json = await dealRes.json()
      setData(json)
      if (json.layer2SyncedAt) setLayer2State('done')
      if (json.summaryData) setSummaryState('done')
      if (outreachRes.ok) {
        const outreach = await outreachRes.json()
        setOutreachData(outreach)
      }
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

  const generateSummary = async () => {
    setSummaryState('loading')
    setSummaryError(null)
    setTaskPromptState('idle')
    try {
      const res = await fetch(`/api/deals/${hubspotId}/summary`, { method: 'POST' })
      if (!res.ok) {
        const body = await res.json().catch(() => ({}))
        throw new Error(body?.error ?? `Failed: ${res.status}`)
      }
      const result = await res.json()
      await fetchDeal()
      setSummaryState('done')
      if (result.summary?.mo_action_required === true) {
        setTaskPromptState('open')
      }
    } catch (e) {
      setSummaryError(e instanceof Error ? e.message : 'Summary generation failed')
      setSummaryState('error')
    }
  }

  const { deal, activities, contacts, snooze, snoozeHistory, summaryData } = data ?? {}

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
                    deal.taxSaleDate ? `Tax sale ${formatDate(deal.taxSaleDate, { month: 'short', day: 'numeric', year: 'numeric' })}` : null,
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
                      Snoozed until {formatDate(snooze.snoozeUntil)} · {SNOOZE_CATEGORY_LABELS[snooze.category] ?? snooze.category}
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
              {layer2State === 'done' && (
                <button
                  onClick={startLayer2}
                  className="text-xs text-gray-400 hover:text-gray-600 mb-4"
                >
                  ↻ Refresh contacts & activity from HubSpot
                </button>
              )}

              {/* AI Summary */}
              {layer2State === 'done' && (
                <>
                  <SectionHeader title="AI Summary" />
                  {summaryState === 'idle' && (
                    <button
                      onClick={generateSummary}
                      className="w-full py-2 text-sm text-gray-700 bg-white border border-gray-300 rounded-md hover:bg-gray-50 mb-4"
                    >
                      Generate AI Summary
                    </button>
                  )}
                  {summaryState === 'loading' && (
                    <div className="mb-4 px-4 py-3 bg-gray-50 border border-gray-200 rounded-lg text-sm text-gray-500 animate-pulse">
                      Generating summary — this may take up to 20 seconds…
                    </div>
                  )}
                  {summaryState === 'error' && (
                    <div className="mb-4 px-4 py-3 bg-red-50 border border-red-200 rounded-lg">
                      <p className="text-sm font-medium text-red-800">Summary unavailable</p>
                      {summaryError && (
                        <p className="text-xs text-red-600 mt-0.5">{summaryError}</p>
                      )}
                      <button
                        onClick={generateSummary}
                        className="mt-2 text-xs text-red-700 underline"
                      >
                        Retry
                      </button>
                    </div>
                  )}
                  {summaryState === 'done' && summaryData && (
                    <AiSummaryBlock
                      summary={summaryData.json}
                      generatedAt={summaryData.generatedAt}
                      lastActivityDate={deal.lastActivityDate}
                      onRegenerate={generateSummary}
                    />
                  )}
                  {summaryState === 'done' && summaryData?.json.mo_action_required && taskPromptState === 'open' && (
                    <TaskPromptInline
                      suggestedTitle={summaryData.json.suggested_next_step}
                      hubspotId={hubspotId}
                      onDone={() => setTaskPromptState('done')}
                      onDismiss={() => setTaskPromptState('dismissed')}
                    />
                  )}
                  {summaryState === 'done' && taskPromptState === 'done' && (
                    <div className="mb-4 px-3 py-2 bg-green-50 border border-green-200 rounded text-xs text-green-700">
                      Task created and added to your task list.
                    </div>
                  )}
                </>
              )}

              {/* Call Outreach matrix */}
              {outreachData && <OutreachSection matrix={outreachData} />}

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
                          {SNOOZE_CATEGORY_LABELS[s.category] ?? s.category} · until {formatDate(s.snoozeUntil)}
                          {s.wokeAt ? ` · removed ${relativeDate(s.wokeAt)}` : ' · active'}
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
