import { describe, it, expect } from 'vitest'
import { deriveBand } from './confidence'

describe('deriveBand', () => {
  it('high when score is strong and not conflicted', () => expect(deriveBand(70, 0, 2)).toBe('high'))
  it('medium for moderate score', () => expect(deriveBand(40, 0, 1)).toBe('medium'))
  it('low for weak score', () => expect(deriveBand(10, 0, 1)).toBe('low'))
  it('conflicting when a rival identity scores comparably', () => expect(deriveBand(50, 40, 1)).toBe('conflicting'))
  it('not conflicting when rival is weak', () => expect(deriveBand(70, 10, 2)).toBe('high'))
})
