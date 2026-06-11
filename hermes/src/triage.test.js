import { describe, it, expect } from 'vitest'
import { parseAnalysis, computeInputHash } from './triage.js'

describe('parseAnalysis', () => {
  const valid = JSON.stringify({
    health: 'blocked', priority: 'high', statusLabel: 'Waiting on county',
    blockers: ['no death cert'], recommendations: ['call clerk'], risks: ['statute clock'],
    nextAction: 'Call clerk Monday', moActionRequired: true, reasoning: 'stalled', confidence: 0.8,
  })

  it('parses a clean JSON analysis', () => {
    const a = parseAnalysis(valid)
    expect(a.health).toBe('blocked')
    expect(a.priority).toBe('high')
    expect(a.blockers).toEqual(['no death cert'])
    expect(a.moActionRequired).toBe(true)
    expect(a.confidence).toBe(0.8)
  })

  it('extracts JSON wrapped in prose / code fences', () => {
    const a = parseAnalysis('Here you go:\n```json\n' + valid + '\n```')
    expect(a.health).toBe('blocked')
  })

  it('rejects an off-vocabulary health (drift guard)', () => {
    expect(() => parseAnalysis(JSON.stringify({ health: 'super blocked', priority: 'high' }))).toThrow(/health/)
  })

  it('rejects an invalid priority', () => {
    expect(() => parseAnalysis(JSON.stringify({ health: 'blocked', priority: 'now' }))).toThrow(/priority/)
  })

  it('coerces missing/!string arrays to []', () => {
    const a = parseAnalysis(JSON.stringify({ health: 'unknown', priority: 'low', blockers: 'nope' }))
    expect(a.blockers).toEqual([])
    expect(a.recommendations).toEqual([])
  })
})

describe('computeInputHash', () => {
  const base = {
    deal: { stage: 'S1', last_activity_date: '2026-06-01' },
    activity: [{ ts: 't1', type: 'call', outcome: 'answered', body: 'spoke' }],
    contacts: [{ name: 'A', contact_type: 'owner', ownership_status: 'ok' }],
  }

  it('is deterministic for the same facts', () => {
    expect(computeInputHash(base)).toBe(computeInputHash(structuredClone(base)))
  })

  it('changes when a fact changes', () => {
    const changed = { ...base, deal: { ...base.deal, stage: 'S2' } }
    expect(computeInputHash(changed)).not.toBe(computeInputHash(base))
  })

  it('ignores non-fact fields (e.g. latestAnalysis)', () => {
    const withAnalysis = { ...base, latestAnalysis: { id: 9, input_hash: 'whatever' } }
    expect(computeInputHash(withAnalysis)).toBe(computeInputHash(base))
  })
})
