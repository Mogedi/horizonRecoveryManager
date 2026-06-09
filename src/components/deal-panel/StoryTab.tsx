'use client'

import { useEffect, useState } from 'react'
import { formatDate } from '@/lib/utils/format'
import type { StoryDay, CaseEventCategory } from '@/lib/case/types'
import { CATEGORY_LABELS } from '@/lib/case/story'

type StoryEvent = {
  id: string
  happenedAt: string
  source: string
  type: string
  category: CaseEventCategory
  participants: string[]
  outcome: string | null
  summary: string | null
  durationSecs: number | null
}

type SerializedStoryDay = Omit<StoryDay, 'events'> & {
  events: StoryEvent[]
}

type StoryTabProps = {
  dealHubspotId: string
  layer2SyncedAt: string | null
}

const CATEGORY_DOTS: Record<CaseEventCategory, string> = {
  attorney_activity: 'bg-purple-500',
  client_contact: 'bg-green-500',
  document_received: 'bg-blue-500',
  internal_note: 'bg-gray-400',
  follow_up: 'bg-yellow-400',
  outreach_attempt: 'bg-orange-400',
  uncategorized: 'bg-gray-300',
}

function formatDuration(secs: number | null): string | null {
  if (!secs || secs < 1) return null
  const m = Math.floor(secs / 60)
  const s = secs % 60
  return `${m}:${String(s).padStart(2, '0')}`
}

function DayRow({ day, isOpen, onToggle }: { day: SerializedStoryDay; isOpen: boolean; onToggle: () => void }) {
  const uniqueLabels = [...new Set(day.categories)].map(c => CATEGORY_LABELS[c]).filter(Boolean)

  return (
    <div className="border-b border-gray-100 last:border-0">
      <button
        onClick={onToggle}
        className="w-full text-left px-4 py-3 hover:bg-gray-50 flex items-start gap-3"
      >
        <span className="text-xs text-gray-400 shrink-0 w-14 pt-0.5">{formatDate(day.date)}</span>
        <div className="flex-1 min-w-0">
          <span className="text-xs font-medium text-gray-700">
            {uniqueLabels.length > 0 ? uniqueLabels.join(' · ') : 'Activity'}
          </span>
          {day.latestEventSummary && !isOpen && (
            <p className="text-xs text-gray-400 mt-0.5 truncate">{day.latestEventSummary}</p>
          )}
        </div>
        <div className="flex items-center gap-2 shrink-0">
          <span className="text-xs text-gray-300">{day.eventCount}</span>
          <span className={`text-gray-300 text-xs transition-transform ${isOpen ? 'rotate-90' : ''}`}>›</span>
        </div>
      </button>

      {isOpen && (
        <div className="px-4 pb-3 space-y-2 bg-gray-50/50">
          {day.events.map(event => (
            <div key={event.id} className="flex items-start gap-2">
              <span className={`inline-block w-2 h-2 rounded-full shrink-0 mt-1.5 ${CATEGORY_DOTS[event.category]}`} />
              <div className="min-w-0">
                <div className="flex items-center gap-2 flex-wrap">
                  <span className="text-[11px] text-gray-400">{formatDate(event.happenedAt)}</span>
                  <span className="text-[11px] text-gray-600 font-medium">{CATEGORY_LABELS[event.category]}</span>
                  {event.participants.length > 0 && (
                    <span className="text-[11px] text-gray-400">{event.participants.join(', ')}</span>
                  )}
                  {event.durationSecs != null && (
                    <span className="text-[11px] text-gray-400">{formatDuration(event.durationSecs)}</span>
                  )}
                </div>
                {event.summary && (
                  <p className="text-xs text-gray-500 mt-0.5 leading-relaxed">{event.summary}</p>
                )}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

export function StoryTab({ dealHubspotId, layer2SyncedAt }: StoryTabProps) {
  const [days, setDays] = useState<SerializedStoryDay[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [openDate, setOpenDate] = useState<string | null>(null)

  useEffect(() => {
    setLoading(true)
    setError(null)
    fetch(`/api/deals/${dealHubspotId}/story`)
      .then(r => r.ok ? r.json() : r.json().then((j: { error?: string }) => Promise.reject(j.error ?? 'Error')))
      .then((json: { days: SerializedStoryDay[] }) => setDays(json.days))
      .catch((e: unknown) => setError(e instanceof Error ? e.message : String(e)))
      .finally(() => setLoading(false))
  }, [dealHubspotId])

  if (!layer2SyncedAt) {
    return (
      <div className="px-5 py-6 text-center text-sm text-gray-400">
        Load full detail to see case story
      </div>
    )
  }

  if (loading) {
    return (
      <div className="px-4 py-4 space-y-2">
        {[1, 2, 3, 4].map(i => (
          <div key={i} className="h-10 bg-gray-100 rounded animate-pulse" />
        ))}
      </div>
    )
  }

  if (error) {
    return <div className="px-5 py-4 text-sm text-red-600">{error}</div>
  }

  if (days.length === 0) {
    return (
      <div className="px-5 py-6 text-center text-sm text-gray-400">
        No activity recorded yet
      </div>
    )
  }

  return (
    <div>
      {days.map(day => (
        <DayRow
          key={day.date}
          day={day}
          isOpen={openDate === day.date}
          onToggle={() => setOpenDate(openDate === day.date ? null : day.date)}
        />
      ))}
    </div>
  )
}
