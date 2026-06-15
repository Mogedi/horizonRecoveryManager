import { describe, it, expect } from 'vitest'
import { aggregateCost } from './client'

describe('aggregateCost', () => {
  it('aggregates cents→$ by workspace+model across buckets, flags Hermes, sorts, skips zero', () => {
    const buckets = [
      { results: [
        { amount: '3062', workspace_id: 'wrk_default', model: 'claude-sonnet-4-6' },
        { amount: '93', workspace_id: 'wrk_default', model: 'claude-haiku-4-5' },
        { amount: '1500', workspace_id: 'wrk_hermes', model: 'claude-sonnet-4-6' },
        { amount: '500', workspace_id: 'wrk_hermes', model: 'claude-haiku-4-5' },
      ] },
      { results: [
        { amount: '1000', workspace_id: 'wrk_hermes', model: 'claude-sonnet-4-6' }, // merges with bucket 1
        { amount: 0, workspace_id: 'wrk_hermes', model: 'claude-opus-4-8' },         // zero → skipped
      ] },
    ]
    const wsName = new Map([['wrk_default', 'Default'], ['wrk_hermes', 'Hermes Research']])
    const r = aggregateCost(buckets, wsName, 'wrk_hermes')

    const def = r.byWorkspace.find(w => w.workspaceId === 'wrk_default')!
    const her = r.byWorkspace.find(w => w.workspaceId === 'wrk_hermes')!
    expect(def.usd).toBeCloseTo(31.55, 2)   // (3062+93)/100
    expect(her.usd).toBeCloseTo(30.0, 2)    // (1500+1000+500)/100
    expect(her.isHermes).toBe(true)
    expect(def.isHermes).toBe(false)
    expect(her.byModel.map(m => [m.model, m.usd])).toEqual([['claude-sonnet-4-6', 25], ['claude-haiku-4-5', 5]])
    expect(r.byWorkspace[0].workspaceId).toBe('wrk_default') // sorted by $ desc
    expect(her.byModel.some(m => m.model === 'claude-opus-4-8')).toBe(false) // zero dropped
    expect(r.totalUsd).toBeCloseTo(61.55, 2)
    expect(r.byModelTotal.find(m => m.model === 'claude-sonnet-4-6')!.usd).toBeCloseTo(55.62, 2)
  })

  it('handles description-as-object model, null workspace (default), and non-claude descriptions', () => {
    const buckets = [{ results: [
      { amount: '200', workspace_id: null, description: { model: 'claude-haiku-4-5' } },
      { amount: '2', workspace_id: null, description: 'Web Search Usage' },
    ] }]
    const r = aggregateCost(buckets, new Map(), null)
    expect(r.byWorkspace[0].workspaceId).toBe('default')
    expect(r.byWorkspace[0].byModel.map(m => m.model).sort()).toEqual(['Web Search Usage', 'claude-haiku-4-5'])
  })
})
