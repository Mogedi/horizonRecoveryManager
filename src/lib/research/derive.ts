// The derivation engine — Horizon's business brain. Turns an IMMUTABLE EvidencePackage into a
// Dossier (entity resolution → heir graph → claimant scoring → confidence). Pure + deterministic, so
// it can be re-run over stored evidence whenever the logic improves. Hermes never produces this.
import type {
  EvidencePackage, Dossier, Address, ScoredCandidate, HeirGraph, HeirGraphNode, HeirGraphEdge,
  ContactRanking, Confidence, PersonQuery, CandidatePerson,
} from './types'
import { deriveBand } from './confidence'

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

interface Aggregate {
  localId: string
  name: string | null
  addresses: Address[]
  phones: string[]
  emails: string[]
  ageOrDob: string | null
  relationToSubject?: string
  sources: string[] // distinct provenance sourceIds (independence)
}

// Collapse a candidate's evidence into one record (the "resolution" of one person).
function aggregate(pkg: EvidencePackage, cand: CandidatePerson): Aggregate {
  const agg: Aggregate = { localId: cand.localId, name: cand.name, addresses: [], phones: [], emails: [], ageOrDob: null, sources: [] }
  const sources = new Set<string>()
  for (const ref of cand.evidenceRefs) {
    const it = pkg.evidence[ref]
    if (!it) continue
    sources.add(it.provenance.sourceId)
    switch (it.kind) {
      case 'identity': if (!agg.name) agg.name = it.value.name; if (it.value.ageOrDob) agg.ageOrDob = it.value.ageOrDob; break
      case 'address': agg.addresses.push(it.value); break
      case 'phone': agg.phones.push(it.value.number); break
      case 'email': agg.emails.push(it.value.address); break
      case 'relationship': agg.relationToSubject = it.value.relationToSubject; break
    }
  }
  agg.phones = uniq(agg.phones)
  agg.emails = uniq(agg.emails)
  agg.sources = [...sources]
  return agg
}

// Source-independence: weight scales with DISTINCT sources (capped), so broker echoes don't stack.
function independence(sourceCount: number): number {
  return Math.min(1.5, 1 + 0.25 * Math.max(0, sourceCount - 1))
}

function scoreCandidate(q: PersonQuery, agg: Aggregate): { justification: Justification; score: number } {
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

export function deriveDossier(pkg: EvidencePackage): Dossier {
  const q = pkg.query
  // Subject alive/deceased from deceased-evidence (any confirmed death wins).
  const deceasedEv = pkg.evidence.find(e => e.kind === 'deceased' && e.value.isDeceased)
  const deceased = deceasedEv ? true : pkg.evidence.some(e => e.kind === 'deceased') ? false : null
  const dateOfDeath = deceasedEv && deceasedEv.kind === 'deceased' ? deceasedEv.value.dateOfDeath : undefined

  const scored: ScoredCandidate[] = pkg.candidates.map(c => {
    const agg = aggregate(pkg, c)
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

  // Confidence from the top candidate; conflicts = a different-identity candidate that also scores.
  const top = scored[0]
  const rival = scored.find(c => top && c.localId !== top.localId && nameSimilarity(top.name, c.name) < 0.6 && c.score > 0)
  const conflictScore = rival?.score ?? 0
  const distinctSources = top ? new Set(pkg.candidates.find(c => c.localId === top.localId)?.evidenceRefs.map(r => pkg.evidence[r]?.provenance.sourceId).filter(Boolean)).size : 0
  const confidence: Confidence = {
    band: top ? deriveBand(top.score, conflictScore, distinctSources) : 'low',
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
    reviewStatus: 'pending',
    generatedAt: new Date().toISOString(),
  }
}
