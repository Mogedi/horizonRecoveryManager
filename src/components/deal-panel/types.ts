// Shared types for DealPanel and its sub-components.
// All types exported here; sub-components import from here only.

import type { DealEnriched } from '@/lib/db/analytics'
import type { SummaryJson } from '@/lib/ai/summary'
export type { SummaryJson }

export type Activity = {
  id: number
  type: string
  body: string | null
  authorName: string | null
  authorOwnerId: string | null
  direction: string | null
  timestamp: string | null
  metadata: unknown
}

export type Contact = {
  id: number
  contactHubspotId: string | null
  name: string | null
  contactType: string | null
  ownershipStatus: string | null
  isDeceased: boolean
  doNotContact: boolean
  phoneNumbers: string[]
  emailList: string[]
  address: string | null
  city: string | null
  state: string | null
  zip: string | null
}

export type ContactStats = {
  totalCalls: number
  conversations: number
  lastConversationDate: string | null  // ISO string
  lastCallDate: string | null          // ISO string
  bestPhone: string | null
  bestPhoneSource: 'inferred'
}

export type ContactCall = {
  id: number
  happenedAt: string  // ISO string
  direction: string | null
  outcome: string | null
  durationSecs: number | null
}

export type Snooze = {
  id: number
  category: string
  freeformNote: string | null
  snoozeUntil: string
  createdAt: string
}

export type SnoozeHistoryItem = Snooze & { wokeAt: string | null }

export type DealDetail = {
  hubspotId: string
  name: string | null
  stage: string | null
  stageName: string | null
  ownerName: string | null
  amount: number | null
  hubspotUrl: string | null
  propertyAddress: string | null
  county: string | null
  parcelId: string | null
  taxSaleDate: string | null
  contactCount: number
  lastActivityDate: string | null
  syncedAt: string
}

export type PanelData = {
  deal: DealDetail
  activities: Activity[]
  contacts: Contact[]
  snooze: Snooze | null
  snoozeHistory: SnoozeHistoryItem[]
  layer2SyncedAt: string | null
  summaryData: { json: SummaryJson; generatedAt: string } | null
  enriched: DealEnriched | null
}

export type DetailedOutcome =
  | 'conversation'
  | 'voicemail_msg_left'
  | 'voicemail_full'
  | 'voicemail_no_msg'
  | 'dead_line'
  | 'no_answer'
  | 'busy'
  | 'brief_answered'
  | 'pending_transcript'
  | 'recording_unavailable'

export type OutreachPhone = {
  numberE164: string
  attempts: { happenedAt: string; outcome: string; durationSecs: number | null; detailedOutcome: DetailedOutcome }[]
  lastOutcome: 'answered' | 'voicemail' | 'no_answer' | 'busy' | null
  lastDetailedOutcome: DetailedOutcome | null
  lastCalledAt: string | null
  everAnswered: boolean
}

export type OutreachContact = {
  contactHubspotId: string | null
  name: string | null
  contactType: string | null
  phones: OutreachPhone[]
  reached: boolean
  totalAttempts: number
}

export type SessionCall = {
  activityEventId: number
  happenedAt: string
  displayTime: string | null
  userLocalTime: string | null
  contactName: string | null
  contactHubspotId: string | null
  phoneNumber: string
  durationSecs: number | null
  outcome: 'answered' | 'voicemail' | 'no_answer' | 'busy'
  detailedOutcome: DetailedOutcome
  transcript: string | null
  displaySummary: string | null
  transcriptClassification: string | null
  transcriptStatus: 'available' | 'too_short' | 'no_recording' | 'not_started'
}

export type OutreachDay = {
  date: string
  callCount: number
  answeredCount: number
  conversationCount: number
  voicemailCount: number
  deadLineCount: number
  contactsReached: string[]
  calls: SessionCall[]
}

export type OutreachMatrix = {
  outreachDays: number
  totalOutboundCalls: number
  contactsTotal: number
  contactsReached: number
  lastCalledAt: string | null
  contacts: OutreachContact[]
  days: OutreachDay[]
}

export const SNOOZE_CATEGORY_LABELS: Record<string, string> = {
  waiting_on_attorney: 'Waiting on Attorney',
  waiting_on_county: 'Waiting on County',
  waiting_on_client: 'Waiting on Client',
  waiting_on_documents: 'Waiting on Documents',
  waiting_on_probate: 'Waiting on Probate',
  filed_normal_wait: 'Filed — Normal Wait',
  other: 'Other',
}
