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
  id?: number
  happenedAt: Date | string
  // JustCall stores call_date as date-only (midnight UTC). call_user_time has the real ET call time.
  userLocalTime?: string | null  // "HH:MM:SS" 24h in agent's local timezone (Eastern)
  direction: string | null
  outcome: string | null
  toNumber: string | null
  fromNumber: string | null
  durationSecs: number | null
  // Transcript enrichment — populated by getDealOutreachMatrix, optional for pure tests
  transcript?: string | null
  transcriptSummary?: string | null
  transcriptClassification?: string | null
  hasRecording?: boolean
}

// ── DetailedOutcome — rich per-call classification ─────────────────────────────
// Derived from JustCall outcome + transcript classification + transcript content.
// Extensible: add new variants here and in OUTCOME_META in DealPanel.

export type DetailedOutcome =
  | 'conversation'          // back-and-forth dialogue confirmed; someone actually spoke
  | 'voicemail_msg_left'    // reached voicemail, left a callback message
  | 'voicemail_full'        // reached voicemail, mailbox full — couldn't leave message
  | 'voicemail_no_msg'      // reached voicemail, hung up without leaving message (unusual)
  | 'dead_line'             // carrier confirmed: number not in service
  | 'no_answer'             // rang out, nobody picked up, line is active
  | 'busy'                  // busy signal
  | 'brief_answered'        // < 4s answered — too short to classify (possible dead line or instant VM)
  | 'pending_transcript'    // long enough call, has recording, backfill hasn't run yet
  | 'recording_unavailable' // answered but JustCall didn't capture audio

// ── Output types ───────────────────────────────────────────────────────────────

export type CallAttempt = {
  happenedAt: Date
  outcome: 'answered' | 'voicemail' | 'no_answer' | 'busy'
  durationSecs: number | null
  detailedOutcome: DetailedOutcome
}

export type SessionCall = {
  activityEventId: number
  happenedAt: Date
  displayTime: string | null       // "12:17 PM" formatted from call_user_time
  userLocalTime: string | null     // "HH:MM:SS" raw — used for within-day chronological sort
  contactName: string | null
  contactHubspotId: string | null
  phoneNumber: string
  durationSecs: number | null
  outcome: CallAttempt['outcome']
  detailedOutcome: DetailedOutcome
  transcript: string | null
  displaySummary: string | null    // AI summary or derived summary (voicemail/dc); null if pending
  transcriptClassification: string | null
  transcriptStatus: 'available' | 'too_short' | 'no_recording' | 'not_started'
}

export type PhoneOutreach = {
  numberE164: string
  attempts: CallAttempt[]
  lastOutcome: CallAttempt['outcome'] | null
  lastDetailedOutcome: DetailedOutcome | null
  lastCalledAt: Date | null
  everAnswered: boolean
}

export type ContactOutreach = {
  contactHubspotId: string | null
  name: string | null
  contactType: string | null
  phones: PhoneOutreach[]
  reached: boolean
  totalAttempts: number
}

