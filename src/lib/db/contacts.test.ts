import { describe, it, expect, vi, beforeEach } from 'vitest'

// --- Hoisted mocks -------------------------------------------------------

const mockActivityEventFindMany = vi.hoisted(() => vi.fn())
const mockDealContactFindMany = vi.hoisted(() => vi.fn())

vi.mock('@/lib/db/client', () => ({
  prisma: {
    activityEvent: {
      findMany: mockActivityEventFindMany,
    },
    dealContact: {
      findMany: mockDealContactFindMany,
    },
  },
}))

// --- Imports after mocks -------------------------------------------------

import { getContactStats, getRecentCallsForContact } from './contacts'

// --- Helpers -------------------------------------------------------------

const dealId = 'deal-123'
const phones = ['+14045551234', '+16785554321']

function makeCall(overrides: {
  happenedAt?: Date
  outcome?: string
  toNumber?: string | null
  fromNumber?: string | null
  direction?: string
  durationSecs?: number | null
}) {
  return {
    id: Math.random(),
    happenedAt: new Date('2026-06-04T10:00:00Z'),
    outcome: 'voicemail',
    direction: 'outbound',
    toNumber: phones[0],
    fromNumber: null,
    durationSecs: null,
    ...overrides,
  }
}

beforeEach(() => {
  vi.clearAllMocks()
})

// ---------------------------------------------------------------------------
// getContactStats
// ---------------------------------------------------------------------------

describe('getContactStats', () => {
  it('returns zeros and nulls when e164Phones is empty', async () => {
    const stats = await getContactStats(dealId, [])
    expect(stats.totalCalls).toBe(0)
    expect(stats.conversations).toBe(0)
    expect(stats.lastConversationDate).toBeNull()
    expect(stats.lastCallDate).toBeNull()
    expect(stats.bestPhone).toBeNull()
    expect(stats.bestPhoneSource).toBe('inferred')
    expect(mockActivityEventFindMany).not.toHaveBeenCalled()
  })

  it('counts total calls correctly', async () => {
    mockActivityEventFindMany.mockResolvedValue([
      makeCall({ outcome: 'answered' }),
      makeCall({ outcome: 'voicemail' }),
      makeCall({ outcome: 'no_answer' }),
    ])
    const stats = await getContactStats(dealId, phones)
    expect(stats.totalCalls).toBe(3)
  })

  it('counts only answered calls as conversations', async () => {
    mockActivityEventFindMany.mockResolvedValue([
      makeCall({ outcome: 'answered' }),
      makeCall({ outcome: 'answered' }),
      makeCall({ outcome: 'voicemail' }),
    ])
    const stats = await getContactStats(dealId, phones)
    expect(stats.conversations).toBe(2)
    expect(stats.totalCalls).toBe(3)
  })

  it('lastConversationDate is the most recent answered call', async () => {
    const older = new Date('2026-05-01T10:00:00Z')
    const newer = new Date('2026-06-04T10:00:00Z')
    const voicemailNewest = new Date('2026-06-05T10:00:00Z')
    mockActivityEventFindMany.mockResolvedValue([
      makeCall({ outcome: 'answered', happenedAt: older }),
      makeCall({ outcome: 'answered', happenedAt: newer }),
      makeCall({ outcome: 'voicemail', happenedAt: voicemailNewest }),
    ])
    const stats = await getContactStats(dealId, phones)
    expect(stats.lastConversationDate).toEqual(newer)
  })

  it('lastConversationDate is null when no answered calls', async () => {
    mockActivityEventFindMany.mockResolvedValue([
      makeCall({ outcome: 'voicemail' }),
      makeCall({ outcome: 'no_answer' }),
    ])
    const stats = await getContactStats(dealId, phones)
    expect(stats.lastConversationDate).toBeNull()
  })

  it('lastCallDate is the most recent call of any outcome', async () => {
    const older = new Date('2026-05-01T10:00:00Z')
    const newer = new Date('2026-06-05T10:00:00Z')
    mockActivityEventFindMany.mockResolvedValue([
      makeCall({ outcome: 'voicemail', happenedAt: newer }),
      makeCall({ outcome: 'answered', happenedAt: older }),
    ])
    const stats = await getContactStats(dealId, phones)
    expect(stats.lastCallDate).toEqual(newer)
  })

  it('identifies bestPhone as the number with most answered outcomes', async () => {
    mockActivityEventFindMany.mockResolvedValue([
      makeCall({ outcome: 'answered', toNumber: phones[0] }),
      makeCall({ outcome: 'answered', toNumber: phones[0] }),
      makeCall({ outcome: 'answered', toNumber: phones[1] }),
    ])
    const stats = await getContactStats(dealId, phones)
    expect(stats.bestPhone).toBe(phones[0])
  })

  it('bestPhone falls back to fromNumber for inbound answered calls', async () => {
    mockActivityEventFindMany.mockResolvedValue([
      makeCall({ outcome: 'answered', toNumber: null, fromNumber: phones[1] }),
      makeCall({ outcome: 'answered', toNumber: null, fromNumber: phones[1] }),
    ])
    const stats = await getContactStats(dealId, phones)
    expect(stats.bestPhone).toBe(phones[1])
  })

  it('bestPhone is null when there are no answered calls', async () => {
    mockActivityEventFindMany.mockResolvedValue([
      makeCall({ outcome: 'voicemail' }),
    ])
    const stats = await getContactStats(dealId, phones)
    expect(stats.bestPhone).toBeNull()
  })

  it('bestPhoneSource is always "inferred"', async () => {
    mockActivityEventFindMany.mockResolvedValue([])
    const stats = await getContactStats(dealId, phones)
    expect(stats.bestPhoneSource).toBe('inferred')
  })
})

