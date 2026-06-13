// The derivation engine — Horizon's business brain. Turns an IMMUTABLE EvidencePackage into a
// Dossier (entity resolution → heir graph → claimant scoring → confidence). Pure + deterministic, so
// it can be re-run over stored evidence whenever the logic improves. Hermes never produces this.
import type {
  EvidencePackage, Dossier, Address, ScoredCandidate, HeirGraph, HeirGraphNode, HeirGraphEdge,
  ContactRanking, Confidence, PersonQuery, CandidatePerson,
  EvidenceStrength, SourceType, RankedContact, ContactRank, RelationCategory, DeceasedStatus,
  ContactMethodStatus, ActionableContact, FamilyStructure, FamilyMember, Conflict, Completeness,
  TimelineStep, SourceIntelEntry, ChecklistItem,
} from './types'
import { deriveBand, buildChecklist } from './confidence'

// Tunable, transparent signal weights (property is the anchor).
export const SIGNAL_WEIGHTS = {
  propertyAddress: 38, exactAddress: 34, city: 8, state: 4,
  nameExact: 24, nameStrong: 16, nameWeak: 6,
  relationship: 14, age: 10, phone: 6, email: 6,
} as const

type Justification = ScoredCandidate['justification']

export function normalize(s?: string | null): string {
  return (s ?? '').toLowerCase().replace(/[^a-z0-9 ]/g, ' ').replace(/\s+/g, ' ').trim()
}
export function nameSimilarity(a?: string | null, b?: string | null): number {
  const ta = new Set(normalize(a).split(' ').filter(Boolean))
  const tb = new Set(normalize(b).split(' ').filter(Boolean))
  if (!ta.size || !tb.size) return 0
  let inter = 0
  for (const t of ta) if (tb.has(t)) inter++
  return inter / Math.max(ta.size, tb.size)
}
const uniq = (xs: string[]) => [...new Set(xs.map(s => s.trim()).filter(Boolean))]

// ── evidenceStrength: DERIVED from sourceType (B7), never captured. Re-tunable here only. ──────────
export function strengthOf(t?: SourceType): EvidenceStrength {
  switch (t) {
    case 'probate': case 'government': case 'crm': return 'strong'
    case 'obituary': case 'funeral': case 'property': return 'medium'
    default: return 'weak' // people_search | other | undefined
  }
}
const STRENGTH_ORDER: Record<EvidenceStrength, number> = { strong: 3, medium: 2, weak: 1 }
function strongest(set: Set<EvidenceStrength>): EvidenceStrength {
  let best: EvidenceStrength = 'weak'
  for (const s of set) if (STRENGTH_ORDER[s] > STRENGTH_ORDER[best]) best = s
  return best
}
const recencyKey = (s?: string): number => {
  if (!s) return 0
  const t = Date.parse(s)
  return Number.isNaN(t) ? (Number(String(s).slice(0, 4)) || 0) : t
}

// One accumulated contact value across sources (we keep ALL values; this collapses dup assertions).
interface ContactAccum {
  value: string
  label?: string
  sources: Set<string>
  strengths: Set<EvidenceStrength>
  lastReportedAt?: string
  contactMethodStatus?: ContactMethodStatus
}
function accum(map: Map<string, ContactAccum>, key: string, value: string, sourceId: string,
  strength: EvidenceStrength, lastReportedAt?: string, status?: ContactMethodStatus, label?: string) {
  if (!key) return
  const a = map.get(key) ?? { value, label, sources: new Set<string>(), strengths: new Set<EvidenceStrength>() }
  a.sources.add(sourceId)
  a.strengths.add(strength)
  if (lastReportedAt && (!a.lastReportedAt || recencyKey(lastReportedAt) > recencyKey(a.lastReportedAt))) a.lastReportedAt = lastReportedAt
  if (status && status !== 'unverified') a.contactMethodStatus = status // a validated status wins
  else if (!a.contactMethodStatus) a.contactMethodStatus = status
  map.set(key, a)
}