export type OutreachDay = {
  date: string                 // 'YYYY-MM-DD' — JustCall account date (Eastern)
  callCount: number
  answeredCount: number        // raw JustCall "answered" count (kept for backward compat)
  conversationCount: number    // calls classified as 'conversation' (actual human dialogue)
  voicemailCount: number       // any voicemail subtype (msg_left + full + no_msg)
  deadLineCount: number        // dead number confirmations
  contactsReached: string[]    // contacts with any answered call (broad — for display)
  calls: SessionCall[]
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

// ── Pure computation ───────────────────────────────────────────────────────────

export function computeOutreachMatrix(
  dealHubspotId: string,
  contacts: RawContact[],
  events: RawEvent[],
): DealOutreachMatrix {
  const phoneToContacts = new Map<string, string[]>()
  for (const contact of contacts) {
    const phones = toPhoneArray(contact.phoneNumbers)
    for (const phone of phones) {
      const existing = phoneToContacts.get(phone) ?? []
      if (!existing.includes(contact.contactHubspotId ?? '')) {
        phoneToContacts.set(phone, [...existing, contact.contactHubspotId ?? ''])
      }
    }
  }

  const outbound = events.filter(e => e.direction === 'outbound')

  const phoneAttempts = new Map<string, CallAttempt[]>()
  for (const ev of outbound) {
    const num = ev.toNumber
    if (!num) continue
    const attempt: CallAttempt = {
      happenedAt: new Date(ev.happenedAt),
      outcome: normalizeOutcome(ev.outcome),
      durationSecs: ev.durationSecs,
      detailedOutcome: deriveDetailedOutcome(ev),
    }
    const list = phoneAttempts.get(num) ?? []
    list.push(attempt)
    phoneAttempts.set(num, list)
  }
  for (const list of phoneAttempts.values()) {
    list.sort((a, b) => a.happenedAt.getTime() - b.happenedAt.getTime())
  }

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
        lastDetailedOutcome: last?.detailedOutcome ?? null,
        lastCalledAt: last?.happenedAt ?? null,
        everAnswered: attempts.some(a => a.outcome === 'answered'),
      }
    })
    return {
      contactHubspotId: contact.contactHubspotId,
      name: contact.name,
      contactType: contact.contactType,
      phones: phoneOutreaches,
      reached: phoneOutreaches.some(p => p.everAnswered),
      totalAttempts: phoneOutreaches.reduce((n, p) => n + p.attempts.length, 0),
    }
  })

  const dayAgg = new Map<string, {
    calls: number
    answered: number
    conversationCount: number
    voicemailCount: number
    deadLineCount: number
    contactIds: Set<string>
    sessionCalls: SessionCall[]
  }>()

  for (const ev of outbound) {
    if (!ev.toNumber) continue
    const date = new Date(ev.happenedAt).toISOString().slice(0, 10)
    const outcome = normalizeOutcome(ev.outcome)
    const detailed = deriveDetailedOutcome(ev)

    const entry = dayAgg.get(date) ?? {
      calls: 0, answered: 0, conversationCount: 0, voicemailCount: 0,
      deadLineCount: 0, contactIds: new Set(), sessionCalls: [],
    }
    entry.calls++

    if (outcome === 'answered') {
      entry.answered++
      const contactIds = phoneToContacts.get(ev.toNumber) ?? []
      for (const id of contactIds) entry.contactIds.add(id)
    }
    if (detailed === 'conversation') entry.conversationCount++
    if (detailed === 'voicemail_msg_left' || detailed === 'voicemail_full' || detailed === 'voicemail_no_msg') {
      entry.voicemailCount++
    }
    if (detailed === 'dead_line') entry.deadLineCount++

    const contactIds = phoneToContacts.get(ev.toNumber) ?? []
    const firstContactId = contactIds[0] ?? null
    const contactName = firstContactId ? (contactById.get(firstContactId)?.name ?? null) : null

    entry.sessionCalls.push({
      activityEventId: ev.id ?? 0,
      happenedAt: new Date(ev.happenedAt),
      displayTime: formatUserLocalTime(ev.userLocalTime),
      userLocalTime: ev.userLocalTime ?? null,
      contactName,
      contactHubspotId: firstContactId,
      phoneNumber: ev.toNumber,
      durationSecs: ev.durationSecs,
      outcome,
      detailedOutcome: detailed,
      transcript: ev.transcript ?? null,
      displaySummary: buildDisplaySummary(ev),
      transcriptClassification: ev.transcriptClassification ?? null,
      transcriptStatus: buildTranscriptStatus(ev),
    })

    dayAgg.set(date, entry)
  }

  const days: OutreachDay[] = [...dayAgg.entries()]
    .sort(([a], [b]) => b.localeCompare(a))  // newest first
    .map(([date, { calls, answered, conversationCount, voicemailCount, deadLineCount, contactIds, sessionCalls }]) => ({
      date,
      callCount: calls,
      answeredCount: answered,
      conversationCount,
      voicemailCount,
      deadLineCount,
      contactsReached: [...contactIds]
        .map(id => contactById.get(id)?.name ?? null)
        .filter((n): n is string => n !== null),
      calls: sessionCalls.sort((a, b) => {
        // Sort by raw HH:MM:SS (24h) — alphabetical = chronological for this format
        if (a.userLocalTime && b.userLocalTime) return a.userLocalTime.localeCompare(b.userLocalTime)
        return a.happenedAt.getTime() - b.happenedAt.getTime()
      }),
    }))

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
  const [contacts, rawEvents] = await Promise.all([
    prisma.dealContact.findMany({
      where: { dealHubspotId },
      select: { contactHubspotId: true, name: true, contactType: true, phoneNumbers: true },
    }),
    prisma.activityEvent.findMany({
      where: { dealHubspotId, source: ActivitySource.JUSTCALL },
      select: {
        id: true,
        happenedAt: true,
        direction: true,
        outcome: true,
        toNumber: true,
        fromNumber: true,
        durationSecs: true,
        rawPayload: true,
        transcript: {
          select: { transcript: true, summary: true, classification: true },
        },
      },
      orderBy: { happenedAt: 'asc' },
    }),
  ])

  const events: RawEvent[] = rawEvents.map(ev => {
    const raw = ev.rawPayload as Record<string, unknown> | null
    return {
      id: ev.id,
      happenedAt: ev.happenedAt,
      userLocalTime: (raw?.call_user_time as string | null | undefined) ?? null,
      direction: ev.direction,
      outcome: ev.outcome,
      toNumber: ev.toNumber,
      fromNumber: ev.fromNumber,
      durationSecs: ev.durationSecs,
      transcript: ev.transcript?.transcript ?? null,
      transcriptSummary: ev.transcript?.summary ?? null,
      transcriptClassification: ev.transcript?.classification ?? null,
      hasRecording: !!(raw?.call_info && (raw.call_info as Record<string, unknown>)?.recording),
    }
  })

  return computeOutreachMatrix(dealHubspotId, contacts, events)
}

