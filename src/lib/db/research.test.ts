import { describe, it, expect, vi, beforeEach } from 'vitest'

// --- Mocks (before importing the module under test) ----------------------
// vi.hoisted so these exist when the hoisted vi.mock factory runs.
const { mockCostFindMany, mockReqFindMany, mockPvFindMany } = vi.hoisted(() => ({
  mockCostFindMany: vi.fn(),
  mockReqFindMany: vi.fn(),
  mockPvFindMany: vi.fn(),
}))

vi.mock('@/lib/db/client', () => ({
  prisma: {
    researchCost: { findMany: mockCostFindMany },
    researchRequest: { findMany: mockReqFindMany },
    phoneValidation: { findMany: mockPvFindMany },
  },
}))

import { getResearchRunTelemetry, getRecentPhoneValidations, decidePhoneValidations } from './research'

const d = (s: string) => new Date(s)
beforeEach(() => vi.clearAllMocks())

describe('getResearchRunTelemetry', () => {
  // Regression guard: a run has MULTIPLE cost rows (one per model). The old dossier cost used findFirst
  // and undercounted; the run rollup must SUM every row for a request into one search.
  it('groups all cost rows of one request into a single run, summing $ and splitting by model', async () => {
    mockCostFindMany.mockResolvedValue([
      { id: 3, sessionId: 's3', requestId: 7, model: 'claude-sonnet-4-6', inTokens: 10, outTokens: 100, firecrawlCalls: 1, usd: 0.20, runSeconds: 500, createdAt: d('2026-06-13T06:00:00Z') },
      { id: 2, sessionId: 's2', requestId: 7, model: 'claude-haiku-4-5', inTokens: 50, outTokens: 200, firecrawlCalls: 2, usd: 0.05, runSeconds: 480, createdAt: d('2026-06-13T05:59:00Z') },
      { id: 1, sessionId: 's1', requestId: 7, model: 'claude-sonnet-4-6', inTokens: 5, outTokens: 40, firecrawlCalls: 0, usd: 0.03, runSeconds: 100, createdAt: d('2026-06-13T05:58:00Z') },
    ])
    mockReqFindMany.mockResolvedValue([{ id: 7, query: { name: 'Jane Doe' }, goal: 'find_heirs', startedAt: d('2026-06-13T05:50:00Z'), dossierId: 11 }])

    const runs = await getResearchRunTelemetry(10)

    expect(runs).toHaveLength(1)
    const r = runs[0]
    expect(r.name).toBe('Jane Doe')
    expect(r.goal).toBe('find_heirs')
    expect(r.dossierId).toBe(11)
    expect(r.usd).toBeCloseTo(0.28, 4)      // 0.20 + 0.05 + 0.03 — would be 0.20 under the old findFirst bug
    expect(r.inTokens).toBe(65)
    expect(r.firecrawlCalls).toBe(3)
    expect(r.runSeconds).toBe(500)          // max across the run's rows
    expect(r.byModel.map(m => [m.model, m.usd])).toEqual([
      ['claude-sonnet-4-6', 0.23],          // two sonnet rows merged, sorted $ desc
      ['claude-haiku-4-5', 0.05],
    ])
  })

  it('falls back to session grouping when a cost row has no request link', async () => {
    mockCostFindMany.mockResolvedValue([
      { id: 9, sessionId: 'sx', requestId: null, model: 'claude-sonnet-4-6', inTokens: 1, outTokens: 2, firecrawlCalls: 0, usd: 0.10, runSeconds: 3, createdAt: d('2026-06-13T07:00:00Z') },
    ])
    mockReqFindMany.mockResolvedValue([])

    const runs = await getResearchRunTelemetry(10)

    expect(runs).toHaveLength(1)
    expect(runs[0].name).toBeNull()
    expect(runs[0].usd).toBeCloseTo(0.10, 4)
  })

  // Regression guard: cost-row createdAt is the SYNC time (batched), so ordering must use request.startedAt.
  it('orders by the request run time (startedAt), not the batched cost-row sync time', async () => {
    mockCostFindMany.mockResolvedValue([
      { id: 20, sessionId: 'a', requestId: 1, model: 'claude-sonnet-4-6', inTokens: 1, outTokens: 1, firecrawlCalls: 0, usd: 0.10, runSeconds: 10, createdAt: d('2026-06-15T03:19:00Z') },
      { id: 21, sessionId: 'b', requestId: 2, model: 'claude-sonnet-4-6', inTokens: 1, outTokens: 1, firecrawlCalls: 0, usd: 0.20, runSeconds: 10, createdAt: d('2026-06-15T03:19:00Z') },
    ]) // same sync time on both
    mockReqFindMany.mockResolvedValue([
      { id: 1, query: { name: 'Earlier' }, goal: 'find_heirs', startedAt: d('2026-06-14T01:00:00Z'), dossierId: null },
      { id: 2, query: { name: 'Later' }, goal: 'find_heirs', startedAt: d('2026-06-15T01:00:00Z'), dossierId: null },
    ])

    const runs = await getResearchRunTelemetry(10)

    expect(runs.map(r => r.name)).toEqual(['Later', 'Earlier']) // newest run first, by startedAt
  })
})

