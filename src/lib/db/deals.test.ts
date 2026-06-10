import { describe, it, expect, vi, beforeEach } from 'vitest'

// --- Hoisted mocks -------------------------------------------------------

const mockFindUnique = vi.hoisted(() => vi.fn())
const mockUpsert = vi.hoisted(() => vi.fn())
const mockUpdate = vi.hoisted(() => vi.fn())
const mockFindMany = vi.hoisted(() => vi.fn())
const mockWithBatchTransaction = vi.hoisted(() => vi.fn())

vi.mock('@/lib/db/client', () => ({
  prisma: {
    deal: {
      findUnique: mockFindUnique,
      upsert: mockUpsert,
      update: mockUpdate,
      findMany: mockFindMany,
    },
    dealSnooze: { findMany: vi.fn().mockResolvedValue([]) },
    dealContact: { findMany: vi.fn().mockResolvedValue([]) },
  },
}))

vi.mock('@/lib/db/transaction', () => ({
  withBatchTransaction: mockWithBatchTransaction,
}))

// --- Imports after mocks -------------------------------------------------

import { getDealById, upsertDeals, updateDealHubspotCheck, getDealsForBulkHubspotCheck } from './deals'

// --- Fixtures ------------------------------------------------------------

const DEAL_ROW = {
  hubspotId: 'deal-123',
  name: 'Test Property',
  stage: 'stage-1',
  ownerId: 'owner-1',
  amount: null,
  hubspotUrl: 'https://app.hubspot.com/contacts/123/deal/123',
  propertyAddress: '123 Main St',
  county: 'Harris',
  parcelId: 'PAR-001',
  taxSaleDate: null,
  contactCount: 2,
  lastActivityDate: new Date('2026-05-01'),
  stageEnteredAt: new Date('2026-04-01'),
  syncedAt: new Date('2026-05-15'),
}

const MAPPED_DEAL = {
  hubspotId: 'deal-456',
  name: 'Deal Name',
  stage: 'stage-2',
  pipeline: 'pipeline-1',
  ownerId: 'owner-2',
  amount: 5000,
  estimatedSurplus: null,
  closeDate: null,
  lastActivityDate: null,
  stageEnteredAt: null,
  lastModified: null,
  contactCount: 1,
  propertyAddress: null,
  county: null,
  parcelId: null,
  taxSaleDate: null,
  hubspotUrl: null,
  rawPayload: { id: 'deal-456' },
}

// --- Tests ---------------------------------------------------------------

beforeEach(() => {
  vi.clearAllMocks()
})

describe('getDealById', () => {
  it('returns the deal when found', async () => {
    mockFindUnique.mockResolvedValue(DEAL_ROW)
    const result = await getDealById('deal-123')
    expect(result).toEqual(DEAL_ROW)
  })

  it('returns null when deal does not exist', async () => {
    mockFindUnique.mockResolvedValue(null)
    const result = await getDealById('nonexistent')
    expect(result).toBeNull()
  })

  it('queries by hubspotId', async () => {
    mockFindUnique.mockResolvedValue(null)
    await getDealById('deal-999')
    expect(mockFindUnique).toHaveBeenCalledWith(
      expect.objectContaining({ where: { hubspotId: 'deal-999' } })
    )
  })

  it('selects all fields needed by the deal panel', async () => {
    mockFindUnique.mockResolvedValue(null)
    await getDealById('x')
    const call = mockFindUnique.mock.calls[0][0]
    const selected = Object.keys(call.select)
    expect(selected).toContain('hubspotId')
    expect(selected).toContain('name')
    expect(selected).toContain('stage')
    expect(selected).toContain('ownerId')
    expect(selected).toContain('amount')
    expect(selected).toContain('hubspotUrl')
    expect(selected).toContain('propertyAddress')
    expect(selected).toContain('syncedAt')
  })
})

