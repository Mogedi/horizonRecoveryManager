import { describe, it, expect, vi, beforeEach } from 'vitest'
import { NextRequest } from 'next/server'

vi.mock('@/lib/auth/require-session', () => ({
  isAuthenticated: vi.fn().mockResolvedValue(true),
  unauthorizedResponse: vi.fn(),
}))
vi.mock('@/lib/db/contacts', () => ({
  getContactsForDeal: vi.fn(),
  getContactStats: vi.fn(),
  getRecentCallsForContact: vi.fn(),
}))
vi.mock('@/lib/integrations/justcall/normalize', () => ({
  normalizeToE164: vi.fn((p: string) => p.startsWith('+') ? p : null),
}))
vi.mock('@/lib/logger', () => ({ log: { info: vi.fn(), warn: vi.fn(), error: vi.fn() } }))

import { GET } from './route'
import { getContactsForDeal, getContactStats, getRecentCallsForContact } from '@/lib/db/contacts'

const mockGetContacts = vi.mocked(getContactsForDeal)
const mockGetStats = vi.mocked(getContactStats)
const mockGetCalls = vi.mocked(getRecentCallsForContact)

const baseContact = {
  id: 7,
  contactHubspotId: 'hs-1',
  name: 'Albertha Dixon',
  contactType: 'owner',
  ownershipStatus: null,
  isDeceased: false,
  doNotContact: false,
  phoneNumbers: ['+16095519941'],
  emailList: ['a@example.com'],
  address: '123 Main St',
  city: 'Atlanta',
  state: 'GA',
  zip: '30301',
}

const baseStats = {
  totalCalls: 21,
  conversations: 15,
  lastConversationDate: new Date('2026-06-04T10:00:00Z'),
  lastCallDate: new Date('2026-06-05T10:00:00Z'),
  bestPhone: '+16095519941',
  bestPhoneSource: 'inferred' as const,
}

const baseCalls = [
  { id: 1, happenedAt: new Date('2026-06-04T10:00:00Z'), direction: 'outbound', outcome: 'answered', durationSecs: 185 },
]

function makeRequest(dealId = 'deal-123', contactId = '7') {
  return new NextRequest(`http://localhost/api/deals/${dealId}/contacts/${contactId}`)
}

beforeEach(() => {
  vi.clearAllMocks()
  mockGetStats.mockResolvedValue(baseStats)
  mockGetCalls.mockResolvedValue(baseCalls)
})

describe('GET /api/deals/[id]/contacts/[contactId]', () => {
  it('returns 404 when contact not found for this deal', async () => {
    mockGetContacts.mockResolvedValue([{ ...baseContact, id: 99 }])
    const res = await GET(makeRequest(), { params: Promise.resolve({ id: 'deal-123', contactId: '7' }) })
    expect(res.status).toBe(404)
  })

  it('returns contact fields including all 4 address components', async () => {
    mockGetContacts.mockResolvedValue([baseContact])
    const res = await GET(makeRequest(), { params: Promise.resolve({ id: 'deal-123', contactId: '7' }) })
    expect(res.status).toBe(200)
    const json = await res.json()
    expect(json.contact.address).toBe('123 Main St')
    expect(json.contact.city).toBe('Atlanta')
    expect(json.contact.state).toBe('GA')
    expect(json.contact.zip).toBe('30301')
  })

  it('returns stats with lastConversationDate, lastCallDate, bestPhone, bestPhoneSource', async () => {
    mockGetContacts.mockResolvedValue([baseContact])
    const res = await GET(makeRequest(), { params: Promise.resolve({ id: 'deal-123', contactId: '7' }) })
    const json = await res.json()
    expect(json.stats.totalCalls).toBe(21)
    expect(json.stats.conversations).toBe(15)
    expect(json.stats.bestPhone).toBe('+16095519941')
    expect(json.stats.bestPhoneSource).toBe('inferred')
    expect(json.stats.lastConversationDate).toBeDefined()
    expect(json.stats.lastCallDate).toBeDefined()
  })

  it('returns recentCalls without summary field', async () => {
    mockGetContacts.mockResolvedValue([baseContact])
    const res = await GET(makeRequest(), { params: Promise.resolve({ id: 'deal-123', contactId: '7' }) })
    const json = await res.json()
    expect(Array.isArray(json.recentCalls)).toBe(true)
    expect(json.recentCalls[0]).not.toHaveProperty('summary')
    expect(json.recentCalls[0].outcome).toBe('answered')
  })

  it('returns zeroed stats and empty recentCalls when contact has no phone numbers', async () => {
    const noPhoneContact = { ...baseContact, phoneNumbers: [] }
    mockGetContacts.mockResolvedValue([noPhoneContact])
    const zeroStats = { totalCalls: 0, conversations: 0, lastConversationDate: null, lastCallDate: null, bestPhone: null, bestPhoneSource: 'inferred' as const }
    mockGetStats.mockResolvedValue(zeroStats)
    mockGetCalls.mockResolvedValue([])
    const res = await GET(makeRequest(), { params: Promise.resolve({ id: 'deal-123', contactId: '7' }) })
    const json = await res.json()
    expect(json.stats.totalCalls).toBe(0)
    expect(json.recentCalls).toEqual([])
  })
})
