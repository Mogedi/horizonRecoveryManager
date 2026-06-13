import { describe, it, expect } from 'vitest'
import { deriveDossier, nameSimilarity } from './derive'
import type { EvidencePackage, Provenance } from './types'

const prov = (sourceId: string): Provenance => ({ sourceId, url: `https://${sourceId}/x`, retrievedAt: '2026-06-13T00:00:00Z' })

// Deceased owner (Tammy) with two heirs surfaced from an obituary + people-search.
const fixture: EvidencePackage = {
  requestId: 1,
  query: { name: 'Tammy L Burchett', address: '235 Whipporwill Ln SE', city: 'Calhoun', state: 'GA', goal: 'find_heirs' },
  plan: { goal: 'find_heirs', steps: [] },
  candidates: [
    { localId: 'jane', name: 'Jane Burchett', evidenceRefs: [2, 4, 5, 6] },
    { localId: 'bob', name: 'Bob Burchett', evidenceRefs: [3, 7, 8] },
  ],
  evidence: [
    { kind: 'property', value: { owner: 'Tammy L Burchett', situsAddress: '235 Whipporwill Ln SE', parcelId: '123' }, provenance: prov('qpublic:gordon') },
    { kind: 'deceased', value: { isDeceased: true, dateOfDeath: '2021-03-15', basis: 'obituary' }, provenance: prov('legacy.com') },
    { kind: 'relationship', value: { person: 'Jane Burchett', relationToSubject: 'daughter' }, provenance: prov('legacy.com') },
    { kind: 'relationship', value: { person: 'Bob Burchett', relationToSubject: 'son' }, provenance: prov('legacy.com') },
    { kind: 'identity', value: { name: 'Jane Burchett', ageOrDob: '48' }, provenance: prov('fastpeoplesearch') },
    { kind: 'address', value: { line1: '12 Oak St', city: 'Marietta', state: 'GA', kind: 'current' }, provenance: prov('fastpeoplesearch') },
    { kind: 'phone', value: { number: '770-555-0101' }, provenance: prov('fastpeoplesearch') },
    { kind: 'identity', value: { name: 'Bob Burchett' }, provenance: prov('fastpeoplesearch') },
    { kind: 'phone', value: { number: '404-555-0199' }, provenance: prov('fastpeoplesearch') },
  ],
  documents: [],
  telemetry: [],
  notes: [],
  budget: { stepsUsed: 4, sourcesHit: 3, capHit: false },
  completedAt: '2026-06-13T00:00:00Z',
}

describe('deriveDossier', () => {
  const d = deriveDossier(fixture)

  it('determines the subject is deceased with a date', () => {
    expect(d.subject.deceased).toBe(true)
    expect(d.subject.dateOfDeath).toBe('2021-03-15')
  })

  it('builds an heir graph: subject + each heir with a labeled relationship', () => {
    expect(d.heirGraph.nodes).toHaveLength(3) // subject + 2 heirs
    const rels = d.heirGraph.edges.map(e => e.relation).sort()
    expect(rels).toEqual(['daughter', 'son'])
  })

  it('scores the candidates and carries their contact info', () => {
    expect(d.candidatePeople).toHaveLength(2)
    const jane = d.candidatePeople.find(c => c.name === 'Jane Burchett')
    expect(jane?.relationToSubject).toBe('daughter')
    expect(jane?.phones).toContain('770-555-0101')
    expect(jane?.score).toBeGreaterThan(0)
  })

  it('ranks contacts that have phone/email', () => {
    expect(d.contactRankings).toHaveLength(2)
    expect(d.contactRankings[0].rank).toBe(1)
  })

  it('produces an explainable confidence band, never a bare probability', () => {
    expect(['high', 'medium', 'low', 'conflicting']).toContain(d.confidence.band)
    expect(Array.isArray(d.confidence.justification)).toBe(true)
  })

  it('reviewStatus starts pending (human decides)', () => {
    expect(d.reviewStatus).toBe('pending')
  })
})

describe('empty evidence', () => {
  it('yields a low band and a subject-only graph', () => {
    const d = deriveDossier({ ...fixture, candidates: [], evidence: [] })
    expect(d.confidence.band).toBe('low')
    expect(d.subject.deceased).toBeNull()
    expect(d.heirGraph.nodes).toHaveLength(1)
  })
})

describe('nameSimilarity', () => {
  it('shares a surname weakly', () => expect(nameSimilarity('Tammy L Burchett', 'Jane Burchett')).toBeGreaterThan(0))
})
