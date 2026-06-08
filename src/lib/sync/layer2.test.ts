import { describe, it, expect, vi, beforeEach } from 'vitest'

// --- Hoisted mocks -------------------------------------------------------

const mockGetAssociationIds = vi.hoisted(() => vi.fn())
const mockBatchReadObjects = vi.hoisted(() => vi.fn())
const mockBatchReadContacts = vi.hoisted(() => vi.fn())
const mockMapContact = vi.hoisted(() => vi.fn())
const mockMapActivity = vi.hoisted(() => vi.fn())
const mockAssertDailyLimitOk = vi.hoisted(() => vi.fn())
const mockStartSyncLog = vi.hoisted(() => vi.fn())
const mockCompleteSyncLog = vi.hoisted(() => vi.fn())
const mockFailSyncLog = vi.hoisted(() => vi.fn())
const mockReplaceLayer2Data = vi.hoisted(() => vi.fn())

vi.mock('@/lib/hubspot/client', () => ({
  getAssociationIds: mockGetAssociationIds,
  batchReadObjects: mockBatchReadObjects,
  batchReadContacts: mockBatchReadContacts,
}))
vi.mock('@/lib/hubspot/mapper', () => ({
  mapContact: mockMapContact,
  mapActivity: mockMapActivity,
}))
vi.mock('@/lib/db/sync-log', () => ({
  assertDailyLimitOk: mockAssertDailyLimitOk,
  startSyncLog: mockStartSyncLog,
  completeSyncLog: mockCompleteSyncLog,
  failSyncLog: mockFailSyncLog,
}))
vi.mock('@/lib/db/activities', () => ({ replaceLayer2Data: mockReplaceLayer2Data }))

import { runLayer2Sync } from './layer2'

const LOG_ENTRY = { id: 2 }
const NOTE_OBJ = { id: 'note-1', properties: { hs_note_body: 'Note text', hs_timestamp: '2026-05-01' } }
const MAPPED_ACTIVITY = { type: 'note', body: 'Note text', authorOwnerId: null, direction: null, timestamp: new Date(), metadata: null, rawPayload: {} }
const CONTACT_OBJ = { id: 'contact-1', properties: { firstname: 'John', lastname: 'Doe' } }
const MAPPED_CONTACT = { contactHubspotId: 'contact-1', name: 'John Doe', contactType: null, ownershipStatus: null, isDeceased: false, doNotContact: false, phoneNumbers: [], emailList: [], rawPayload: {} }

beforeEach(() => {
  vi.clearAllMocks()
  mockAssertDailyLimitOk.mockResolvedValue(undefined)
  mockStartSyncLog.mockResolvedValue(LOG_ENTRY)
  mockCompleteSyncLog.mockResolvedValue(undefined)
  mockFailSyncLog.mockResolvedValue(undefined)
  mockReplaceLayer2Data.mockResolvedValue(undefined)
  // Default: no associations
  mockGetAssociationIds.mockResolvedValue([])
  mockBatchReadObjects.mockResolvedValue({ results: [] })
  mockBatchReadContacts.mockResolvedValue({ results: [] })
  mockMapActivity.mockReturnValue(MAPPED_ACTIVITY)
  mockMapContact.mockReturnValue(MAPPED_CONTACT)
})

describe('runLayer2Sync', () => {
  it('calls replaceLayer2Data (not prisma directly) with mapped data', async () => {
    mockGetAssociationIds
      .mockResolvedValueOnce(['note-1']) // notes
      .mockResolvedValueOnce([])         // tasks
      .mockResolvedValueOnce([])         // calls
      .mockResolvedValueOnce([])         // emails
      .mockResolvedValueOnce([])         // contacts

    mockBatchReadObjects.mockResolvedValueOnce({ results: [NOTE_OBJ] })

    await runLayer2Sync('deal-abc')

    expect(mockReplaceLayer2Data).toHaveBeenCalledOnce()
    const [dealId, activities, contacts] = mockReplaceLayer2Data.mock.calls[0]
    expect(dealId).toBe('deal-abc')
    expect(activities).toHaveLength(1)
    expect(contacts).toHaveLength(0)
  })

  it('calls completeSyncLog on success', async () => {
    await runLayer2Sync('deal-abc')
    expect(mockCompleteSyncLog).toHaveBeenCalledWith(LOG_ENTRY.id, expect.any(Number), 1)
    expect(mockFailSyncLog).not.toHaveBeenCalled()
  })

  it('calls failSyncLog and re-throws when replaceLayer2Data fails', async () => {
    mockReplaceLayer2Data.mockRejectedValue(new Error('transaction failed'))

    await expect(runLayer2Sync('deal-abc')).rejects.toThrow('transaction failed')
    expect(mockFailSyncLog).toHaveBeenCalledWith(LOG_ENTRY.id, 'transaction failed')
    expect(mockCompleteSyncLog).not.toHaveBeenCalled()
  })

  it('returns apiCallsMade, activitiesStored, contactsStored', async () => {
    mockGetAssociationIds
      .mockResolvedValueOnce([])  // notes
      .mockResolvedValueOnce([])  // tasks
      .mockResolvedValueOnce([])  // calls
      .mockResolvedValueOnce([])  // emails
      .mockResolvedValueOnce(['contact-1'])  // contacts

    mockBatchReadContacts.mockResolvedValue({ results: [CONTACT_OBJ] })

    const result = await runLayer2Sync('deal-xyz')

    expect(result.contactsStored).toBe(1)
    expect(result.activitiesStored).toBe(0)
    expect(result.apiCallsMade).toBeGreaterThan(0)
  })

  it('skips batch read when association list is empty', async () => {
    // all associations empty
    await runLayer2Sync('deal-abc')
    expect(mockBatchReadObjects).not.toHaveBeenCalled()
    expect(mockBatchReadContacts).not.toHaveBeenCalled()
  })
})
