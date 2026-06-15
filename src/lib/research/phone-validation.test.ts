import { describe, it, expect } from 'vitest'
import { derivePhoneVerdict, deriveDossier } from './derive'
import type { EvidencePackage, Provenance } from './types'

const prov = (sourceId: string): Provenance =>
  ({ sourceId, sourceType: 'people_search', url: `https://${sourceId}/x`, retrievedAt: '2026-06-15T00:00:00Z', sourceText: `from ${sourceId}` })

describe('derivePhoneVerdict (Trestle facts → verdict)', () => {
  it('good = valid + active + not VOIP', () => {
    const r = derivePhoneVerdict({ number: '4045551234', isValid: true, activityScore: 85, lineType: 'Mobile', nameMatch: true, contactGrade: 'A' })
    expect(r.derived.verdict).toBe('good')
    expect(r.status).toBe('valid')
    expect(r.derived.nameMatch).toBe(true)
    expect(r.derived.activityScore).toBe(85)
  })
  it('bad = invalid number', () => {
    expect(derivePhoneVerdict({ number: '1', isValid: false }).derived.verdict).toBe('bad')
  })
  it('bad = disconnected (activity 0)', () => {
    const r = derivePhoneVerdict({ number: '1', isValid: true, activityScore: 0 })
    expect(r.derived.verdict).toBe('bad')
    expect(r.status).toBe('invalid')
  })
  it('uncertain = low activity', () => {
    expect(derivePhoneVerdict({ number: '1', isValid: true, activityScore: 20, lineType: 'Mobile' }).derived.verdict).toBe('uncertain')
  })
  it('uncertain = NonFixedVOIP even if active (virtual number)', () => {
    expect(derivePhoneVerdict({ number: '1', isValid: true, activityScore: 95, lineType: 'NonFixedVOIP' }).derived.verdict).toBe('uncertain')
  })
})

describe('deriveDossier attaches phone validation to the matching ranked phone', () => {
  it('flips the phone to its verdict + contactMethodStatus, by number (any format)', () => {
    const evidence = [
      { kind: 'identity', value: { name: 'Jane Doe', normalizedName: 'jane doe', deceasedStatus: 'living' }, provenance: prov('fastpeoplesearch') },
      { kind: 'phone', value: { number: '(404) 555-1234' }, provenance: prov('fastpeoplesearch') },
      { kind: 'phone_validation', value: { number: '4045551234', isValid: true, activityScore: 90, lineType: 'Mobile', nameMatch: true, contactGrade: 'A', provider: 'trestle' }, provenance: prov('trestle') },
    ]
    const pkg = {
      requestId: 1, query: { name: 'Jane Doe', goal: 'find_heirs' }, plan: { goal: 'find_heirs', steps: [] },
      candidates: [{ localId: 'c1', name: 'Jane Doe', evidenceRefs: [0, 1, 2] }],
      evidence, documents: [], telemetry: [], notes: [], budget: {},
    } as unknown as EvidencePackage

    const d = deriveDossier(pkg)
    const jane = d.actionableContacts.find(a => a.normalizedName === 'jane doe')!
    const phone = jane.phones[0]
    expect(phone.validation?.verdict).toBe('good')
    expect(phone.validation?.nameMatch).toBe(true)
    expect(phone.contactMethodStatus).toBe('valid')
  })
})
