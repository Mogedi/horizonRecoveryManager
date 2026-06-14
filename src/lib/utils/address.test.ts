import { describe, it, expect } from 'vitest'
import { parseAddress } from './address'

describe('parseAddress', () => {
  it('parses a full comma-separated address with zip', () => {
    expect(parseAddress('301 Lowell St, Atlanta, GA 30310')).toEqual({
      line1: '301 Lowell St', city: 'Atlanta', state: 'GA', zip: '30310', full: '301 Lowell St, Atlanta, GA 30310',
    })
  })

  it('parses without a zip', () => {
    expect(parseAddress('235 Whipporwill Ln SE, Calhoun, GA')).toMatchObject({ line1: '235 Whipporwill Ln SE', city: 'Calhoun', state: 'GA' })
  })

  it('parses a space-only tail (no comma before state/zip)', () => {
    expect(parseAddress('123 Main St, Macon GA 31201')).toMatchObject({ line1: '123 Main St', city: 'Macon', state: 'GA', zip: '31201' })
  })

  it('keeps the whole string as line1 when it cannot split', () => {
    expect(parseAddress('301 Lowell St')).toMatchObject({ line1: '301 Lowell St' })
    expect(parseAddress('301 Lowell St').city).toBeUndefined()
  })

  it('uppercases a lowercase state', () => {
    expect(parseAddress('1 A St, Rome, ga 30161').state).toBe('GA')
  })

  it('handles empty input', () => {
    expect(parseAddress('')).toEqual({ line1: '', full: '' })
    expect(parseAddress(null)).toEqual({ line1: '', full: '' })
  })

  it('always preserves the original full string', () => {
    expect(parseAddress('  42 Peachtree, Atlanta, GA  ').full).toBe('42 Peachtree, Atlanta, GA')
  })
})
