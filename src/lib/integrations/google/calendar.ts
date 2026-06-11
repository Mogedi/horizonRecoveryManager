// Google Calendar integration (events scope) — full read + write.
import { googleClient, type CalendarEvent, type CalendarEventInput } from './client'

export type NormalizedEvent = {
  id: string
  title: string | null
  description: string | null
  start: string | null
  end: string | null
  allDay: boolean
  location: string | null
  meetingLink: string | null // Zoom/Meet/Teams video link, if any
  attendees: Array<{ email: string; status: string | null }>
  organizer: string | null
  recurring: boolean
  link: string | null
}

const VIDEO_URL_RE =
  /https?:\/\/(?:[\w.-]*\.)?(?:zoom\.us|meet\.google\.com|teams\.microsoft\.com|teams\.live\.com|webex\.com|whereby\.com|us\d+web\.zoom\.us)\/[^\s"<>)]+/i

// Find the meeting/video link: Google Meet (hangoutLink), conference entry points, or a Zoom/Teams
// URL embedded in the location or description (where Zoom links usually live).
function extractMeetingLink(e: CalendarEvent): string | null {
  if (e.hangoutLink) return e.hangoutLink
  const ep = e.conferenceData?.entryPoints?.find((p) => p.entryPointType === 'video' && p.uri)
  if (ep?.uri) return ep.uri
  const loc = e.location?.match(VIDEO_URL_RE)?.[0]
  if (loc) return loc
  const desc = e.description?.match(VIDEO_URL_RE)?.[0]
  if (desc) return desc
  return null
}

function normalizeEvent(e: CalendarEvent): NormalizedEvent {
  const start = e.start?.dateTime ?? e.start?.date ?? null
  const end = e.end?.dateTime ?? e.end?.date ?? null
  return {
    id: e.id,
    title: e.summary ?? null,
    description: e.description ?? null,
    start,
    end,
    allDay: !!e.start?.date && !e.start?.dateTime,
    location: e.location ?? null,
    meetingLink: extractMeetingLink(e),
    attendees: (e.attendees ?? [])
      .filter((a) => a.email)
      .map((a) => ({ email: a.email as string, status: a.responseStatus ?? null })),
    organizer: e.organizer?.email ?? null,
    recurring: !!e.recurringEventId,
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

export async function getEvent(eventId: string): Promise<NormalizedEvent> {
  return normalizeEvent(await googleClient.getCalendarEvent(eventId))
}

// ── Writes (confirm-gated upstream) ───────────────────────────────────────────
const DEFAULT_TZ = 'America/New_York'

// Build a Google start/end object from a flexible input: a bare date = all-day; a timestamp = timed.
function toEventTime(value: string, isAllDay: boolean) {
  if (isAllDay) return { date: value.slice(0, 10) }
  return { dateTime: new Date(value).toISOString(), timeZone: DEFAULT_TZ }
}

export type CreateEventInput = {
  title: string
  start: string // ISO timestamp, or YYYY-MM-DD for all-day
  end?: string
  description?: string
  location?: string
  attendees?: string[] // emails
  allDay?: boolean
  durationMinutes?: number // used when end is omitted for a timed event
}

function buildEventBody(input: CreateEventInput): CalendarEventInput {
  const allDay = !!input.allDay || /^\d{4}-\d{2}-\d{2}$/.test(input.start)
  const startObj = toEventTime(input.start, allDay)
  let endObj
  if (input.end) {
    endObj = toEventTime(input.end, allDay)
  } else if (allDay) {
    endObj = { date: input.start.slice(0, 10) }
  } else {
    const mins = input.durationMinutes ?? 60
    endObj = { dateTime: new Date(new Date(input.start).getTime() + mins * 60_000).toISOString(), timeZone: DEFAULT_TZ }
  }
  return {
    summary: input.title,
    ...(input.description ? { description: input.description } : {}),
    ...(input.location ? { location: input.location } : {}),
    start: startObj,
    end: endObj,
    ...(input.attendees?.length ? { attendees: input.attendees.map((email) => ({ email })) } : {}),
  }
}

export async function createEvent(input: CreateEventInput): Promise<NormalizedEvent> {
  const ev = await googleClient.insertCalendarEvent(buildEventBody(input))
  return normalizeEvent(ev)
}

export async function updateEvent(eventId: string, patch: Partial<CreateEventInput>): Promise<NormalizedEvent> {
  const body: CalendarEventInput = {}
  if (patch.title !== undefined) body.summary = patch.title
  if (patch.description !== undefined) body.description = patch.description
  if (patch.location !== undefined) body.location = patch.location
  if (patch.attendees) body.attendees = patch.attendees.map((email) => ({ email }))

  if (patch.start) {
    const allDay = !!patch.allDay || /^\d{4}-\d{2}-\d{2}$/.test(patch.start)
    body.start = toEventTime(patch.start, allDay)
    if (patch.end) {
      body.end = toEventTime(patch.end, allDay)
    } else if (!allDay) {
      // Moving start without an end: preserve the event's existing duration so start never
      // ends up after end (Google rejects that with a 400).
      const current = await googleClient.getCalendarEvent(eventId)
      const cs = current.start?.dateTime, ce = current.end?.dateTime
      const durMs = cs && ce ? new Date(ce).getTime() - new Date(cs).getTime() : 60 * 60_000
      body.end = { dateTime: new Date(new Date(patch.start).getTime() + durMs).toISOString(), timeZone: DEFAULT_TZ }
    }
  } else if (patch.end) {
    body.end = toEventTime(patch.end, /^\d{4}-\d{2}-\d{2}$/.test(patch.end))
  }

  const ev = await googleClient.patchCalendarEvent(eventId, body)
  return normalizeEvent(ev)
}

export async function deleteEvent(eventId: string): Promise<void> {
  await googleClient.deleteCalendarEvent(eventId)
}
