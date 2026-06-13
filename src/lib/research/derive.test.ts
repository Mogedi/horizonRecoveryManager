import { describe, it, expect } from 'vitest'
import { deriveDossier, nameSimilarity, strengthOf } from './derive'
import type { EvidencePackage, Provenance, SourceType } from './types'

const prov = (sourceId: string, sourceType: SourceType = 'other'): Provenance =>
  ({ sourceId, sourceType, url: `https://${sourceId}/x`, retrievedAt: '2026-06-13T00:00:00Z', sourceText: `evidence from ${sourceId}` })

// Deceased owner (Tammy) with two heirs surfaced from an obituary + people-search.
const fixture: EvidencePackage = {
  requestId: 1,
  query: { name: 'Tammy L Burchett', address: '235 Whipporwill Ln SE', city: 'Calhoun', state: 'GA', goal: 'find_heirs' },
  plan: { goal: 'find_heirs', steps: [
    { n: 1, intent: 'confirm property + owner', source: 'qpublic:gordon', reason: 'anchor the case to the parcel', status: 'done' },
    { n: 2, intent: 'people-search for Jane', reason: "'survived by daughter Jane' — find current contact", status: 'failed' },
  ] },
  candidates: [
    { localId: 'jane', name: 'Jane Burchett', evidenceRefs: [2, 4, 5, 6, 9] },
    { localId: 'bob', name: 'Bob Burchett', evidenceRefs: [3, 7, 8] },
  ],
  evidence: [
    { kind: 'property', value: { owner: 'Tammy L Burchett', situsAddress: '235 Whipporwill Ln SE', parcelId: '123' }, provenance: prov('qpublic:gordon', 'property') },
    { kind: 'deceased', value: { deceasedStatus: 'deceased', dateOfDeath: '2021-03-15', basis: 'obituary' }, provenance: prov('legacy.com', 'obituary') },
    { kind: 'relationship', value: { person: 'Jane Burchett', normalizedName: 'jane burchett', relationshipAsStated: 'daughter', relationCategory: 'child' }, provenance: prov('legacy.com', 'obituary') },
    { kind: 'relationship', value: { person: 'Bob Burchett', normalizedName: 'bob burchett', relationshipAsStated: 'son', relationCategory: 'child' }, provenance: prov('legacy.com', 'obituary') },
    { kind: 'identity', value: { name: 'Jane Burchett', normalizedName: 'jane burchett', ageOrDob: '48', deceasedStatus: 'living' }, provenance: prov('fastpeoplesearch', 'people_search') },
    { kind: 'address', value: { line1: '12 Oak St', city: 'Marietta', state: 'GA', kind: 'current' }, provenance: prov('fastpeoplesearch', 'people_search') },
    { kind: 'phone', value: { number: '770-555-0101', contactMethodStatus: 'unverified', lastReportedAt: '2023' }, provenance: prov('fastpeoplesearch', 'people_search') },
    { kind: 'identity', value: { name: 'Bob Burchett', normalizedName: 'bob burchett', deceasedStatus: 'living' }, provenance: prov('fastpeoplesearch', 'people_search') },
    { kind: 'phone', value: { number: '404-555-0199', contactMethodStatus: 'unverified' }, provenance: prov('fastpeoplesearch', 'people_search') },
    // index 9: SAME phone for Jane from a second source → corroborated → HIGH rank
    { kind: 'phone', value: { number: '770-555-0101', contactMethodStatus: 'unverified', lastReportedAt: '2024' }, provenance: prov('truepeoplesearch', 'people_search') },
    // index 10: a preceded-in-death relative (deceased) — Family Structure, not Actionable
    { kind: 'relationship', value: { person: 'Earl Burchett', normalizedName: 'earl burchett', relationshipAsStated: 'father (preceded in death)', relationCategory: 'parent', deceasedStatus: 'deceased' }, provenance: prov('legacy.com', 'obituary') },
    // index 11: a CRM-known relative (isFromCrm)
    { kind: 'relationship', value: { person: 'Carl Burchett', normalizedName: 'carl burchett', relationshipAsStated: 'brother', relationCategory: 'sibling' }, provenance: { ...prov('crm', 'crm'), isFromCrm: true } },
  ],
  documents: [],
  // a blocked attempt that yielded NO evidence — must still group under its own sourceType, not 'unknown'
  telemetry: [
    { sourceId: 'qpublic9.qpublic.net', sourceType: 'government', status: 'blocked', blockReason: 'cloudflare', latencyMs: 1200, candidateCount: 0, proxyUsed: false, timestamp: new Date('2026-06-13T00:00:00Z') },
  ],
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

// ── Phase B (v3 derivation) ──────────────────────────────────────────────────────
describe('deriveDossier — Phase B sections', () => {
  const d = deriveDossier(fixture)

  it('B1: Actionable Contacts = living people with contacts (deceased relatives excluded)', () => {
    const names = d.actionableContacts.map(c => c.name)
    expect(names).toContain('Jane Burchett')
    expect(names).toContain('Bob Burchett')
    expect(names).not.toContain('Earl Burchett') // deceased → not actionable
  })

  it('B1: Family Structure includes EVERYONE — living + deceased relatives', () => {
    const fam = d.familyStructure.members
    const earl = fam.find(m => m.name === 'Earl Burchett')
    expect(earl?.deceasedStatus).toBe('deceased')
    expect(earl?.relationCategory).toBe('parent')
    expect(fam.map(m => m.name)).toContain('Jane Burchett')
  })

  it('B2: a phone seen by 2 independent sources ranks HIGH with a transparent reason', () => {
    const jane = d.actionableContacts.find(c => c.name === 'Jane Burchett')!
    const top = jane.phones[0]
    expect(top.value).toBe('770-555-0101')
    expect(top.rank).toBe('high')
    expect(top.sources.length).toBe(2)
    expect(top.reason).toMatch(/2 sources/)
    expect(top.lastReportedAt).toBe('2024') // most-recent recency carried
  })

  it('B3: each actionable contact + family member carries a ✓/✗ checklist and a band', () => {
    const jane = d.actionableContacts.find(c => c.name === 'Jane Burchett')!
    expect(jane.confidence.checklist.length).toBeGreaterThan(0)
    expect(['high', 'medium', 'low', 'conflicting']).toContain(jane.confidence.band)
    expect(d.familyStructure.members[0].confidence.checklist.length).toBeGreaterThan(0)
  })

  it('B4: completeness flags reflect the evidence (no "direct descendants" wording)', () => {
    expect(d.completeness.deathConfirmed).toBe(true)
    expect(d.completeness.closeFamilyIdentified).toBe(true)
    expect(d.completeness.contactsFound).toBe(true)
    expect(d.completeness.propertyConfirmed).toBe(true)
  })

  it('B5: CRM-sourced relatives are tagged isFromCrm; researched ones are not', () => {
    const carl = d.familyStructure.members.find(m => m.name === 'Carl Burchett')
    const jane = d.familyStructure.members.find(m => m.name === 'Jane Burchett')
    expect(carl?.isFromCrm).toBe(true)
    expect(jane?.isFromCrm).toBe(false)
  })

  it('B6: timeline derives from plan.steps and carries each step reason (incl. failed searches)', () => {
    expect(d.timeline).toHaveLength(2)
    expect(d.timeline[1].status).toBe('failed')
    expect(d.timeline[1].reason).toMatch(/survived by daughter/)
  })

  it('B6: source intelligence groups by sourceType', () => {
    const types = d.sourceIntel.map(s => s.sourceType)
    expect(types).toContain('obituary')
    expect(types).toContain('people_search')
    expect(types).toContain('property')
  })

  it('B6: a blocked attempt (no evidence) groups under its own sourceType, not "unknown"', () => {
    const gov = d.sourceIntel.find(s => s.sourceType === 'government')
    expect(gov?.attempts).toBe(1)
    expect(d.sourceIntel.map(s => s.sourceType)).not.toContain('unknown')
  })

  it('B4: grandchildren count as close family (descendant heirs)', () => {
    const withGrandchild: EvidencePackage = {
      ...fixture,
      evidence: [{ kind: 'relationship', value: { person: 'Tina Pryor', normalizedName: 'tina pryor', relationshipAsStated: 'granddaughter', relationCategory: 'grandchild', deceasedStatus: 'living' }, provenance: prov('legacy.com', 'obituary') }],
      candidates: [],
    }
    expect(deriveDossier(withGrandchild).completeness.closeFamilyIdentified).toBe(true)
  })
})

describe('deriveDossier — Phase B conflicts (B4)', () => {
  it('detects disagreeing death dates and forces the conflicting band', () => {
    const conflicted: EvidencePackage = {
      ...fixture,
      candidates: [],
      evidence: [
        { kind: 'deceased', value: { deceasedStatus: 'deceased', dateOfDeath: '2019-03-01', basis: 'obituary' }, provenance: prov('legacy.com', 'obituary') },
        { kind: 'deceased', value: { deceasedStatus: 'deceased', dateOfDeath: '2021-08-14', basis: 'findagrave' }, provenance: prov('findagrave.com', 'obituary') },
      ],
    }
    const d = deriveDossier(conflicted)
    const dd = d.conflicts.find(c => c.type === 'death_date')
    expect(dd).toBeTruthy()
    expect(dd!.evidenceIds).toEqual([0, 1])
    expect(d.confidence.band).toBe('conflicting')
  })
})

describe('strengthOf — sourceType → evidenceStrength (B7)', () => {
  it('maps source types to strength deterministically', () => {
    expect(strengthOf('probate')).toBe('strong')
    expect(strengthOf('government')).toBe('strong')
    expect(strengthOf('crm')).toBe('strong')
    expect(strengthOf('obituary')).toBe('medium')
    expect(strengthOf('funeral')).toBe('medium')
    expect(strengthOf('property')).toBe('medium')
    expect(strengthOf('people_search')).toBe('weak')
    expect(strengthOf('other')).toBe('weak')
    expect(strengthOf(undefined)).toBe('weak')
  })
})

describe('nameSimilarity', () => {
  it('shares a surname weakly', () => expect(nameSimilarity('Tammy L Burchett', 'Jane Burchett')).toBeGreaterThan(0))
})
