import { describe, it, expect } from 'vitest'
import { validateEvidencePackage } from './schema'

// A minimal package that honors the v3 contract (matches what current Hermes runs send).
const valid = () => ({
  requestId: 1,
  query: { name: 'Jane Doe', caseId: 'deal-1' },
  plan: { goal: 'contact', steps: [] },
  candidates: [{ localId: 'a', name: 'Jane Doe', evidenceRefs: [0] }],
  evidence: [
    {
      kind: 'phone',
      value: { number: '+14045551234' },
      provenance: { sourceId: 'whitepages.com', sourceType: 'people_search', url: 'https://x', retrievedAt: '2026-06-14', sourceText: 'Jane Doe (404) 555-1234' },
    },
  ],
  documents: [],
  telemetry: [{ anything: 'freeform is fine here' }],
  notes: [],
  budget: { stepsUsed: 1, sourcesHit: 1, capHit: false },
  completedAt: '2026-06-14T00:00:00Z',
})

describe('validateEvidencePackage — ingest contract guard', () => {
  it('accepts a contract-compliant package', () => {
    expect(validateEvidencePackage(valid())).toEqual({ ok: true })
  })

  it('rejects missing query.name', () => {
    const p = valid(); p.query.name = ''
    const r = validateEvidencePackage(p)
    expect(r.ok).toBe(false)
  })

  it('rejects provenance missing sourceText (the bug class: required fields the agent must not skip)', () => {
    const p = valid(); delete (p.evidence[0].provenance as Record<string, unknown>).sourceText
    const r = validateEvidencePackage(p)
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.issues.join()).toMatch(/sourceText/)
  })

  it('rejects an unknown sourceType (drift guard)', () => {
    const p = valid(); p.evidence[0].provenance.sourceType = 'tiktok'
    expect(validateEvidencePackage(p).ok).toBe(false)
  })

  it('rejects an unknown evidence kind', () => {
    const p = valid(); p.evidence[0].kind = 'vibes'
    expect(validateEvidencePackage(p).ok).toBe(false)
  })

  it('tolerates freeform telemetry (normalizer handles it) and unknown extra fields', () => {
    const p = valid() as Record<string, unknown>
    p.telemetry = [{ step: 'people_search', result: 'blocked', source: 'a.com, b.com' }]
    p.somethingNew = { future: true }
    expect(validateEvidencePackage(p)).toEqual({ ok: true })
  })
})