// Rank a contact map → HIGH/MED/LOW by corroboration + strength + recency. Transparent reason, no
// false precision; keep every value, most-recent first within a rank.
function rankContacts(map: Map<string, ContactAccum>): RankedContact[] {
  const rankOrder: Record<ContactRank, number> = { high: 3, medium: 2, low: 1 }
  return [...map.values()].map((m): RankedContact => {
    const sources = [...m.sources]
    const strength = strongest(m.strengths)
    const rank: ContactRank = sources.length >= 2 || strength === 'strong' ? 'high' : strength === 'medium' ? 'medium' : 'low'
    const recency = m.lastReportedAt ? `, last reported ${m.lastReportedAt}` : ''
    const reason = `${sources.length} source${sources.length === 1 ? '' : 's'} (${sources.join(', ')})${recency}`
    return { value: m.value, label: m.label, rank, sources, strength, lastReportedAt: m.lastReportedAt, contactMethodStatus: m.contactMethodStatus, reason }
  }).sort((a, b) =>
    rankOrder[b.rank] - rankOrder[a.rank] ||
    recencyKey(b.lastReportedAt) - recencyKey(a.lastReportedAt) ||
    b.sources.length - a.sources.length)
}

interface RichAggregate {
  localId: string
  name: string | null
  normalizedName: string
  addresses: Address[]
  phones: string[]
  emails: string[]
  ageOrDob: string | null
  relationToSubject?: string
  relationshipAsStated?: string
  relationCategory?: RelationCategory
  maidenName?: string
  deceasedStatus: DeceasedStatus
  sources: string[]
  phoneMap: Map<string, ContactAccum>
  addrMap: Map<string, ContactAccum>
  emailMap: Map<string, ContactAccum>
}

// Collapse a candidate's evidence into one rich record (the "resolution" of one person).
function aggregate(pkg: EvidencePackage, cand: CandidatePerson): RichAggregate {
  const agg: RichAggregate = {
    localId: cand.localId, name: cand.name, normalizedName: normalize(cand.name),
    addresses: [], phones: [], emails: [], ageOrDob: null, deceasedStatus: 'unknown', sources: [],
    phoneMap: new Map(), addrMap: new Map(), emailMap: new Map(),
  }
  const sources = new Set<string>()
  let sawDeceased = false, sawLiving = false
  for (const ref of cand.evidenceRefs) {
    const it = pkg.evidence[ref]
    if (!it) continue
    const sourceId = it.provenance.sourceId
    const strength = strengthOf(it.provenance.sourceType)
    sources.add(sourceId)
    switch (it.kind) {
      case 'identity':
        if (!agg.name) agg.name = it.value.name
        if (it.value.normalizedName) agg.normalizedName = it.value.normalizedName
        if (it.value.ageOrDob) agg.ageOrDob = it.value.ageOrDob
        if (it.value.maidenName) agg.maidenName = it.value.maidenName
        if (it.value.deceasedStatus === 'deceased') sawDeceased = true
        else if (it.value.deceasedStatus === 'living') sawLiving = true
        break
      case 'address': {
        agg.addresses.push(it.value)
        const display = [it.value.line1, it.value.city, it.value.state].filter(Boolean).join(', ')
        accum(agg.addrMap, normalize(`${it.value.line1} ${it.value.city ?? ''}`), display, sourceId, strength, it.value.lastReportedAt, undefined, it.value.kind)
        break
      }
      case 'phone':
        agg.phones.push(it.value.number)
        accum(agg.phoneMap, it.value.number.replace(/\D/g, ''), it.value.number, sourceId, strength, it.value.lastReportedAt, it.value.contactMethodStatus, it.value.label)
        break
      case 'email':
        agg.emails.push(it.value.address)
        accum(agg.emailMap, it.value.address.toLowerCase(), it.value.address, sourceId, strength, it.value.lastReportedAt, it.value.contactMethodStatus)
        break
      case 'relationship':
        agg.relationToSubject = it.value.relationshipAsStated
        agg.relationshipAsStated = it.value.relationshipAsStated
        if (it.value.relationCategory) agg.relationCategory = it.value.relationCategory
        if (it.value.normalizedName) agg.normalizedName = it.value.normalizedName
        if (it.value.maidenName && !agg.maidenName) agg.maidenName = it.value.maidenName
        if (it.value.deceasedStatus === 'deceased') sawDeceased = true
        else if (it.value.deceasedStatus === 'living') sawLiving = true
        break
    }
  }
  agg.phones = uniq(agg.phones)
  agg.emails = uniq(agg.emails)
  agg.sources = [...sources]
  agg.deceasedStatus = sawDeceased ? 'deceased' : sawLiving ? 'living' : 'unknown'
  if (!agg.normalizedName) agg.normalizedName = normalize(agg.name)
  return agg
}

