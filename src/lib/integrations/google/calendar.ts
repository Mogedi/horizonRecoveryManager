// Google Calendar integration (events scope). Read functions now; writes added in a later phase.
import { googleClient, type CalendarEvent } from './client'

export type NormalizedEvent = {
  id: string
  title: string | null
  start: string | null
  end: string | null
  allDay: boolean
  location: string | null
  attendees: string[]
  link: string | null
}

function normalizeEvent(e: CalendarEvent): NormalizedEvent {
  const start = e.start?.dateTime ?? e.start?.date ?? null
  const end = e.end?.dateTime ?? e.end?.date ?? null
  return {
    id: e.id,
    title: e.summary ?? null,
    start,
    end,
    allDay: !!e.start?.date && !e.start?.dateTime,
    location: e.location ?? null,
    attendees: (e.attendees ?? []).map((a) => a.email ?? '').filter(Boolean),
    link: e.htmlLink ?? null,
  }
}

export async function getUpcomingEvents(
  opts: { days?: number; maxResults?: number } = {}
): Promise<NormalizedEvent[]> {
  const days = opts.days ?? 14
  const timeMin = new Date().toISOString()
  const timeMax = new Date(Date.now() + days * 86_400_000).toISOString()
  const events = await googleClient.listCalendarEvents({
    timeMin,
    timeMax,
    maxResults: opts.maxResults ?? 25,
  })
  return events.map(normalizeEvent)
}
