import { describe, it, expect } from 'vitest'
import { nameSimilarity, scoreCandidate, resolve, mergeCandidates } from './resolution'
import type { Candidate, PersonQuery } from './types'

const cand = (over: Partial<Candidate>): Candidate => ({
  sourceId: 's', url: 'u', name: null, addresses: [], phones: [], emails: [], relatives: [],
  ageOrDob: null, deceased: null, signals: [], ...over,
})

describe('nameSimilarity', () => {
  it('matches reordered names', () => expect(nameSimilarity('John A Smith', 'Smith, John')).toBeGreaterThan(0.5))
  it('is zero for disjoint names', () => expect(nameSimilarity('John Smith', 'Mary Jones')).toBe(0))
})

describe('scoreCandidate', () => {
  it('credits the property-address anchor and exact name', () => {
    const q: PersonQuery = { name: 'John Smith', address: '123 Main St', city: 'Atlanta', state: 'GA' }
    const c = cand({ name: 'John Smith', addresses: [{ line1: '123 Main St', city: 'Atlanta', state: 'GA', kind: 'property' }] })
    const ev = scoreCandidate(q, c)
    expect(ev.find(e => e.signal === 'propertyAddress')).toBeTruthy()
    expect(ev.find(e => e.signal === 'nameExact')).toBeTruthy()
  })
})

describe('resolve', () => {
  it('returns low/empty when there are no candidates', () => {
    const r = resolve({ name: 'X' }, [])
    expect(r.band).toBe('low')
    expect(r.best).toBeNull()
  })

  it('reaches a high band when independent sources corroborate', () => {
    const q: PersonQuery = { name: 'John Smith', address: '123 Main St', city: 'Atlanta', state: 'GA' }
    const a = cand({ sourceId: 'qpublic', name: 'John Smith', addresses: [{ line1: '123 Main St', city: 'Atlanta', state: 'GA', kind: 'property' }], phones: ['404-555-1212'] })
    const b = cand({ sourceId: 'people', name: 'John A Smith', addresses: [{ line1: '123 Main St', city: 'Atlanta', state: 'GA', kind: 'current' }], relatives: ['Jane Smith'] })
    const r = resolve(q, [a, b])
    expect(r.band).toBe('high')
    expect(r.best?.phones).toContain('404-555-1212')
    expect(r.best?.relatives).toContain('Jane Smith')
  })

  it('flags conflicts when a different person also partially matches', () => {
    const q: PersonQuery = { name: 'John Smith', address: '123 Main St', city: 'Atlanta', state: 'GA' }
    const a = cand({ sourceId: 'qpublic', name: 'John Smith', addresses: [{ line1: '123 Main St', city: 'Atlanta', state: 'GA', kind: 'property' }] })
    const b = cand({ sourceId: 'people', name: 'Bob Jones', addresses: [{ line1: '123 Main St', city: 'Atlanta', state: 'GA', kind: 'current' }] })
    const r = resolve(q, [a, b])
    expect(r.conflicts.length).toBeGreaterThan(0)
  })
})

describe('mergeCandidates', () => {
  it('dedupes contacts and unions sources (independence)', () => {
    const m = mergeCandidates([cand({ sourceId: 'a', name: 'J', phones: ['1'] }), cand({ sourceId: 'b', name: 'J', phones: ['1', '2'] })])
    expect(m?.phones.sort()).toEqual(['1', '2'])
    expect(m?.sourceId).toContain('+')
  })
})
