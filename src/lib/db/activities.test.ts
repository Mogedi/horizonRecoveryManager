import { describe, it, expect, vi, beforeEach } from 'vitest'

// --- Hoisted mocks -------------------------------------------------------

const mockGroupBy = vi.hoisted(() => vi.fn())
const mockDeleteMany = vi.hoisted(() => vi.fn())
const mockCreateMany = vi.hoisted(() => vi.fn())
const mockWithTransaction = vi.hoisted(() => vi.fn())

vi.mock('@/lib/db/client', () => ({
  prisma: {
    dealActivity: {
      findMany: vi.fn().mockResolvedValue([]),
      findFirst: vi.fn().mockResolvedValue(null),
      groupBy: mockGroupBy,
      deleteMany: mockDeleteMany,
      createMany: mockCreateMany,
    },
    dealContact: {
      findFirst: vi.fn().mockResolvedValue(null),
      deleteMany: mockDeleteMany,
      createMany: mockCreateMany,
    },
  },
}))

vi.mock('@/lib/db/transaction', () => ({
  withTransaction: mockWithTransaction,
}))

// --- Imports after mocks -------------------------------------------------

import { getEmployeeActivitySummary, replaceLayer2Data } from './activities'

// --- Tests ---------------------------------------------------------------

beforeEach(() => {
  vi.clearAllMocks()
})

// ---------------------------------------------------------------------------
// getEmployeeActivitySummary
// ---------------------------------------------------------------------------

describe('getEmployeeActivitySummary', () => {
  const ownerMap = { 'owner-1': 'Alice', 'owner-2': 'Bob' }

  it('returns null when no activity rows', async () => {
    mockGroupBy.mockResolvedValue([])
    const result = await getEmployeeActivitySummary(ownerMap)
    expect(result).toBeNull()
  })

  it('aggregates notes and calls per owner', async () => {
    mockGroupBy.mockResolvedValue([
      { authorOwnerId: 'owner-1', type: 'note', _count: { id: 3 } },
      { authorOwnerId: 'owner-1', type: 'call', _count: { id: 2 } },
      { authorOwnerId: 'owner-2', type: 'note', _count: { id: 1 } },
    ])

    const result = await getEmployeeActivitySummary(ownerMap)
    expect(result).toHaveLength(2)
    const alice = result!.find(r => r.ownerName === 'Alice')!
    expect(alice.notes).toBe(3)
    expect(alice.calls).toBe(2)
    const bob = result!.find(r => r.ownerName === 'Bob')!
    expect(bob.notes).toBe(1)
    expect(bob.calls).toBe(0)
  })

  it('uses owner ID as fallback when not in ownerMap', async () => {
    mockGroupBy.mockResolvedValue([
      { authorOwnerId: 'unknown-owner', type: 'note', _count: { id: 1 } },
    ])

    const result = await getEmployeeActivitySummary(ownerMap)
    expect(result![0].ownerName).toBe('unknown-owner')
  })

  it('handles null authorOwnerId by grouping under "unknown"', async () => {
    mockGroupBy.mockResolvedValue([
      { authorOwnerId: null, type: 'call', _count: { id: 5 } },
    ])

    const result = await getEmployeeActivitySummary(ownerMap)
    expect(result![0].ownerName).toBe('unknown')
    expect(result![0].calls).toBe(5)
  })

  it('queries only last 7 days', async () => {
    mockGroupBy.mockResolvedValue([])
    const before = new Date()
    before.setDate(before.getDate() - 7)

    await getEmployeeActivitySummary(ownerMap)

    const call = mockGroupBy.mock.calls[0][0]
    expect(call.where.timestamp.gte).toBeInstanceOf(Date)
    const cutoff: Date = call.where.timestamp.gte
    const diffMs = Math.abs(cutoff.getTime() - before.getTime())
    expect(diffMs).toBeLessThan(1000) // within 1s of 7 days ago
  })
})

// ---------------------------------------------------------------------------
// replaceLayer2Data
// ---------------------------------------------------------------------------

describe('replaceLayer2Data', () => {
  const dealId = 'deal-abc'
  const activities = [
    { type: 'note', body: 'Test note', authorOwnerId: 'owner-1', direction: null, timestamp: new Date(), metadata: null, rawPayload: {} },
  ]
  const contacts = [
    { contactHubspotId: 'contact-1', name: 'John Doe', contactType: 'owner', ownershipStatus: null, isDeceased: false, doNotContact: false, phoneNumbers: ['555-1234'], emailList: [], rawPayload: {} },
  ]

  it('calls withTransaction', async () => {
    mockWithTransaction.mockResolvedValue(undefined)
    await replaceLayer2Data(dealId, activities, contacts)
    expect(mockWithTransaction).toHaveBeenCalledOnce()
  })

  it('executes delete and create inside the transaction callback', async () => {
    // withTransaction calls the fn with a tx client
    mockWithTransaction.mockImplementation(async (fn: (tx: unknown) => Promise<void>) => {
      const tx = {
        dealActivity: { deleteMany: vi.fn().mockResolvedValue({}), createMany: vi.fn().mockResolvedValue({}) },
        dealContact: { deleteMany: vi.fn().mockResolvedValue({}), createMany: vi.fn().mockResolvedValue({}) },
      }
      await fn(tx)
      // Verify delete before create
      expect(tx.dealActivity.deleteMany).toHaveBeenCalledWith({ where: { dealHubspotId: dealId } })
      expect(tx.dealContact.deleteMany).toHaveBeenCalledWith({ where: { dealHubspotId: dealId } })
      expect(tx.dealActivity.createMany).toHaveBeenCalledOnce()
      expect(tx.dealContact.createMany).toHaveBeenCalledOnce()
    })

    await replaceLayer2Data(dealId, activities, contacts)
    expect(mockWithTransaction).toHaveBeenCalledOnce()
  })

  it('skips createMany for activities when list is empty', async () => {
    mockWithTransaction.mockImplementation(async (fn: (tx: unknown) => Promise<void>) => {
      const tx = {
        dealActivity: { deleteMany: vi.fn().mockResolvedValue({}), createMany: vi.fn() },
        dealContact: { deleteMany: vi.fn().mockResolvedValue({}), createMany: vi.fn().mockResolvedValue({}) },
      }
      await fn(tx)
      expect(tx.dealActivity.createMany).not.toHaveBeenCalled()
    })

    await replaceLayer2Data(dealId, [], contacts)
  })

  it('skips createMany for contacts when list is empty', async () => {
    mockWithTransaction.mockImplementation(async (fn: (tx: unknown) => Promise<void>) => {
      const tx = {
        dealActivity: { deleteMany: vi.fn().mockResolvedValue({}), createMany: vi.fn().mockResolvedValue({}) },
        dealContact: { deleteMany: vi.fn().mockResolvedValue({}), createMany: vi.fn() },
      }
      await fn(tx)
      expect(tx.dealContact.createMany).not.toHaveBeenCalled()
    })

    await replaceLayer2Data(dealId, activities, [])
  })
})