// Source-independence: weight scales with DISTINCT sources (capped), so broker echoes don't stack.
function independence(sourceCount: number): number {
  return Math.min(1.5, 1 + 0.25 * Math.max(0, sourceCount - 1))
}

function scoreCandidate(q: PersonQuery, agg: RichAggregate): { justification: Justification; score: number } {
  const j: Justification = []
  const ind = independence(agg.sources.length)
  const w = (n: number) => Math.round(n * ind)
  const qAddr = normalize(`${q.address ?? ''} ${q.city ?? ''} ${q.state ?? ''}`)

  let addrCredited = false
  for (const a of agg.addresses) {
    const k = normalize(`${a.line1} ${a.city ?? ''} ${a.state ?? ''}`)
    if (!addrCredited && q.address && k && k === qAddr) {
      const prop = a.kind === 'property'
      j.push({ signal: prop ? 'propertyAddress' : 'exactAddress', sources: agg.sources, weight: w(prop ? SIGNAL_WEIGHTS.propertyAddress : SIGNAL_WEIGHTS.exactAddress), note: `address match: ${a.line1}` })
      addrCredited = true
    }
  }
  if (!addrCredited && q.city && agg.addresses.some(a => normalize(a.city) === normalize(q.city))) {
    j.push({ signal: 'city', sources: agg.sources, weight: w(SIGNAL_WEIGHTS.city), note: `city: ${q.city}` })
  }
  if (q.state && agg.addresses.some(a => normalize(a.state) === normalize(q.state))) {
    j.push({ signal: 'state', sources: agg.sources, weight: w(SIGNAL_WEIGHTS.state), note: `state: ${q.state}` })
  }
  const sim = nameSimilarity(q.name, agg.name)
  if (sim >= 0.99) j.push({ signal: 'nameExact', sources: agg.sources, weight: w(SIGNAL_WEIGHTS.nameExact), note: 'name exact' })
  else if (sim >= 0.6) j.push({ signal: 'nameStrong', sources: agg.sources, weight: w(SIGNAL_WEIGHTS.nameStrong), note: `name strong (${sim.toFixed(2)})` })
  else if (sim > 0) j.push({ signal: 'nameWeak', sources: agg.sources, weight: w(SIGNAL_WEIGHTS.nameWeak), note: `name weak (${sim.toFixed(2)})` })
  if (agg.relationToSubject) j.push({ signal: 'relationship', sources: agg.sources, weight: w(SIGNAL_WEIGHTS.relationship), note: `relation: ${agg.relationToSubject}` })
  if (agg.phones.length) j.push({ signal: 'phone', sources: agg.sources, weight: w(SIGNAL_WEIGHTS.phone), note: `${agg.phones.length} phone(s)` })
  if (agg.emails.length) j.push({ signal: 'email', sources: agg.sources, weight: w(SIGNAL_WEIGHTS.email), note: `${agg.emails.length} email(s)` })

  return { justification: j, score: Math.min(100, j.reduce((a, e) => a + e.weight, 0)) }
}

