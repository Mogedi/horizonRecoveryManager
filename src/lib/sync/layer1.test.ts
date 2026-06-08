import { describe, it, expect, vi, beforeEach } from 'vitest'

// --- Hoisted mocks -------------------------------------------------------

const mockHubspotSearchAll = vi.hoisted(() => vi.fn())
const mockMapDeal = vi.hoisted(() => vi.fn())
const mockAssertDailyLimitOk = vi.hoisted(() => vi.fn())
const mockStartSyncLog = vi.hoisted(() => vi.fn())
const mockCompleteSyncLog = vi.hoisted(() => vi.fn())
const mockFailSyncLog = vi.hoisted(() => vi.fn())
const mockGetLastSyncedAt = vi.hoisted(() => vi.fn())
const mockUpsertDeals = vi.hoisted(() => vi.fn())

vi.mock('@/lib/hubspot/client', () => ({ hubspotSearchAll: mockHubspotSearchAll }))
vi.mock('@/lib/hubspot/mapper', () => ({ mapDeal: mockMapDeal }))
vi.mock('@/lib/db/sync-log', () => ({
  assertDailyLimitOk: mockAssertDailyLimitOk,
  startSyncLog: mockStartSyncLog,
  completeSyncLog: mockCompleteSyncLog,
  failSyncLog: mockFailSyncLog,
  getLastSyncedAt: mockGetLastSyncedAt,
}))
vi.mock('@/lib/db/deals', () => ({ upsertDeals: mockUpsertDeals }))

import { runLayer1Sync } from './layer1'

const MAPPED_DEAL = {
  hubspotId: 'deal-1',
  name: 'Test Deal',
  stage: 'stage-1',
  pipeline: 'pipeline-1',
  ownerId: null,
  amount: null,
  estimatedSurplus: null,
  closeDate: null,
  lastActivityDate: null,
  stageEnteredAt: null,
  lastModified: null,
  contactCount: 0,
  propertyAddress: null,
  county: null,
  parcelId: null,
  taxSaleDate: null,
  hubspotUrl: null,
  rawPayload: {},
}

const LOG_ENTRY = { id: 1 }

beforeEach(() => {
  vi.clearAllMocks()
  mockAssertDailyLimitOk.mockResolvedValue(undefined)
  mockStartSyncLog.mockResolvedValue(LOG_ENTRY)
  mockCompleteSyncLog.mockResolvedValue(undefined)
  mockFailSyncLog.mockResolvedValue(undefined)
  mockGetLastSyncedAt.mockResolvedValue(null)
  mockUpsertDeals.mockResolvedValue(undefined)
  mockMapDeal.mockReturnValue(MAPPED_DEAL)
})

describe('runLayer1Sync', () => {
  it('calls upsertDeals (not prisma directly) with mapped deals', async () => {
    mockHubspotSearchAll.mockResolvedValue({
      results: [{ id: 'deal-1', properties: {} }],
      callCount: 1,
    })

    await runLayer1Sync()

    expect(mockUpsertDeals).toHaveBeenCalledOnce()
    expect(mockUpsertDeals).toHaveBeenCalledWith([MAPPED_DEAL])
  })

  it('calls completeSyncLog on success', async () => {
    mockHubspotSearchAll.mockResolvedValue({ results: [], callCount: 1 })

    await runLayer1Sync()

    expect(mockCompleteSyncLog).toHaveBeenCalledWith(LOG_ENTRY.id, 1, 0)
    expect(mockFailSyncLog).not.toHaveBeenCalled()
  })

  it('calls failSyncLog and re-throws when upsertDeals fails', async () => {
    mockHubspotSearchAll.mockResolvedValue({
      results: [{ id: 'deal-1', properties: {} }],
      callCount: 1,
    })
    mockUpsertDeals.mockRejectedValue(new Error('transaction timeout'))

    await expect(runLayer1Sync()).rejects.toThrow('transaction timeout')
    expect(mockFailSyncLog).toHaveBeenCalledWith(LOG_ENTRY.id, 'transaction timeout')
    expect(mockCompleteSyncLog).not.toHaveBeenCalled()
  })

  it('returns dealsSynced count, apiCallsMade, and mode', async () => {
    mockHubspotSearchAll.mockResolvedValue({
      results: [{ id: 'deal-1', properties: {} }, { id: 'deal-2', properties: {} }],
      callCount: 2,
    })
    mockMapDeal.mockReturnValue(MAPPED_DEAL)

    const result = await runLayer1Sync()

    expect(result.dealsSynced).toBe(2)
    expect(result.apiCallsMade).toBe(2)
    expect(result.mode).toBe('full')
  })

  it('uses smart mode when lastSyncedAt is available and force=false', async () => {
    mockGetLastSyncedAt.mockResolvedValue(new Date('2026-06-01'))
    mockHubspotSearchAll.mockResolvedValue({ results: [], callCount: 1 })

    const result = await runLayer1Sync(false)

    expect(result.mode).toBe('smart')
  })

  it('uses full mode when force=true even if lastSyncedAt exists', async () => {
    mockGetLastSyncedAt.mockResolvedValue(new Date('2026-06-01'))
    mockHubspotSearchAll.mockResolvedValue({ results: [], callCount: 1 })

    const result = await runLayer1Sync(true)

    expect(result.mode).toBe('full')
  })
})
