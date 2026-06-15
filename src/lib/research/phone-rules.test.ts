import { describe, it, expect } from 'vitest'
import { phoneKey, isTollFree, isLikelyJunk, prefilterPhone, nameKey } from './phone-rules'

describe('phone-rules', () => {
  it('phoneKey takes the last 10 digits (country-code safe)', () => {
    expect(phoneKey('+1 (404) 555-1234')).toBe('4045551234')
    expect(phoneKey('404.555.1234')).toBe('4045551234')
  })
  it('isTollFree flags 8xx service lines, not normal lines', () => {
    expect(isTollFree('8005551234')).toBe(true)
    expect(isTollFree('+1 888 555 1234')).toBe(true)
    expect(isTollFree('4045551234')).toBe(false)
  })
  it('isLikelyJunk flags wrong length, all-same, and 555-01xx fictional', () => {
    expect(isLikelyJunk('12345')).toBe(true)
    expect(isLikelyJunk('5555555555')).toBe(true)
    expect(isLikelyJunk('4045550123')).toBe(true)
    expect(isLikelyJunk('4045551234')).toBe(false)
  })
  it('prefilterPhone skips toll-free unless business; passes normal lines', () => {
    expect(prefilterPhone('8005551234').skip).toBe(true)
    expect(prefilterPhone('8005551234', { business: true }).skip).toBe(false)
    expect(prefilterPhone('4045551234').skip).toBe(false)
  })
  it('nameKey is order-insensitive', () => {
    expect(nameKey('John Smith')).toBe(nameKey('Smith, John'))
  })
})
