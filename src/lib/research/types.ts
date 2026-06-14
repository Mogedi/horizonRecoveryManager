// Research agent contracts (v2). See docs/research-agent-design.md.
//
// The seam between Hermes (runtime) and Horizon (business brain) is two contracts:
//   • EvidencePackage — what Hermes writes. IMMUTABLE, provenance-tracked, NO business objects.
//   • Dossier         — what Horizon DERIVES from a package. Re-derivable; never authored by Hermes.
import type { CaseType } from './case-type'
export type { CaseType } from './case-type' // re-export so the contract's consumers import case type from one place

export type Goal = 'locate_owner' | 'find_heirs' | 'mailing_address' | 'contact' | 'property_records'

export interface PersonQuery {
  name: string
  address?: string
  city?: string
  state?: string // anchor; defaults to GA
  ageHint?: number
  relativesHint?: string[]
  parcelId?: string
  county?: string
  zip?: string
  goal?: Goal
  caseType?: CaseType // the run's category (tax_sale | mortgage_foreclosure | state_funds | estate_sale | unknown) — drives the research profile
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
  | { kind: 'property'; value: PropertyValue; provenance: Provenance }
  | { kind: 'lien'; value: LienValue; provenance: Provenance }
  | { kind: 'tax_event'; value: TaxEventValue; provenance: Provenance }
  | { kind: 'transaction'; value: TransactionValue; provenance: Provenance }
  | { kind: 'note'; value: { text: string }; provenance: Provenance }

// Property-record facts (captured AS STATED; owner-match / surplus relevance are DERIVED, never here).
// normalizedOwner = lowercased/trimmed/punctuation-stripped owner name — the key derivation uses to
// compare owner-of-record against the subject/heirs (the surplus-case "record owner ≠ claimant" check).
export interface PropertyValue {
  owner: string
  normalizedOwner?: string // derivation key (owner-vs-claimant match); computed in derive if the agent omits it
  parcelId?: string
  situsAddress?: string
  deedBook?: string
  deedPage?: string
  assessedValue?: number
  landUse?: string
  lastSaleDate?: string
  lastSalePrice?: number
  taxStatus?: string // AS STATED by the source ("delinquent", "current") — not interpreted
}
export interface LienValue {
  holder: string
  normalizedHolder?: string
  amount?: number
  recordedDate?: string
  instrumentType?: string // e.g. "tax lien", "mortgage", "judgment" — as stated
  released?: boolean      // true if the source says it's satisfied/released/cancelled — as stated
  deedBook?: string
  deedPage?: string
}
export type TaxEventKind = 'tax_sale' | 'tax_deed' | 'redemption' | 'delinquency'
export interface TaxEventValue {
  kind: TaxEventKind
  date?: string
  amount?: number
  surplusStated?: number // the surplus figure AS STATED by the source — never computed here
  deedBook?: string
  deedPage?: string
}
// A deed/transaction in the property's chain — proves how the subject is tied (often as a PRIOR owner).
export type TransactionType = 'sale' | 'deed' | 'foreclosure' | 'tax_sale' | 'other'
export interface TransactionValue {
  date?: string
  type?: TransactionType
  grantor?: string // seller / party transferring out (the subject, when they lost the property)
  grantee?: string // buyer / party receiving
  price?: number
  deedBook?: string
  deedPage?: string
}

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
  type: 'death_date' | 'living_status' | 'relationship' | 'address' | 'identity' | 'ownership' | 'other'
  description: string
  evidenceIds: number[] // indices into EvidencePackage.evidence
}

// Derived property dossier (Phase P-B/V1). Built from property/lien/tax_event/transaction evidence; all
// match/linkage/total/surplus-relevance/coverage is DERIVED here, never captured. Stated dollar figures
// stay labeled "stated" — we never compute a surplus.
export interface PropertyLien { holder: string; amount?: number; recordedDate?: string; instrumentType?: string; released?: boolean; evidenceId: number }
export interface PropertyTaxEvent { kind: TaxEventKind; date?: string; amount?: number; surplusStated?: number; evidenceId: number }
export interface PropertyTransaction { date?: string; type?: TransactionType; grantor?: string; grantee?: string; price?: number; deedBook?: string; deedPage?: string; evidenceId: number }

// V1 — subject ↔ property linkage. The subject is OFTEN a prior owner (lost the property at sale → owed
// the surplus), so "current owner == claimant" is the wrong test. We answer "is the subject tied, and how".
export type LinkageType = 'current_owner' | 'prior_owner' | 'related_party' | 'possible' | 'unlinked'
export type RelationshipBasis = 'deed_history' | 'tax_record' | 'probate_record' | 'court_record' | 'marriage_record' | 'trust_record' | 'corporate_record' | 'manual_inference'
// Another candidate parcel the agent considered — ranked by TRANSPARENT signals, never a confidence %.
export interface PropertyCandidate { parcelId?: string; situsAddress?: string; owner?: string; signals: string[]; sourceIds: string[] }
export interface PropertyLinkage {
  type: LinkageType
  linkedThrough?: { name: string; relationshipAsStated?: string } // for related_party: the owner they connect through
  relationshipBasis: RelationshipBasis[] // DERIVED from the evidence kinds backing the linkage
  evidence: string[]                     // human-readable support ("subject is grantor in 2019 deed, Book 123 Pg 45")
  corroboratingSources: number           // distinct sources agreeing on the linkage key
  band: Band
  alternatives: PropertyCandidate[]      // other parcels considered (catch wrong matches on common names)
}
// V1 — research coverage ("how hard did we look?"), DERIVED from telemetry + plan.steps. Distinct from
// confidence. A checklist, not a score: searched-but-empty is different from never-attempted.
export type CoverageStatus = 'searched' | 'empty' | 'not_attempted'
export interface CoverageItem { label: string; status: CoverageStatus }
export interface PropertyCoverage { items: CoverageItem[]; transactionsFound: number }

export interface PropertyRecord {
  parcelId?: string
  situsAddress?: string
  ownerOfRecord?: string
  assessedValue?: number
  taxStatus?: string
  ownerMatchesSubject: boolean | null // normalizedOwner vs subject/heirs; null when no owner captured
  linkage: PropertyLinkage | null     // V1 — how the subject is tied to the parcel
  transactions: PropertyTransaction[] // V1 — deed/ownership chain
  coverage: PropertyCoverage          // V1 — how hard we looked
  liens: PropertyLien[]
  lienTotalStated?: number             // sum of AS-STATED lien amounts (undefined if none stated)
  taxEvents: PropertyTaxEvent[]
  surplusRelevant: boolean             // a tax_sale / tax_deed event is present
  surplusStated?: number               // max surplus a source PRINTED (labeled "stated", never computed)
  documents: { kind: string; sourceUrl: string }[]
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
  propertyRecord: PropertyRecord | null // P-B: null until a property_records run adds property evidence
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
