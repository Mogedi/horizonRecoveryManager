import { describe, it, expect, vi, afterEach } from 'vitest'
import { formatAmount, relativeDate, formatDate } from './format'

afterEach(() => {
  vi.useRealTimers()
})

describe('formatAmount', () => {
  it('returns empty string for null', () => {
    expect(formatAmount(null)).toBe('')
  })

  it('formats a whole dollar amount', () => {
    expect(formatAmount(12500)).toBe('$12,500')
  })

  it('rounds to nearest dollar', () => {
    expect(formatAmount(1234.78)).toBe('$1,235')
  })
})

describe('relativeDate', () => {
  it('returns em dash for null', () => {
    expect(relativeDate(null)).toBe('—')
  })

  it('returns "yesterday" for ~25 hours ago', () => {
    vi.useFakeTimers()
    const now = new Date('2026-06-07T12:00:00Z')
    vi.setSystemTime(now)
    const yesterday = new Date('2026-06-06T11:00:00Z') // 25h ago
    expect(relativeDate(yesterday)).toBe('yesterday')
  })

  it('returns "X d ago" for multiple days', () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-06-07T12:00:00Z'))
    const fiveDaysAgo = new Date('2026-06-02T12:00:00Z')
    expect(relativeDate(fiveDaysAgo)).toBe('5d ago')
  })
})

describe('formatDate', () => {
  it('returns em dash for null', () => {
    expect(formatDate(null)).toBe('—')
  })

  it('formats a date string to short US format', () => {
    // Note: output is timezone-dependent (America/New_York)
    const result = formatDate('2026-06-07T00:00:00Z')
    expect(result).toMatch(/Jun/)
    expect(result).toMatch(/2026/)
  })

  it('accepts custom Intl options', () => {
    const result = formatDate('2026-06-07T00:00:00Z', { year: undefined })
    expect(result).not.toContain('2026')
  })
})