// ── B1 Actionable Contacts — living/unknown people with at least one contact method, all ranked. ──
function buildActionableContacts(aggs: RichAggregate[]): ActionableContact[] {
  return aggs
    .filter(a => a.deceasedStatus !== 'deceased' && (a.phoneMap.size || a.addrMap.size || a.emailMap.size))
    .map((a): ActionableContact => {
      const phones = rankContacts(a.phoneMap)
      const addresses = rankContacts(a.addrMap)
      const emails = rankContacts(a.emailMap)
      const corroborated = a.sources.length >= 2 ||
        [...phones, ...addresses, ...emails].some(c => c.sources.length >= 2)
      const checklist: ChecklistItem[] = [
        { label: 'Relationship to owner known', present: !!a.relationshipAsStated },
        { label: 'Living status confirmed', present: a.deceasedStatus === 'living' },
        { label: 'Phone found', present: phones.length > 0 },
        { label: 'Mailing address found', present: addresses.length > 0 },
        { label: 'Corroborated (2+ sources)', present: corroborated },
      ]
      return {
        localId: a.localId, name: a.name, normalizedName: a.normalizedName,
        relationshipAsStated: a.relationshipAsStated, relationCategory: a.relationCategory,
        phones, addresses, emails, confidence: buildChecklist(checklist),
      }
    })
    .sort((x, y) => y.confidence.score - x.confidence.score)
}

// ── B1 Family Structure — EVERYONE mentioned (living + deceased), for understanding the family. ───
function buildFamilyStructure(pkg: EvidencePackage): FamilyStructure {
  interface Acc { name: string; normalizedName: string; relationshipAsStated: string; relationCategory: RelationCategory; deceasedStatus: DeceasedStatus; maidenName?: string; isFromCrm: boolean; sources: Set<string>; strengths: Set<EvidenceStrength> }
  const byPerson = new Map<string, Acc>()
  for (const it of pkg.evidence) {
    if (it.kind !== 'relationship') continue
    const key = it.value.normalizedName || normalize(it.value.person)
    if (!key) continue
    const a = byPerson.get(key) ?? {
      name: it.value.person, normalizedName: key, relationshipAsStated: it.value.relationshipAsStated,
      relationCategory: it.value.relationCategory ?? 'unknown', deceasedStatus: it.value.deceasedStatus ?? 'unknown',
      maidenName: it.value.maidenName, isFromCrm: !!it.provenance.isFromCrm,
      sources: new Set<string>(), strengths: new Set<EvidenceStrength>(),
    }
    a.sources.add(it.provenance.sourceId)
    a.strengths.add(strengthOf(it.provenance.sourceType))
    if (it.value.deceasedStatus === 'deceased') a.deceasedStatus = 'deceased'
    else if (it.value.deceasedStatus === 'living' && a.deceasedStatus !== 'deceased') a.deceasedStatus = 'living'
    if (it.value.maidenName && !a.maidenName) a.maidenName = it.value.maidenName
    if (it.provenance.isFromCrm) a.isFromCrm = true
    byPerson.set(key, a)
  }
  const members: FamilyMember[] = [...byPerson.values()].map((a): FamilyMember => {
    const checklist: ChecklistItem[] = [
      { label: 'Relationship stated by a source', present: true },
      { label: 'Corroborated by 2+ sources', present: a.sources.size >= 2 },
      { label: 'Strong or medium source', present: strongest(a.strengths) !== 'weak' },
    ]
    return {
      name: a.name, normalizedName: a.normalizedName, relationshipAsStated: a.relationshipAsStated,
      relationCategory: a.relationCategory, deceasedStatus: a.deceasedStatus, maidenName: a.maidenName,
      isFromCrm: a.isFromCrm, confidence: buildChecklist(checklist),
    }
  })
  return { members }
}