// ---------------------------------------------------------------------------
// getRecentCallsForContact
// ---------------------------------------------------------------------------

describe('getRecentCallsForContact', () => {
  it('returns empty array when e164Phones is empty', async () => {
    const calls = await getRecentCallsForContact(dealId, [])
    expect(calls).toEqual([])
    expect(mockActivityEventFindMany).not.toHaveBeenCalled()
  })

  it('queries with ORDER BY happenedAt DESC and default limit of 5', async () => {
    mockActivityEventFindMany.mockResolvedValue([])
    await getRecentCallsForContact(dealId, phones)
    expect(mockActivityEventFindMany).toHaveBeenCalledWith(
      expect.objectContaining({
        orderBy: { happenedAt: 'desc' },
        take: 5,
      })
    )
  })

  it('respects a custom limit', async () => {
    mockActivityEventFindMany.mockResolvedValue([])
    await getRecentCallsForContact(dealId, phones, 3)
    expect(mockActivityEventFindMany).toHaveBeenCalledWith(
      expect.objectContaining({ take: 3 })
    )
  })

  it('does not include a summary field in the select', async () => {
    mockActivityEventFindMany.mockResolvedValue([])
    await getRecentCallsForContact(dealId, phones)
    const { select } = mockActivityEventFindMany.mock.calls[0][0] as { select: Record<string, unknown> }
    expect(select).not.toHaveProperty('summary')
    expect(select).not.toHaveProperty('transcript')
  })

  it('returns id, happenedAt, direction, outcome, durationSecs from DB result', async () => {
    const happenedAt = new Date('2026-06-04T10:00:00Z')
    mockActivityEventFindMany.mockResolvedValue([
      { id: 42, happenedAt, direction: 'outbound', outcome: 'answered', durationSecs: 185 },
    ])
    const calls = await getRecentCallsForContact(dealId, phones)
    expect(calls[0]).toEqual({ id: 42, happenedAt, direction: 'outbound', outcome: 'answered', durationSecs: 185 })
  })
})
