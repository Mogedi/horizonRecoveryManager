import { describe, it, expect } from 'vitest'
import { fuzzyScore } from './cases-read.js'

describe('fuzzyScore', () => {
  const albertha = 'CHATHAM - 12 Main St - Albertha Jones ($40K)'
  const other = 'UPSON - 42 Edgewood Ave - Tracey Dobrozsi ($38K)'

  it('ranks a misspelled name above an unrelated one', () => {
    expect(fuzzyScore(albertha, 'alberta')).toBeGreaterThan(fuzzyScore(other, 'alberta'))
  })

  it('clears the search threshold for a 1-char typo', () => {
    expect(fuzzyScore(albertha, 'alberta')).toBeGreaterThan(0.55)
  })

  it('scores a direct substring as 1', () => {
    expect(fuzzyScore('UPSON - Tracey Dobrozsi', 'tracey')).toBe(1)
    expect(fuzzyScore(albertha, 'chatham')).toBe(1)
  })

  it('scores unrelated queries low', () => {
    expect(fuzzyScore(other, 'zzzzzz')).toBeLessThan(0.55)
  })
})