// ── B4 Conflicts — typed, derived (never captured). Drives the `conflicting` band. ────────────────
function buildConflicts(pkg: EvidencePackage): Conflict[] {
  const conflicts: Conflict[] = []
  const deathItems: { i: number; status: DeceasedStatus; date?: string }[] = []
  pkg.evidence.forEach((it, i) => { if (it.kind === 'deceased') deathItems.push({ i, status: it.value.deceasedStatus, date: it.value.dateOfDeath }) })

  const dated = deathItems.filter(d => d.status === 'deceased' && d.date)
  const distinctDates = [...new Set(dated.map(d => d.date))]
  if (distinctDates.length > 1) conflicts.push({ type: 'death_date', description: `Death dates disagree: ${distinctDates.join(' vs ')}`, evidenceIds: dated.map(d => d.i) })

  const subjStatuses = new Set(deathItems.map(d => d.status))
  if (subjStatuses.has('deceased') && subjStatuses.has('living')) {
    conflicts.push({ type: 'living_status', description: 'Sources disagree on whether the subject is living or deceased', evidenceIds: deathItems.map(d => d.i) })
  }

  // Per-person: living vs deceased disagreement, or conflicting relationship categories.
  interface PAcc { name: string; cats: Set<RelationCategory>; statuses: Set<DeceasedStatus>; ids: number[] }
  const people = new Map<string, PAcc>()
  pkg.evidence.forEach((it, i) => {
    if (it.kind !== 'relationship') return
    const key = it.value.normalizedName || normalize(it.value.person)
    if (!key) return
    const a = people.get(key) ?? { name: it.value.person, cats: new Set<RelationCategory>(), statuses: new Set<DeceasedStatus>(), ids: [] }
    if (it.value.relationCategory) a.cats.add(it.value.relationCategory)
    if (it.value.deceasedStatus) a.statuses.add(it.value.deceasedStatus)
    a.ids.push(i)
    people.set(key, a)
  })
  for (const a of people.values()) {
    if (a.statuses.has('deceased') && a.statuses.has('living')) conflicts.push({ type: 'living_status', description: `${a.name}: sources disagree living vs deceased`, evidenceIds: a.ids })
    const realCats = [...a.cats].filter(c => c !== 'unknown')
    if (realCats.length > 1) conflicts.push({ type: 'relationship', description: `${a.name}: conflicting relationships (${realCats.join(' vs ')})`, evidenceIds: a.ids })
  }
  return conflicts
}

const CLOSE_FAMILY = new Set<RelationCategory>(['parent', 'sibling', 'spouse', 'child', 'grandparent'])
function buildCompleteness(pkg: EvidencePackage, actionable: ActionableContact[]): Completeness {
  return {
    deathConfirmed: pkg.evidence.some(e => e.kind === 'deceased' && e.value.deceasedStatus === 'deceased'),
    closeFamilyIdentified: pkg.evidence.some(e => e.kind === 'relationship' && CLOSE_FAMILY.has(e.value.relationCategory ?? 'unknown')),
    contactsFound: actionable.some(c => c.phones.length || c.addresses.length || c.emails.length),
    propertyConfirmed: pkg.evidence.some(e => e.kind === 'property'),
  }
}

// ── B6 Timeline + source intelligence — derived from plan.steps + telemetry (reuse, don't rebuild). ─
function buildTimeline(pkg: EvidencePackage): TimelineStep[] {
  return (pkg.plan?.steps ?? []).map((s, i): TimelineStep => ({ n: s.n ?? i + 1, intent: s.intent, reason: s.reason, source: s.source, status: s.status }))
}
function buildSourceIntel(pkg: EvidencePackage): SourceIntelEntry[] {
  const typeOfSource = new Map<string, SourceType | 'unknown'>()
  const byType = new Map<SourceType | 'unknown', { items: number; sources: Set<string>; attempts: number }>()
  const get = (t: SourceType | 'unknown') => byType.get(t) ?? { items: 0, sources: new Set<string>(), attempts: 0 }
  for (const it of pkg.evidence) {
    const t: SourceType | 'unknown' = it.provenance.sourceType ?? 'unknown'
    typeOfSource.set(it.provenance.sourceId, t)
    const a = get(t); a.items++; a.sources.add(it.provenance.sourceId); byType.set(t, a)
  }
  for (const att of pkg.telemetry ?? []) {
    const t = typeOfSource.get(att.sourceId) ?? 'unknown'
    const a = get(t); a.attempts++; byType.set(t, a)
  }
  return [...byType.entries()].map(([sourceType, a]) => ({ sourceType, items: a.items, sources: [...a.sources], attempts: a.attempts }))
}

