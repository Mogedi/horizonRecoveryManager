import { describe, it, expect, vi } from 'vitest'

// Avoid instantiating the real Prisma client (no DATABASE_URL in tests).
vi.mock('./client', () => ({ prisma: {} }))

import { isAnalysisType, isCaseHealth, isCasePriority } from './case-analysis'

describe('case-analysis enum guards', () => {
  it('isAnalysisType accepts the five types, rejects junk', () => {
    for (const t of ['triage', 'priority', 'legal_review', 'document_review', 'attorney_recommendation']) {
      expect(isAnalysisType(t)).toBe(true)
    }
    expect(isAnalysisType('weird')).toBe(false)
    expect(isAnalysisType('')).toBe(false)
  })

  it('isCaseHealth matches the existing CaseHealthStatus vocabulary', () => {
    for (const h of ['active', 'waiting', 'blocked', 'on_track', 'unknown']) {
      expect(isCaseHealth(h)).toBe(true)
    }
    // Drift guards — freeform / off-vocab values are rejected
    expect(isCaseHealth('super blocked and weird')).toBe(false)
    expect(isCaseHealth('healthy')).toBe(false)
  })

  it('isCasePriority accepts urgent|high|normal|low only', () => {
    for (const p of ['urgent', 'high', 'normal', 'low']) {
      expect(isCasePriority(p)).toBe(true)
    }
    expect(isCasePriority('immediately')).toBe(false)
  })
})
