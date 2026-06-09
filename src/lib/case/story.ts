import type { CaseEvent, CaseEventCategory, StoryDay } from './types'

function toLocalDate(date: Date, tz: string): string {
  // en-CA locale gives ISO-format YYYY-MM-DD output, ideal for stable string keys
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: tz,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(date)
}

export function buildStoryDays(
  events: CaseEvent[],
  timezone = 'America/New_York'
): StoryDay[] {
  if (events.length === 0) return []

  // Sort newest first
  const sorted = [...events].sort((a, b) => b.happenedAt.getTime() - a.happenedAt.getTime())

  // Group by local calendar day
  const byDate = new Map<string, CaseEvent[]>()
  for (const event of sorted) {
    const date = toLocalDate(event.happenedAt, timezone)
    if (!byDate.has(date)) byDate.set(date, [])
    byDate.get(date)!.push(event)
  }

  // Build StoryDay for each date group, newest date first
  const days: StoryDay[] = []
  for (const [date, dayEvents] of byDate) {
    // dayEvents are already sorted newest-first within the day
    const categories = [...new Set(dayEvents.map(e => e.category))] as CaseEventCategory[]
    days.push({
      date,
      categories,
      eventCount: dayEvents.length,
      latestEventSummary: dayEvents[0].summary ?? null,
      events: dayEvents,
    })
  }

  // Sort days newest first (Map preserves insertion order which is already newest-first
  // because we sorted events before grouping, but sort explicitly to be safe)
  days.sort((a, b) => b.date.localeCompare(a.date))

  return days
}

export const CATEGORY_LABELS: Record<CaseEventCategory, string> = {
  attorney_activity: 'Attorney Activity',
  client_contact: 'Client Contact',
  document_received: 'Document Received',
  internal_note: 'Note',
  follow_up: 'Follow-up',
  outreach_attempt: 'Outreach Attempt',
  uncategorized: 'Activity',
}
