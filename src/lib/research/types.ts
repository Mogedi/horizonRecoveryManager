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
  lastReportedAt?: string // recency signal from the source ("last reported 2023"), for ranking
}

// ── Captured-fact enums (Hermes writes these; interpretation is DERIVED, never captured) ─────────
// What KIND of source a fact came from. Powers source-category analytics AND the derived
// evidenceStrength mapping (see derive.ts) — strength itself is NEVER captured by the agent.
export type SourceType = 'obituary' | 'people_search' | 'property' | 'government' | 'crm' | 'probate' | 'funeral' | 'other'
export type DeceasedStatus = 'living' | 'deceased' | 'unknown'
// Best-effort grouping bucket. `relationshipAsStated` is the source of truth; this is for grouping only.
// `grandchild` covers any descendant generation below child (great-grandchildren map here too — we don't
// split generations); `grandparent` covers ascendants above parent.
export type RelationCategory = 'parent' | 'sibling' | 'spouse' | 'child' | 'grandchild' | 'grandparent' | 'cousin' | 'extended' | 'friend' | 'unknown'
// Designed for the future phone-validation API: it flips unverified → valid/stale/invalid. Default 'unverified'.
export type ContactMethodStatus = 'unverified' | 'valid' | 'stale' | 'invalid'

// ── Evidence (Hermes → Horizon) ────────────────────────────────────────────────
// Every claim carries provenance. Evidence is the permanent asset; business objects are derived.
export interface Provenance {
  sourceId: string // DATA-SOURCE host, NEVER the tool — e.g. 'qpublic:gordon', 'fastpeoplesearch', 'legacy.com'
  sourceType: SourceType // captured fact: what KIND of source this is
  url: string
  retrievedAt: string // ISO
  sourceText: string // RAW QUOTE — the exact snippet supporting this item (required so it can't be skipped)
  isFromCrm?: boolean // true if this came from our CRM, not external research
  documentId?: number // if backed by a captured document
}

// normalizedName = lowercased, trimmed, punctuation-stripped name — the identity key for
// person-level idempotency (get_prior_evidence). Capture now; the cross-case merge engine is deferred.
export type EvidenceItem =
  | { kind: 'identity'; value: { name: string; normalizedName: string; maidenName?: string; ageOrDob?: string; deceasedStatus?: DeceasedStatus }; provenance: Provenance }
  | { kind: 'address'; value: Address; provenance: Provenance }
  | { kind: 'phone'; value: { number: string; label?: string; lastReportedAt?: string; contactMethodStatus?: ContactMethodStatus }; provenance: Provenance }
  | { kind: 'email'; value: { address: string; lastReportedAt?: string; contactMethodStatus?: ContactMethodStatus }; provenance: Provenance }
  | { kind: 'relationship'; value: { person: string; normalizedName: string; relationshipAsStated: string; relationCategory?: RelationCategory; deceasedStatus?: DeceasedStatus; maidenName?: string }; provenance: Provenance }
  | { kind: 'deceased'; value: { deceasedStatus: DeceasedStatus; dateOfDeath?: string; basis: string }; provenance: Provenance }
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
  reason?: string // WHY this search — e.g. "'survived by several cousins' + maternal Meeks branch"
  status: 'planned' | 'done' | 'failed' | 'blocked' | 'replanned'
}
export interface ResearchPlan {
  goal: Goal
  steps: ResearchPlanStep[]
}

export type AttemptStatus = 'success' | 'blocked' | 'captcha' | 'empty' | 'error'
export type BlockReason = 'cloudflare' | 'captcha' | 'http_403' | 'http_429' | 'redirect' | 'empty' | 'parse'
export interface SourceAttempt {
  sourceId: string
  sourceType?: SourceType // what KIND of source was attempted — lets source intel group blocked/empty tries
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

// ── v3 derived structures (Phase B) ─────────────────────────────────────────────
// evidenceStrength is DERIVED from sourceType (never captured) — see strengthOf() in derive.ts.
export type EvidenceStrength = 'strong' | 'medium' | 'weak'
export type ContactRank = 'high' | 'medium' | 'low'

// One ranked contact datum. We keep ALL of them — never collapse to a single "best" phone.
export interface RankedContact {
  value: string
  label?: string
  rank: ContactRank
  sources: string[] // distinct sourceIds asserting it (corroboration)
  strength: EvidenceStrength // strongest source backing it
  lastReportedAt?: string // recency signal, when the source provides it
  contactMethodStatus?: ContactMethodStatus
  reason: string // transparent, human-readable ("2 sources, last reported 2024")
}

export interface ChecklistItem { label: string; present: boolean }
export interface ConfidenceChecklist {
  band: Band
  checklist: ChecklistItem[] // ✓/✗ evidence present — explainable, no false precision
  explanation: string
  score: number // internal sortable heuristic; UI shows the checklist + band
}

// A person we can act on NOW (living/unknown + at least one contact method). All contacts kept + ranked.
export interface ActionableContact {
  localId: string
  name: string | null
  normalizedName: string
  relationshipAsStated?: string
  relationCategory?: RelationCategory
  phones: RankedContact[]
  addresses: RankedContact[]
  emails: RankedContact[]
  confidence: ConfidenceChecklist
}

// A family member — EVERYONE (living + deceased), for understanding the family/surnames. Informational.
export interface FamilyMember {
  name: string
  normalizedName: string
  relationshipAsStated: string
  relationCategory: RelationCategory
  deceasedStatus: DeceasedStatus
  maidenName?: string
  isFromCrm: boolean
  confidence: ConfidenceChecklist // per-relationship confidence (each relationship explains itself)
}
export interface FamilyStructure { members: FamilyMember[] } // view groups by relationCategory

export interface Conflict {
  type: 'death_date' | 'living_status' | 'relationship' | 'address' | 'identity' | 'other'
  description: string
  evidenceIds: number[] // indices into EvidencePackage.evidence
}

export interface Completeness {
  deathConfirmed: boolean
  closeFamilyIdentified: boolean // NOT "direct descendants" — avoids implying a legal heir class
  contactsFound: boolean
  propertyConfirmed: boolean
}

export interface TimelineStep {
  n: number
  intent: string
  reason?: string // WHY this search ran (from plan step)
  source?: string
  status: ResearchPlanStep['status'] // done | failed | replanned | planned (failed = saved failed search)
}

export interface SourceIntelEntry {
  sourceType: SourceType | 'unknown'
  items: number // evidence items contributed
  sources: string[] // distinct sourceIds of this type
  attempts: number // matching source_attempts (telemetry), when present
}

export interface Dossier {
  subject: { name: string; deceased: boolean | null; dateOfDeath?: string }
  heirGraph: HeirGraph
  candidatePeople: ScoredCandidate[]
  contactRankings: ContactRanking[]
  confidence: Confidence
  // v3 additions (Phase B) — additive so older dossiers + the current view stay valid.
  actionableContacts: ActionableContact[]
  familyStructure: FamilyStructure
  completeness: Completeness
  conflicts: Conflict[]
  timeline: TimelineStep[]
  sourceIntel: SourceIntelEntry[]
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
