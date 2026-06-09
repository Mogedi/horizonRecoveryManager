import type { CaseEventCategory } from './types'

export type ClassifierInput = {
  type: string
  body: string | null
  outcome: string | null
}

const ATTORNEY_KEYWORDS = [
  'attorney', 'counsel', 'law firm', 'esquire', ' esq ', 'esq.', 'esq,',
  'legal counsel', 'probate court', 'circuit court', 'lawyer', 'law office',
] as const

const DOCUMENT_KEYWORDS = [
  'received', 'uploaded', 'certificate', 'deed', 'title', 'signed', 'document',
  'notarized', 'affidavit', 'probate', 'certified', 'copy of', 'marriage cert',
  'death cert', 'tax deed', 'warranty deed',
] as const

function containsAny(text: string, keywords: readonly string[]): boolean {
  const lower = text.toLowerCase()
  return keywords.some(k => lower.includes(k))
}

// Rule-based event classifier. 7 categories, evaluated in priority order.
// Keep this intentionally small — if you reach category #10, ask: "Is this a CaseFact?"
export function categorizeEvent(input: ClassifierInput): CaseEventCategory {
  const body = input.body ?? ''

  // Priority 1: attorney activity — highest specificity, overrides everything else
  if (body && containsAny(body, ATTORNEY_KEYWORDS)) {
    return 'attorney_activity'
  }

  // Priority 2: document received
  if (body && containsAny(body, DOCUMENT_KEYWORDS)) {
    return 'document_received'
  }

  // Priority 3: client contact — answered call
  if (input.type === 'call' && input.outcome === 'answered') {
    return 'client_contact'
  }

  // Priority 4: internal note
  if (input.type === 'note') {
    return 'internal_note'
  }

  // Priority 5: follow-up — task or voicemail
  if (input.type === 'task') {
    return 'follow_up'
  }
  if (input.type === 'call' && input.outcome === 'voicemail') {
    return 'follow_up'
  }

  // Priority 6: outreach attempt — unanswered call
  if (input.type === 'call' && input.outcome !== null) {
    return 'outreach_attempt'
  }

  return 'uncategorized'
}