// ── Classification helpers (exported for tests) ────────────────────────────────

// Derive rich outcome from JustCall basic outcome + transcript analysis.
// The 'outcome' field from JustCall distinguishes answered/voicemail/no_answer/busy.
// Transcript classification further splits 'answered' into live/voicemail/disconnected.
export function deriveDetailedOutcome(ev: RawEvent): DetailedOutcome {
  const outcome = normalizeOutcome(ev.outcome)

  if (outcome === 'no_answer') return 'no_answer'
  if (outcome === 'busy') return 'busy'

  // JustCall's own voicemail detection (AMD or similar) — separate from 'answered'
  if (outcome === 'voicemail') {
    if (ev.transcript && ev.transcriptClassification === 'voicemail') {
      return classifyVoicemailSubtype(ev.transcript)
    }
    // No transcript — JustCall detected voicemail but we have no recording to check
    return 'voicemail_msg_left' // default: assume message was left
  }

  // 'answered' — JustCall says something picked up (could be live, VM, or dead line)
  if (!ev.transcript) {
    if ((ev.durationSecs ?? 0) < 4) return 'brief_answered'
    if (ev.hasRecording === false) return 'recording_unavailable'
    return 'pending_transcript'
  }

  const cls = ev.transcriptClassification
  if (cls === 'live') {
    // Gate: < 8s classified as "live" is almost certainly a misclassification —
    // Whisper often partially transcribes VM greetings (e.g. drops "un-" from
    // "unable to take your call"), making the classifier see live speech.
    // A real back-and-forth exchange is never under 8 seconds.
    if ((ev.durationSecs ?? 0) < 8) return 'brief_answered'
    return 'conversation'
  }
  if (cls === 'disconnected') return 'dead_line'
  if (cls === 'voicemail') return classifyVoicemailSubtype(ev.transcript)

  // classification = 'unknown' or null with a transcript
  if ((ev.durationSecs ?? 0) < 4) return 'brief_answered'
  return 'pending_transcript'
}

