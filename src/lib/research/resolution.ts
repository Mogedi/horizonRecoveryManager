// Entity resolution — the product. Transparent, tunable weighted signals; the property is the
// anchor; corroboration weights by DISTINCT sources (not raw count, since brokers resell data).
import type { Candidate, PersonQuery, Resolution, EvidenceItem, Address } from './types'
import { deriveBand } from './confidence'

// Tunable signal weights (higher = stronger evidence two records are the same person).
export const SIGNAL_WEIGHTS = {
  propertyAddress: 38, // candidate address matches the query PROPERTY address — our anchor
  exactAddress: 34,
  city: 8,
  state: 4,
  nameExact: 24,
  nameStrong: 16,
  nameWeak: 6,
  relativeOverlap: 12,
  ageOverlap: 10,
  phoneOverlap: 14,
  emailOverlap: 14,
} as const

export function normalize(s: string | null | undefined): string {
  return (s ?? '').toLowerCase().replace(/[^a-z0-9 ]/g, ' ').replace(/\s+/g, ' ').trim()
}

// 0..1 token-overlap name similarity — handles "John A Smith" vs "Smith, John".
export function nameSimilarity(a: string | null, b: string | null): number {
  const ta = new Set(normalize(a).split(' ').filter(Boolean))
  const tb = new Set(normalize(b).split(' ').filter(Boolean))
  if (!ta.size || !tb.size) return 0
  let inter = 0
  for (const t of ta) if (tb.has(t)) inter++
  return inter / Math.max(ta.size, tb.size)
}

const addrKey = (a: Address) => normalize(`${a.line1} ${a.city ?? ''} ${a.state ?? ''}`)
const queryAddrKey = (q: PersonQuery) => normalize(`${q.address ?? ''} ${q.city ?? ''} ${q.state ?? ''}`)

// Evidence for ONE candidate vs the query anchor.
export function scoreCandidate(q: PersonQuery, c: Candidate): EvidenceItem[] {
  const ev: EvidenceItem[] = []
  const qAddr = queryAddrKey(q)
  for (const a of c.addresses) {
    const k = addrKey(a)
    if (q.address && k && k === qAddr) {
      const isProp = a.kind === 'property'
      ev.push({ signal: isProp ? 'propertyAddress' : 'exactAddress', sources: [c.sourceId],
        weight: isProp ? SIGNAL_WEIGHTS.propertyAddress : SIGNAL_WEIGHTS.exactAddress, note: `address match: ${a.line1}` })
    } else if (q.city && a.city && normalize(a.city) === normalize(q.city)) {
      ev.push({ signal: 'city', sources: [c.sourceId], weight: SIGNAL_WEIGHTS.city, note: `city: ${a.city}` })
    }
  }
  if (q.state && c.addresses.some(a => normalize(a.state) === normalize(q.state))) {
    ev.push({ signal: 'state', sources: [c.sourceId], weight: SIGNAL_WEIGHTS.state, note: `state: ${q.state}` })
  }
  const sim = nameSimilarity(q.name, c.name)
  if (sim >= 0.99) ev.push({ signal: 'nameExact', sources: [c.sourceId], weight: SIGNAL_WEIGHTS.nameExact, note: 'name exact' })
  else if (sim >= 0.6) ev.push({ signal: 'nameStrong', sources: [c.sourceId], weight: SIGNAL_WEIGHTS.nameStrong, note: `name strong (${sim.toFixed(2)})` })
  else if (sim > 0) ev.push({ signal: 'nameWeak', sources: [c.sourceId], weight: SIGNAL_WEIGHTS.nameWeak, note: `name weak (${sim.toFixed(2)})` })
  if (q.relativesHint?.length && c.relatives.length) {
    const qr = new Set(q.relativesHint.map(normalize))
    if (c.relatives.some(r => qr.has(normalize(r)))) ev.push({ signal: 'relativeOverlap', sources: [c.sourceId], weight: SIGNAL_WEIGHTS.relativeOverlap, note: 'relative overlap' })
  }
  if (q.ageHint && c.ageOrDob) {
    const age = parseInt(c.ageOrDob, 10)
    if (!Number.isNaN(age) && Math.abs(age - q.ageHint) <= 2) ev.push({ signal: 'ageOverlap', sources: [c.sourceId], weight: SIGNAL_WEIGHTS.ageOverlap, note: `age ~${age}` })
  }
  return ev
}