const vrow = (o: Record<string, unknown>) => ({
  number: '', isValid: null, activityScore: null, lineType: null, carrier: null, nameMatch: null,
  matchedName: null, matchedNameKey: null, contactGrade: null, provider: 'trestle', validatedAt: new Date('2026-06-15T00:00:00Z'), ...o,
})

describe('getRecentPhoneValidations (durable store read)', () => {
  it('reads the table, keyed by last-10 digits; empty input skips the DB', async () => {
    mockPvFindMany.mockResolvedValue([vrow({ phoneKey: '4045551234', number: '(404) 555-1234', isValid: true, activityScore: 90 })])
    const r = await getRecentPhoneValidations(['+1 404 555 1234'])
    expect(r['4045551234'].isValid).toBe(true)

    mockPvFindMany.mockClear()
    expect(await getRecentPhoneValidations([])).toEqual({})
    expect(mockPvFindMany).not.toHaveBeenCalled()
  })
})

describe('decidePhoneValidations (the pre-pay rules)', () => {
  it('skips toll-free + junk, reuses same-person, skips known-dead + someone-else, validates the rest', async () => {
    mockPvFindMany.mockResolvedValue([
      vrow({ phoneKey: '4045551111', number: '4045551111', isValid: true, activityScore: 88, nameMatch: true, matchedName: 'Jane Doe', matchedNameKey: 'doe jane' }),
      vrow({ phoneKey: '4045552222', number: '4045552222', isValid: false, activityScore: 0 }), // dead
      vrow({ phoneKey: '4045553333', number: '4045553333', isValid: true, activityScore: 70, nameMatch: true, matchedName: 'Bob Roe', matchedNameKey: 'bob roe' }), // someone else
    ])
    const d = await decidePhoneValidations(
      ['404-555-1111', '4045552222', '4045553333', '8005559999', '5555555555', '4045554444'],
      'Jane Doe',
    )
    const by = Object.fromEntries(d.map(x => [x.key || x.number, x.decision]))
    expect(by['4045551111']).toBe('reuse')        // same person
    expect(by['4045552222']).toBe('skip')         // known disconnected
    expect(by['4045553333']).toBe('skip')         // belongs to Bob Roe
    expect(by['8005559999']).toBe('skip')         // toll-free
    expect(by['5555555555']).toBe('skip')         // junk (all same digit)
    expect(by['4045554444']).toBe('validate')     // never seen
  })

  it('order-insensitive person match (Smith, John ↔ John Smith)', async () => {
    mockPvFindMany.mockResolvedValue([vrow({ phoneKey: '4045551111', number: '4045551111', isValid: true, activityScore: 80, nameMatch: true, matchedName: 'John Smith', matchedNameKey: 'john smith' })])
    const d = await decidePhoneValidations(['4045551111'], 'Smith, John')
    expect(d[0].decision).toBe('reuse')
  })
})