export function deriveDossier(pkg: EvidencePackage): Dossier {
  const q = pkg.query
  // Subject alive/deceased from deceased-evidence (any confirmed death wins).
  const deceasedEv = pkg.evidence.find(e => e.kind === 'deceased' && e.value.deceasedStatus === 'deceased')
  const deceased = deceasedEv ? true : pkg.evidence.some(e => e.kind === 'deceased') ? false : null
  const dateOfDeath = deceasedEv && deceasedEv.kind === 'deceased' ? deceasedEv.value.dateOfDeath : undefined

  const aggs = pkg.candidates.map(c => aggregate(pkg, c))
  const scored: ScoredCandidate[] = aggs.map(agg => {
    const { justification, score } = scoreCandidate(q, agg)
    return { localId: agg.localId, name: agg.name, score, phones: agg.phones, emails: agg.emails, addresses: agg.addresses, relationToSubject: agg.relationToSubject, justification }
  }).sort((a, b) => b.score - a.score)

  // Heir graph: subject + each candidate as a node, edge labeled by relationship (default unknown).
  const nodes: HeirGraphNode[] = [{ id: 'subject', name: q.name, deceased: deceased ?? undefined }]
  const edges: HeirGraphEdge[] = []
  for (const c of scored) {
    nodes.push({ id: c.localId, name: c.name ?? 'unknown', relationToSubject: c.relationToSubject })
    edges.push({ from: 'subject', to: c.localId, relation: c.relationToSubject ?? 'possible_relative' })
  }
  const heirGraph: HeirGraph = { subject: q.name, nodes, edges }

  const contactRankings: ContactRanking[] = scored
    .filter(c => c.phones.length || c.emails.length)
    .map((c, i) => ({ person: c.name ?? c.localId, phones: c.phones, emails: c.emails, rank: i + 1 }))

  // v3 derived structures.
  const actionableContacts = buildActionableContacts(aggs)
  const familyStructure = buildFamilyStructure(pkg)
  const conflicts = buildConflicts(pkg)
  const completeness = buildCompleteness(pkg, actionableContacts)
  const timeline = buildTimeline(pkg)
  const sourceIntel = buildSourceIntel(pkg)

  // Confidence from the top candidate; conflicts = a different-identity candidate that also scores.
  const top = scored[0]
  const rival = scored.find(c => top && c.localId !== top.localId && nameSimilarity(top.name, c.name) < 0.6 && c.score > 0)
  const conflictScore = rival?.score ?? 0
  const distinctSources = top ? new Set(pkg.candidates.find(c => c.localId === top.localId)?.evidenceRefs.map(r => pkg.evidence[r]?.provenance.sourceId).filter(Boolean)).size : 0
  const confidence: Confidence = {
    // A typed conflict (B4) forces the human to disambiguate, overriding the heuristic band.
    band: conflicts.length ? 'conflicting' : top ? deriveBand(top.score, conflictScore, distinctSources) : 'low',
    score: top?.score ?? 0,
    justification: top?.justification ?? [],
    conflicts: rival?.justification ?? [],
  }

  return {
    subject: { name: q.name, deceased, dateOfDeath },
    heirGraph,
    candidatePeople: scored,
    contactRankings,
    confidence,
    actionableContacts,
    familyStructure,
    completeness,
    conflicts,
    timeline,
    sourceIntel,
    reviewStatus: 'pending',
    generatedAt: new Date().toISOString(),
  }
}
