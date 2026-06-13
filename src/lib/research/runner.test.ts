import { describe, it, expect, vi } from 'vitest'

// Runner persistence is off in these tests; mock the DB module so no Prisma client is constructed.
vi.mock('@/lib/db/research', () => ({ logSourceAttempt: vi.fn() }))

import { runResearch } from './runner'
import type { SourceAdapter, Candidate } from './types'

const candidate: Candidate = {
  sourceId: 'a', url: 'u', name: 'J', addresses: [], phones: [], emails: [], relatives: [],
  ageOrDob: null, deceased: null, signals: [],
}

const mk = (id: string, opts: { candidates?: Candidate[]; throws?: boolean }): SourceAdapter => ({
  id, label: id, kind: 'property', coverage: {}, enabled: true,
  async search(q, ctx) {
    if (opts.throws) throw new Error('boom')
    return {
      attempt: { sourceId: id, caseId: q.caseId ?? null, status: 'success', latencyMs: 1, candidateCount: opts.candidates?.length ?? 0, proxyUsed: ctx.proxyUsed, timestamp: new Date() },
      candidates: opts.candidates ?? [],
    }
  },
})

describe('runResearch', () => {
  it('aggregates candidates and attempts (persistence off)', async () => {
    const r = await runResearch([mk('a', { candidates: [candidate] }), mk('b', {})], { name: 'J' }, { persist: false, paceMs: 0 })
    expect(r.attempts).toHaveLength(2)
    expect(r.candidates).toHaveLength(1)
  })

  it('turns a throwing adapter into an error attempt instead of crashing', async () => {
    const r = await runResearch([mk('a', { throws: true })], { name: 'J' }, { persist: false, paceMs: 0 })
    expect(r.attempts[0].status).toBe('error')
  })

  it('honors the circuit-breaker skip predicate', async () => {
    const r = await runResearch([mk('a', {}), mk('b', {})], { name: 'J' }, {
      persist: false, paceMs: 0, shouldSkip: a => a.id === 'b',
    })
    expect(r.skipped).toEqual(['b'])
    expect(r.attempts).toHaveLength(1)
  })
})
