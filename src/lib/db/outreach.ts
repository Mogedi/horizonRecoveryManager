import { prisma } from './client'
import { ActivitySource } from '@prisma/client'

// ── Input types (raw DB rows, used by both DB layer and pure compute function) ──

export type RawContact = {
  contactHubspotId: string | null
  name: string | null
  contactType: string | null
  phoneNumbers: unknown  // Json from Prisma — we coerce to string[] safely
}

export type RawEvent = {
  happenedAt: Date | string
  direction: string | null
  outcome: string | null
  toNumber: string | null
  fromNumber: string | null
  durationSecs: number | null
}

// ── Output types ───────────────────────────────────────────────────────────────

export type CallAttempt = {
  happenedAt: Date
  outcome: 'answered' | 'voicemail' | 'no_answer' | 'busy'
  durationSecs: number | null
}

export type PhoneOutreach = {
  numberE164: string
  attempts: CallAttempt[]       // chronological
  lastOutcome: CallAttempt['outcome'] | null
  lastCalledAt: Date | null
  everAnswered: boolean
}

export type ContactOutreach = {
  contactHubspotId: string | null
  name: string | null
  contactType: string | null
  phones: PhoneOutreach[]
  reached: boolean    // any phone ever answered
  totalAttempts: number
}

export type OutreachDay = {
  date: string          // 'YYYY-MM-DD' — JustCall account date (Eastern)
  callCount: number
  answeredCount: number
  contactsReached: string[]  // names of contacts with an answered call that day
}

export type DealOutreachMatrix = {
  dealHubspotId: string
  outreachDays: number
  totalOutboundCalls: number
  contactsTotal: number
  contactsReached: number
  lastCalledAt: Date | null
  contacts: ContactOutreach[]
  days: OutreachDay[]
}

// ── Pure computation (no DB — fully testable with fixture data) ────────────────

export function computeOutreachMatrix(
  dealHubspotId: string,
  contacts: RawContact[],
  events: RawEvent[],
): DealOutreachMatrix {
  // Build phone→contacts index (a number may be shared across contacts)
  const phoneToContacts = new Map<string, string[]>() // numberE164 → contactHubspotIds
  for (const contact of contacts) {
    const phones = toPhoneArray(contact.phoneNumbers)
    for (const phone of phones) {
      const existing = phoneToContacts.get(phone) ?? []
      if (!existing.includes(contact.contactHubspotId ?? '')) {
        phoneToContacts.set(phone, [...existing, contact.contactHubspotId ?? ''])
      }
    }
  }

  // Only count outbound calls as outreach
  const outbound = events.filter(e => e.direction === 'outbound')

  // Build phone→attempts map
  const phoneAttempts = new Map<string, CallAttempt[]>()
  for (const ev of outbound) {
    const num = ev.toNumber
    if (!num) continue
    const attempt: CallAttempt = {
      happenedAt: new Date(ev.happenedAt),
      outcome: normalizeOutcome(ev.outcome),
      durationSecs: ev.durationSecs,
    }
    const list = phoneAttempts.get(num) ?? []
    list.push(attempt)
    phoneAttempts.set(num, list)
  }

  // Sort attempts chronologically per phone
  for (const list of phoneAttempts.values()) {
    list.sort((a, b) => a.happenedAt.getTime() - b.happenedAt.getTime())
  }

  // Build per-contact data
  const contactById = new Map(contacts.map(c => [c.contactHubspotId ?? '', c]))
  const contactOutreach: ContactOutreach[] = contacts.map(contact => {
    const phones = toPhoneArray(contact.phoneNumbers)
    const phoneOutreaches: PhoneOutreach[] = phones.map(num => {
      const attempts = phoneAttempts.get(num) ?? []
      const last = attempts[attempts.length - 1] ?? null
      return {
        numberE164: num,
        attempts,
        lastOutcome: last?.outcome ?? null,
        lastCalledAt: last?.happenedAt ?? null,
        everAnswered: attempts.some(a => a.outcome === 'answered'),
      }
    })

    const reached = phoneOutreaches.some(p => p.everAnswered)
    const totalAttempts = phoneOutreaches.reduce((n, p) => n + p.attempts.length, 0)

    return {
      contactHubspotId: contact.contactHubspotId,
      name: contact.name,
      contactType: contact.contactType,
      phones: phoneOutreaches,
      reached,
      totalAttempts,
    }
  })

  // Build per-day summaries
  const dayMap = new Map<string, { calls: number; answered: number; contactIds: Set<string> }>()
  for (const ev of outbound) {
    if (!ev.toNumber) continue
    const date = new Date(ev.happenedAt).toISOString().slice(0, 10)
    const entry = dayMap.get(date) ?? { calls: 0, answered: 0, contactIds: new Set() }
    entry.calls++
    if (normalizeOutcome(ev.outcome) === 'answered') {
      entry.answered++
      // Find contacts whose phones include this toNumber
      const contactIds = phoneToContacts.get(ev.toNumber) ?? []
      for (const id of contactIds) entry.contactIds.add(id)
    }
    dayMap.set(date, entry)
  }

  const days: OutreachDay[] = [...dayMap.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([date, { calls, answered, contactIds }]) => ({
      date,
      callCount: calls,
      answeredCount: answered,
      contactsReached: [...contactIds]
        .map(id => contactById.get(id)?.name ?? null)
        .filter((n): n is string => n !== null),
    }))

  // Top-level stats
  const allDates = new Set(outbound.map(e => new Date(e.happenedAt).toISOString().slice(0, 10)))
  const lastCalledAt = outbound.length > 0
    ? new Date(Math.max(...outbound.map(e => new Date(e.happenedAt).getTime())))
    : null

  return {
    dealHubspotId,
    outreachDays: allDates.size,
    totalOutboundCalls: outbound.length,
    contactsTotal: contacts.length,
    contactsReached: contactOutreach.filter(c => c.reached).length,
    lastCalledAt,
    contacts: contactOutreach,
    days,
  }
}

// ── DB wrapper ─────────────────────────────────────────────────────────────────

export async function getDealOutreachMatrix(dealHubspotId: string): Promise<DealOutreachMatrix> {
  const [contacts, events] = await Promise.all([
    prisma.dealContact.findMany({
      where: { dealHubspotId },
      select: { contactHubspotId: true, name: true, contactType: true, phoneNumbers: true },
    }),
    prisma.activityEvent.findMany({
      where: { dealHubspotId, source: ActivitySource.JUSTCALL },
      select: { happenedAt: true, direction: true, outcome: true, toNumber: true, fromNumber: true, durationSecs: true },
      orderBy: { happenedAt: 'asc' },
    }),
  ])

  return computeOutreachMatrix(dealHubspotId, contacts, events)
}

// ── Helpers ────────────────────────────────────────────────────────────────────

// HubSpot sometimes stores numbers without the leading + (e.g. "14788324342").
// Normalize to E.164 before matching against activity_events.toNumber.
function toPhoneArray(raw: unknown): string[] {
  if (!Array.isArray(raw)) return []
  return raw
    .filter((v): v is string => typeof v === 'string')
    .map(v => {
      const digits = v.replace(/\D/g, '')
      if (digits.length === 11 && digits.startsWith('1')) return `+1${digits.slice(1)}`
      if (digits.length === 10) return `+1${digits}`
      return v  // non-US or already E.164 — return as-is
    })
}

function normalizeOutcome(raw: string | null | undefined): CallAttempt['outcome'] {
  switch (raw) {
    case 'answered':  return 'answered'
    case 'voicemail': return 'voicemail'
    case 'busy':      return 'busy'
    default:          return 'no_answer'
  }
}
