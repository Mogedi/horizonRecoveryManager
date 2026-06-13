// Core contracts for the research agent (find_person). See docs/research-agent-design.md.
// The browser is infrastructure; these types are the product (candidates → resolution → evidence).

export type Goal = 'locate_owner' | 'find_heirs' | 'mailing_address' | 'contact'

export interface PersonQuery {
  name: string
  address?: string
  city?: string
  state?: string // the property = our anchor; defaults to GA at the entry point
  ageHint?: number
  relativesHint?: string[]
  parcelId?: string
  county?: string
  goal?: Goal
  caseId?: string | null // deal hubspot_id when tied to a deal; null for ad-hoc searches
}

export type AddressKind = 'current' | 'prior' | 'property' | 'mailing'
export interface Address {
  line1: string
  city?: string
  state?: string
  zip?: string
  kind: AddressKind
}

// The common shape EVERY source adapter returns — sources are swappable behind this.
export interface Candidate {
  sourceId: string
  url: string
  name: string | null
  addresses: Address[]
  phones: string[]
  emails: string[]
  relatives: string[]
  ageOrDob: string | null
  deceased: boolean | null
  signals: string[] // raw signals this source asserts (free text)
  raw?: unknown // raw extracted blob, for audit
}

export type AttemptStatus = 'success' | 'blocked' | 'captcha' | 'empty' | 'error'
export type BlockReason = 'cloudflare' | 'captcha' | 'http_403' | 'http_429' | 'redirect' | 'empty' | 'parse'

// Telemetry — emitted on EVERY adapter call, success or not.
export interface SourceAttempt {
  sourceId: string
  caseId?: string | null
  status: AttemptStatus
  blockReason?: BlockReason
  url?: string
  latencyMs: number
  candidateCount: number
  proxyUsed: boolean
  timestamp: Date
}

export interface SourceResult {
  attempt: SourceAttempt
  candidates: Candidate[]
}

export type SourceKind = 'property' | 'tax' | 'deed' | 'probate' | 'obituary' | 'people_search' | 'social'

export interface RunContext {
  proxyUsed: boolean
  // dev/test hook: adapters resolve unstructured pages through this when set, else the default LLM extractor.
  signal?: AbortSignal
}

export interface SourceAdapter {
  id: string
  label: string
  kind: SourceKind
  coverage: { states?: string[]; counties?: string[] }
  enabled: boolean
  // Adapters never throw for an expected block — they return a SourceResult whose attempt.status says so.
  search(query: PersonQuery, ctx: RunContext): Promise<SourceResult>
}

export type Band = 'high' | 'medium' | 'low' | 'conflicting'
export interface EvidenceItem {
  signal: string
  sources: string[] // independence tracking — corroboration weights by DISTINCT sources, not count
  weight: number
  note: string
}
export interface Resolution {
  band: Band
  score: number // sortable heuristic, NOT a probability
  best: Candidate | null // merged best-evidence record
  evidence: EvidenceItem[]
  conflicts: EvidenceItem[]
  ambiguities: string[]
}

export interface Dossier {
  caseId?: string | null
  query: PersonQuery
  resolution: Resolution
  candidates: Candidate[]
  attempts: SourceAttempt[]
  createdAt: Date
}