// Classify voicemail subtype from transcript content.
// Default is 'voicemail_msg_left' — we trust Kathleen always tries to leave a message.
// 'voicemail_no_msg' is a warning: should only appear if she hung up before leaving a message.
export function classifyVoicemailSubtype(
  transcript: string,
): 'voicemail_full' | 'voicemail_msg_left' | 'voicemail_no_msg' {
  if (/mailbox.{0,30}full/i.test(transcript) || /not accept.{0,20}messages/i.test(transcript)) {
    return 'voicemail_full'
  }
  // Any evidence a message was or could be left — includes Kathleen-drop monologue signals
  if (
    /leave.{0,20}message/i.test(transcript) ||
    /after the (beep|tone)/i.test(transcript) ||
    /at the tone/i.test(transcript) ||
    /record your message/i.test(transcript) ||
    /trying to (reach|contact|get in contact)/i.test(transcript) ||
    /please (give us a call|call (me|us) back|return (my|our) call)/i.test(transcript)
  ) {
    return 'voicemail_msg_left'
  }
  // Voicemail greeting found but no message-left signal — likely hung up
  if (/not available/i.test(transcript) || /unable to take/i.test(transcript)) {
    return 'voicemail_no_msg'
  }
  return 'voicemail_msg_left' // default: trust the employee
}

// ── Private helpers ────────────────────────────────────────────────────────────

function toPhoneArray(raw: unknown): string[] {
  if (!Array.isArray(raw)) return []
  const seen = new Set<string>()
  return raw
    .filter((v): v is string => typeof v === 'string')
    .map(v => {
      const digits = v.replace(/\D/g, '')
      if (digits.length === 11 && digits.startsWith('1')) return `+1${digits.slice(1)}`
      if (digits.length === 10) return `+1${digits}`
      return v
    })
    .filter(v => {
      if (seen.has(v)) return false
      seen.add(v)
      return true
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

// Format "HH:MM:SS" 24h → "12:17 PM" for display. Returns null if input absent.
function formatUserLocalTime(raw: string | null | undefined): string | null {
  if (!raw) return null
  const parts = raw.split(':')
  if (parts.length < 2) return null
  let hour = parseInt(parts[0], 10)
  const min = parts[1]
  if (isNaN(hour)) return null
  const ampm = hour >= 12 ? 'PM' : 'AM'
  if (hour > 12) hour -= 12
  if (hour === 0) hour = 12
  return `${hour}:${min} ${ampm}`
}

function buildTranscriptStatus(ev: RawEvent): SessionCall['transcriptStatus'] {
  if (ev.transcript) return 'available'
  if ((ev.durationSecs ?? 0) < 4) return 'too_short'
  if (ev.hasRecording === false) return 'no_recording'
  return 'not_started'
}

// Build display summary. Uses classifyVoicemailSubtype for voicemail calls.
function buildDisplaySummary(ev: RawEvent): string | null {
  if (ev.transcriptSummary) return ev.transcriptSummary

  const cls = ev.transcriptClassification
  const transcript = ev.transcript

  if (cls === 'disconnected') {
    return 'Number appears disconnected or no longer in service.'
  }

  if (cls === 'voicemail' && transcript) {
    const subtype = classifyVoicemailSubtype(transcript)
    if (subtype === 'voicemail_full') return 'Reached voicemail — mailbox full, no message could be left.'
    if (subtype === 'voicemail_msg_left') return 'Reached voicemail — left a callback message.'
    if (subtype === 'voicemail_no_msg') return 'Reached voicemail — person not available, no message left.'
    return 'Reached voicemail.'
  }

  if (cls === 'live') return null // live call pending AI summary

  return null
}
