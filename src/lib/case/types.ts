export type CaseEventSource = 'hubspot' | 'justcall' | 'google' | 'user' | 'ai'
export type CaseEventType = 'call' | 'email' | 'note' | 'task' | 'document' | 'sms'
export type CaseEventCategory =
  | 'attorney_activity'   // email/note involving attorney
  | 'client_contact'      // answered call with owner/heir
  | 'document_received'   // note or event indicating document arrival
  | 'internal_note'       // user-authored note with no specific keyword match
  | 'follow_up'           // task or voicemail
  | 'outreach_attempt'    // outbound unanswered call
  | 'uncategorized'       // fallback

export type CaseEvent = {
  id: string                                        // `${source}:${sourceId}`
  happenedAt: Date
  source: CaseEventSource
  type: CaseEventType
  category: CaseEventCategory
  participants: string[]                            // human-readable names/emails
  outcome: string | null                            // answered, voicemail, sent, received, etc.
  summary: string | null                            // body excerpt (120 chars) or auto-label
  durationSecs: number | null                       // calls only
  rawRef: { table: string; id: number | string }   // link back to source row
}

export type StoryDay = {
  date: string                      // 'YYYY-MM-DD' in America/New_York
  categories: CaseEventCategory[]   // deduplicated, for semantic labels
  eventCount: number
  latestEventSummary: string | null // newest event's summary — Date | Label | Latest Event column
  events: CaseEvent[]               // full events on expand
  outcome?: string | null           // reserved — not populated in M12; future human curation or M15+ inference
}

export type CaseHealthStatus = 'active' | 'waiting' | 'blocked' | 'on_track' | 'unknown'

// Operational state of the case. Today sourced from AiSummary.
// Designed to accept future sources: human edits, CaseFacts, Tasks, workflow rules.
export type CurrentState = {
  status: string | null               // "Waiting on County Attorney"
  health: CaseHealthStatus
  blocker: string | null              // "County response pending"
  nextAction: string | null           // "Follow up next Tuesday"
  lastMeaningfulActivity: string | null
  openTaskCount: number
  generatedAt: Date | null
  source: 'ai' | 'human' | null
}
