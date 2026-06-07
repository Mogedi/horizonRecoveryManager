// Shared interface for all phone call integrations.
// JustCall implements this. RingCentral, GoHighLevel, or any future provider
// implements the same interface — sync code calls getCallLogs() without knowing
// which provider it is talking to.

export interface NormalizedCallLog {
  externalId: string          // Provider-specific call ID (always string — IDs can be large numbers)
  happenedAt: Date            // UTC
  durationSecs: number | null
  direction: 'inbound' | 'outbound'
  outcome: 'answered' | 'voicemail' | 'no_answer' | 'busy'
  contactNumberE164: string   // Customer's phone number (E.164) — used for deal matching
  lineNumberE164: string      // Business JustCall line number (E.164)
  agentId: string | null      // Provider's agent/user identifier
  agentName: string | null
  notes: string | null        // Call notes if any
  rawPayload: unknown
}

export interface PhoneProvider {
  getCallLogs(since: Date, until: Date): Promise<NormalizedCallLog[]>
}