describe('upsertDeals', () => {
  it('calls withBatchTransaction with one upsert per deal', async () => {
    mockWithBatchTransaction.mockResolvedValue([])
    mockUpsert.mockReturnValue(Promise.resolve({}))

    await upsertDeals([MAPPED_DEAL])

    expect(mockWithBatchTransaction).toHaveBeenCalledOnce()
    const [ops] = mockWithBatchTransaction.mock.calls[0]
    expect(ops).toHaveLength(1)
  })

  it('passes multiple deals as separate upsert operations', async () => {
    mockWithBatchTransaction.mockResolvedValue([])
    mockUpsert.mockReturnValue(Promise.resolve({}))

    const deals = [MAPPED_DEAL, { ...MAPPED_DEAL, hubspotId: 'deal-789' }]
    await upsertDeals(deals)

    const [ops] = mockWithBatchTransaction.mock.calls[0]
    expect(ops).toHaveLength(2)
  })

  it('uses hubspotId as the upsert where clause', async () => {
    mockWithBatchTransaction.mockResolvedValue([])
    mockUpsert.mockReturnValue(Promise.resolve({}))

    await upsertDeals([MAPPED_DEAL])

    expect(mockUpsert).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { hubspotId: 'deal-456' },
      })
    )
  })

  it('does nothing when passed an empty array', async () => {
    await upsertDeals([])
    expect(mockWithBatchTransaction).not.toHaveBeenCalled()
  })

  it('sets syncedAt on create and update', async () => {
    mockWithBatchTransaction.mockResolvedValue([])
    mockUpsert.mockReturnValue(Promise.resolve({}))

    await upsertDeals([MAPPED_DEAL])

    const call = mockUpsert.mock.calls[0][0]
    expect(call.create).toHaveProperty('syncedAt')
    expect(call.update).toHaveProperty('syncedAt')
  })
})

// ── Step 3: DB persistence ────────────────────────────────────────────────────

const CHECK_RESULT = {
  checked: true,
  filesLinked: true,
  linkedFiles: ['Tax Sale Deed.pdf'],
  missingFiles: [],
  confidence: 'high' as const,
  findings: ['Tax Sale Deed.pdf found in sidebar'],
  sessionExpired: false,
  checkedAt: '2026-06-09T03:00:00.000Z',
  detectionMethod: 'dom' as const,
  docStatuses: null,
}

describe('updateDealHubspotCheck', () => {
  beforeEach(() => {
    mockUpdate.mockResolvedValue({})
  })

  it('calls prisma.deal.update with hubspotId as the where clause', async () => {
    await updateDealHubspotCheck('deal-abc', CHECK_RESULT, 'fakejpeg')

    expect(mockUpdate).toHaveBeenCalledOnce()
    expect(mockUpdate.mock.calls[0][0].where).toEqual({ hubspotId: 'deal-abc' })
  })

  it('stores the check result as JSON (safe-cast), checkedAt as Date, and screenshot string', async () => {
    await updateDealHubspotCheck('deal-abc', CHECK_RESULT, 'fakejpeg')

    const data = mockUpdate.mock.calls[0][0].data
    expect(data.hubspotCheckAt).toBeInstanceOf(Date)
    expect(data.hubspotCheckAt.toISOString()).toBe('2026-06-09T03:00:00.000Z')
    expect(data.hubspotScreenshot).toBe('fakejpeg')
    expect(data.hubspotCheck).toMatchObject({ checked: true, filesLinked: true })
  })

  it('stores null screenshot when screenshotBase64 is null', async () => {
    await updateDealHubspotCheck('deal-abc', CHECK_RESULT, null)

    const data = mockUpdate.mock.calls[0][0].data
    expect(data.hubspotScreenshot).toBeNull()
  })
})

describe('getDealsForBulkHubspotCheck', () => {
  beforeEach(() => {
    mockFindMany.mockResolvedValue([
      { hubspotId: 'a', name: 'Deal A' },
      { hubspotId: 'b', name: 'Deal B' },
    ])
  })

  it('returns hubspotId and name fields', async () => {
    const deals = await getDealsForBulkHubspotCheck(false)
    expect(deals).toHaveLength(2)
    expect(deals[0]).toMatchObject({ hubspotId: 'a', name: 'Deal A' })
  })

  it('adds a where clause filtering unchecked/stale when uncheckedOnly=true', async () => {
    await getDealsForBulkHubspotCheck(true)

    const where = mockFindMany.mock.calls[0][0].where
    expect(where).toBeDefined()
    expect(where.OR).toHaveLength(2)
    // First condition: never checked
    expect(where.OR[0]).toEqual({ hubspotCheckAt: null })
    // Second condition: checked more than 7 days ago
    expect(where.OR[1].hubspotCheckAt.lt).toBeInstanceOf(Date)
  })

  it('passes no where clause when uncheckedOnly=false', async () => {
    await getDealsForBulkHubspotCheck(false)

    const where = mockFindMany.mock.calls[0][0].where
    expect(where).toBeUndefined()
  })
})
