// Research agent contracts (v2). See docs/research-agent-design.md.
//
// The seam between Hermes (runtime) and Horizon (business brain) is two contracts:
//   • EvidencePackage — what Hermes writes. IMMUTABLE, provenance-tracked, NO business objects.
//   • Dossier         — what Horizon DERIVES from a package. Re-derivable; never authored by Hermes.

export type Goal = 'locate_owner' | 'find_heirs' | 'mailing_address' | 'contact'

export interface PersonQuery {
  name: string
  address?: string
  city?: string
  state?: string // anchor; defaults to GA
  ageHint?: number
  relativesHint?: string[]
  parcelId?: string
  county?: string
  goal?: Goal
  caseId?: string | null // deal hubspot_id when tied to a deal; null for ad-hoc
}

export type AddressKind = 'current' | 'prior' | 'property' | 'mailing'
export interface Address {
  line1: string
  city?: string
  state?: string
  zip?: string
  kind: AddressKind
}

// ── Evidence (Hermes → Horizon) ────────────────────────────────────────────────
// Every claim carries provenance. Evidence is the permanent asset; business objects are derived.
export interface Provenance {
  sourceId: string // e.g. 'qpublic:gordon', 'fastpeoplesearch', 'legacy.com'
  url: string
  retrievedAt: string // ISO
  snippet?: string // the raw text the claim came from
  documentId?: number // if backed by a captured document
}

export type EvidenceItem =
  | { kind: 'identity'; value: { name: string; ageOrDob?: string }; provenance: Provenance }
  | { kind: 'address'; value: Address; provenance: Provenance }
  | { kind: 'phone'; value: { number: string; label?: string }; provenance: Provenance }
  | { kind: 'email'; value: { address: string }; provenance: Provenance }
  | { kind: 'relationship'; value: { person: string; relationToSubject: string }; provenance: Provenance }
  | { kind: 'deceased'; value: { isDeceased: boolean; dateOfDeath?: string; basis: string }; provenance: Provenance }
  | { kind: 'property'; value: { parcelId?: string; owner: string; situsAddress?: string; deedBook?: string }; provenance: Provenance }
  | { kind: 'note'; value: { text: string }; provenance: Provenance }

export type EvidenceKind = EvidenceItem['kind']

// Hermes's grouping of evidence into people (best-effort; Horizon re-resolves authoritatively).
export interface CandidatePerson {
  localId: string
  name: string | null
  evidenceRefs: number[] // indices into EvidencePackage.evidence
}

export interface ResearchPlanStep {
  n: number
  intent: string
  source?: string
  status: 'planned' | 'done' | 'failed' | 'replanned'
}
export interface ResearchPlan {
  goal: Goal
  steps: ResearchPlanStep[]
}

export type AttemptStatus = 'success' | 'blocked' | 'captcha' | 'empty' | 'error'
export type BlockReason = 'cloudflare' | 'captcha' | 'http_403' | 'http_429' | 'redirect' | 'empty' | 'parse'
export interface SourceAttempt {
  sourceId: string
  requestId?: number | null
  caseId?: string | null
  status: AttemptStatus
  blockReason?: BlockReason
  url?: string
  latencyMs: number
  candidateCount: number
  proxyUsed: boolean
  timestamp: Date
}

export interface EvidencePackage {
  requestId: number
  query: PersonQuery
  plan: ResearchPlan
  candidates: CandidatePerson[]
  evidence: EvidenceItem[] // immutable corpus
  documents: { documentId: number; kind: string; sourceUrl: string }[]
  telemetry: SourceAttempt[]
  notes: string[]
  budget: { stepsUsed: number; sourcesHit: number; capHit: boolean }
  completedAt: string
}

// ── Derived business objects (Horizon only) ────────────────────────────────────
export type Band = 'high' | 'medium' | 'low' | 'conflicting'

export interface HeirGraphNode { id: string; name: string; relationToSubject?: string; deceased?: boolean }
export interface HeirGraphEdge { from: string; to: string; relation: string }
export interface HeirGraph { subject: string; nodes: HeirGraphNode[]; edges: HeirGraphEdge[] }

export interface ScoredCandidate {
  localId: string
  name: string | null
  score: number // sortable heuristic, not a probability
  phones: string[]
  emails: string[]
  addresses: Address[]
  relationToSubject?: string
  justification: { signal: string; sources: string[]; weight: number; note: string }[]
}

export interface ContactRanking { person: string; phones: string[]; emails: string[]; rank: number }

export interface Confidence {
  band: Band
  score: number
  justification: { signal: string; sources: string[]; weight: number; note: string }[]
  conflicts: { signal: string; sources: string[]; weight: number; note: string }[]
}

export interface Dossier {
  subject: { name: string; deceased: boolean | null; dateOfDeath?: string }
  heirGraph: HeirGraph
  candidatePeople: ScoredCandidate[]
  contactRankings: ContactRanking[]
  confidence: Confidence
  reviewStatus: 'pending' | 'approved' | 'rejected' | 'needs_more'
  generatedAt: string
}

// ── Queue + registry ───────────────────────────────────────────────────────────
export interface ResearchRequestInput {
  query: PersonQuery
  goal: Goal
  enqueuedBy: string
}

export interface CountySourceInput {
  state: string
  county: string
  sourceKind: 'property' | 'deed' | 'probate' | 'obituary'
  method: 'gis_api' | 'qpublic' | 'custom_site' | 'propertyradar'
  entryUrl: string
  searchHint: string
}