const uniq = (xs: string[]) => [...new Set(xs.map(s => s.trim()).filter(Boolean))]

export function mergeCandidates(cands: Candidate[]): Candidate | null {
  if (!cands.length) return null
  const named = cands.find(c => c.name) ?? cands[0]
  return {
    sourceId: uniq(cands.map(c => c.sourceId)).join('+'),
    url: named.url,
    name: named.name,
    addresses: dedupeAddresses(cands.flatMap(c => c.addresses)),
    phones: uniq(cands.flatMap(c => c.phones)),
    emails: uniq(cands.flatMap(c => c.emails)),
    relatives: uniq(cands.flatMap(c => c.relatives)),
    ageOrDob: cands.find(c => c.ageOrDob)?.ageOrDob ?? null,
    deceased: cands.some(c => c.deceased === true) ? true : cands.some(c => c.deceased === false) ? false : null,
    signals: uniq(cands.flatMap(c => c.signals)),
  }
}

function dedupeAddresses(addrs: Address[]): Address[] {
  const seen = new Map<string, Address>()
  for (const a of addrs) { const k = addrKey(a); if (k && !seen.has(k)) seen.set(k, a) }
  return [...seen.values()]
}

// Group identical signals across candidates; corroboration scales with DISTINCT sources (capped),
// so 5 echoes of one broker don't beat 2 genuinely independent sources.
function mergeEvidence(items: EvidenceItem[]): EvidenceItem[] {
  const byKey = new Map<string, EvidenceItem>()
  for (const it of items) {
    const k = it.signal + '|' + it.note
    const prev = byKey.get(k)
    if (prev) prev.sources = uniq([...prev.sources, ...it.sources])
    else byKey.set(k, { ...it, sources: uniq(it.sources) })
  }
  for (const it of byKey.values()) {
    const independence = Math.min(1.5, 1 + 0.25 * (it.sources.length - 1))
    it.weight = Math.round(it.weight * independence)
  }
  return [...byKey.values()].sort((a, b) => b.weight - a.weight)
}

export function resolve(query: PersonQuery, candidates: Candidate[]): Resolution {
  if (!candidates.length) {
    return { band: 'low', score: 0, best: null, evidence: [], conflicts: [], ambiguities: ['no candidates found'] }
  }
  const scored = candidates.map(c => { const ev = scoreCandidate(query, c); return { c, ev, score: ev.reduce((a, e) => a + e.weight, 0) } })
  scored.sort((a, b) => b.score - a.score)
  const top = scored[0]

  const agreeing = scored.filter(s => s === top || nameSimilarity(top.c.name, s.c.name) >= 0.6)
  const others = scored.filter(s => !agreeing.includes(s) && s.score > 0)

  const best = mergeCandidates(agreeing.map(s => s.c))
  const evidence = mergeEvidence(agreeing.flatMap(s => s.ev))
  const conflicts = mergeEvidence(others.flatMap(s => s.ev))

  const score = Math.min(100, evidence.reduce((a, e) => a + e.weight, 0))
  const conflictScore = conflicts.reduce((a, e) => a + e.weight, 0)
  const distinctSources = new Set(agreeing.map(s => s.c.sourceId)).size
  const band = deriveBand(score, conflictScore, distinctSources)

  const ambiguities: string[] = []
  if (others.length) ambiguities.push(`${others.length} other candidate(s) partially matched — possible different person`)

  return { band, score, best, evidence, conflicts, ambiguities }
}
