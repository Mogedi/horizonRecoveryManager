import { categorizeEvent } from './classifier'
import type { CaseEvent, CaseEventSource, CaseEventType } from './types'

// Minimal shapes needed from each DB layer — matching actual Prisma select outputs

type ActivityRow = {
  id: number
  type: string
  body: string | null
  authorOwnerId: string | null
  direction: string | null
  timestamp: Date | null
  syncedAt: Date
}

type ActivityEventRow = {
  id: number
  source: string
  type: string
  happenedAt: Date
  body: string | null
  direction: string | null
  outcome: string | null
  fromNumber: string | null
  toNumber: string | null
  agentId: string | null
  durationSecs: number | null
}

type ContactRow = {
  name: string | null
  phoneNumbers: unknown
}

function excerpt(body: string | null, max = 120): string | null {
  if (!body) return null
  const trimmed = body.trim()
  if (!trimmed) return null
  return trimmed.length <= max ? trimmed : trimmed.slice(0, max) + '…'
}

function callSummary(outcome: string | null, durationSecs: number | null): string | null {
  if (!outcome) return null
  if (outcome === 'answered') {
    if (durationSecs) {
      const m = Math.floor(durationSecs / 60)
      const s = durationSecs % 60
      return `Answered · ${m}:${String(s).padStart(2, '0')}`
    }
    return 'Answered'
  }
  if (outcome === 'voicemail') return 'Voicemail left'
  if (outcome === 'no_answer') return 'No answer'
  if (outcome === 'busy') return 'Busy'
  return outcome
}

function phoneToContact(
  phone: string | null,
  contacts: ContactRow[]
): string | null {
  if (!phone) return null
  for (const c of contacts) {
    const phones = Array.isArray(c.phoneNumbers) ? (c.phoneNumbers as string[]) : []
    if (phones.includes(phone)) return c.name
  }
  return null
}

function sourceToEnum(source: string): CaseEventSource {
  const s = source.toLowerCase()
  if (s === 'justcall') return 'justcall'
  if (s === 'google') return 'google'
  if (s === 'user') return 'user'
  if (s === 'ai') return 'ai'
  return 'hubspot'
}

export function buildCaseEvents(
  activities: ActivityRow[],
  activityEvents: ActivityEventRow[],
  contacts: ContactRow[],
  ownerMap: Record<string, string>
): CaseEvent[] {
  const events: CaseEvent[] = []

  // Map HubSpot Layer 2 activities
  for (const a of activities) {
    const happenedAt = a.timestamp ?? a.syncedAt
    const category = categorizeEvent({ type: a.type, body: a.body, outcome: null })
    const author = a.authorOwnerId ? (ownerMap[a.authorOwnerId] ?? null) : null

    events.push({
      id: `hubspot:${a.id}`,
      happenedAt,
      source: 'hubspot',
      type: a.type as CaseEventType,
      category,
      participants: author ? [author] : [],
      outcome: null,
      summary: excerpt(a.body),
      durationSecs: null,
      rawRef: { table: 'deal_activities', id: a.id },
    })
  }

  // Map ActivityEvents (JustCall, Google, etc.)
  for (const e of activityEvents) {
    const category = categorizeEvent({ type: e.type, body: e.body, outcome: e.outcome })

    // Participant: look up contact by phone for calls, use agentId as fallback
    let participants: string[] = []
    if (e.type === 'call') {
      const byTo = phoneToContact(e.toNumber, contacts)
      const byFrom = phoneToContact(e.fromNumber, contacts)
      const found = byTo ?? byFrom
      if (found) participants = [found]
    }

    const summary = e.type === 'call'
      ? callSummary(e.outcome, e.durationSecs)
      : excerpt(e.body)

    events.push({
      id: `${sourceToEnum(e.source)}:${e.id}`,
      happenedAt: e.happenedAt,
      source: sourceToEnum(e.source),
      type: e.type as CaseEventType,
      category,
      participants,
      outcome: e.outcome,
      summary,
      durationSecs: e.durationSecs,
      rawRef: { table: 'activity_events', id: e.id },
    })
  }

  // Sort newest first
  return events.sort((a, b) => b.happenedAt.getTime() - a.happenedAt.getTime())
}
