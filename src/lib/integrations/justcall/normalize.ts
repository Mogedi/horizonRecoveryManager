import type { JustCallCall } from './types'
import type { NormalizedCallLog } from '@/lib/integrations/phone-provider'

// Normalize a raw US phone number string to E.164 format (+1XXXXXXXXXX).
// Returns null if the string cannot be a valid US number (< 10 digits after stripping).
// Handles: +14045551234, 14045551234, 4045551234, (404) 555-1234, 404-555-1234, etc.
// Only handles US numbers in v1 (10-digit local or 11-digit with leading 1).
export function normalizeToE164(raw: string | null | undefined): string | null {
  if (!raw) return null

  // Strip everything except digits
  const digits = raw.replace(/\D/g, '')

  if (digits.length === 11 && digits.startsWith('1')) {
    return `+1${digits.slice(1)}`
  }

  if (digits.length === 10) {
    return `+1${digits}`
  }

  // Reject anything else (too short = invalid, too long = international or garbage)
  return null
}

// Map JustCall call type string to our normalized outcome.
function mapOutcome(type: string): 'answered' | 'voicemail' | 'no_answer' | 'busy' {
  switch (type.toLowerCase()) {
    case 'answered': return 'answered'
    case 'voicemail': return 'voicemail'
    case 'busy': return 'busy'
    default: return 'no_answer' // Missed, Unanswered, No Answer, etc.
  }
}

// Convert a raw JustCall call record to our normalized format.
// Returns null if either phone number cannot be normalized (data quality issue — skip silently).
export function normalizeJustCallRecord(raw: JustCallCall): NormalizedCallLog | null {
  const contactE164 = normalizeToE164(raw.contact_number)
  const lineE164 = normalizeToE164(raw.justcall_number)

  // We need at least the contact number to be valid — it's our matching key.
  if (!contactE164) return null

  const direction = raw.call_info.direction === 'Incoming' ? 'inbound' : 'outbound'

  return {
    externalId: String(raw.id),
    happenedAt: new Date(raw.call_date),
    durationSecs: raw.call_duration?.total_duration ?? null,
    direction,
    outcome: mapOutcome(raw.call_info.type),
    contactNumberE164: contactE164,
    lineNumberE164: lineE164 ?? contactE164, // fallback to contact if line can't normalize
    agentId: raw.agent_id != null ? String(raw.agent_id) : null,
    agentName: raw.agent_name ?? null,
    notes: raw.call_info.notes ?? null,
    rawPayload: raw,
  }
}
