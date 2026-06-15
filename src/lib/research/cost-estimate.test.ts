import { describe, it, expect } from 'vitest'
import { estimateRunCost, backtestCalibration, type RunCost } from './cost-estimate'

const run = (goal: string, usd: number, at: number, caseType?: string): RunCost => ({ id: `${goal}-${at}`, goal, caseType, usd, at })

describe('estimateRunCost', () => {
  it('estimates by goal with a p25–p75 range, recency-weighted (EWMA > plain mean)', () => {
    const h = [run('find_heirs', 0.3, 1), run('find_heirs', 0.5, 2), run('find_heirs', 0.9, 3)]
    const e = estimateRunCost('find_heirs', null, h)
    expect(e.level).toBe('goal')
    expect(e.n).toBe(3)
    expect(e.low).toBeLessThanOrEqual(e.predicted)
    expect(e.high).toBeGreaterThanOrEqual(e.predicted)
    expect(e.predicted).toBeGreaterThan(0.567) // recency pulls toward the latest 0.9 vs the 0.567 mean
  })
  it('separates goals — property ≫ heirs', () => {
    const h = [run('find_heirs', 0.3, 1), run('find_heirs', 0.5, 2), run('property_records', 5, 1), run('property_records', 6, 2)]
    expect(estimateRunCost('property_records', null, h).predicted)
      .toBeGreaterThan(estimateRunCost('find_heirs', null, h).predicted)
  })
  it('falls back goal → global → none as the sample shrinks', () => {
    expect(estimateRunCost('unseen', null, [run('find_heirs', 0.3, 1), run('x', 0.5, 2)]).level).toBe('global')
    expect(estimateRunCost('x', null, []).level).toBe('none')
  })
  it('prefers goal+type when enough same-type history exists', () => {
    const h = [run('find_heirs', 0.3, 1, 'tax_sale'), run('find_heirs', 0.4, 2, 'tax_sale'), run('find_heirs', 2, 3, 'estate_sale')]
    expect(estimateRunCost('find_heirs', 'tax_sale', h).level).toBe('goal+type')
  })
})

describe('backtestCalibration', () => {
  it('predicts each run from PRIOR runs only (no leakage) and summarizes error', () => {
    const h = [run('find_heirs', 0.4, 1), run('find_heirs', 0.5, 2), run('find_heirs', 0.6, 3), run('find_heirs', 0.5, 4)]
    const c = backtestCalibration(h)
    expect(c.n).toBe(2) // runs #3 and #4 have ≥2 prior same-goal runs; #1/#2 don't
    expect(c.points.every(p => p.predicted > 0 && p.actual > 0)).toBe(true)
    expect(typeof c.mape).toBe('number')
    expect(typeof c.bias).toBe('number')
  })
})
