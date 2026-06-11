import { describe, it, expect, vi, beforeEach } from 'vitest'
import { NextRequest } from 'next/server'

vi.mock('@/lib/auth/require-session', () => ({
  isAuthenticated: vi.fn().mockResolvedValue(true),
  unauthorizedResponse: vi.fn(),
}))
vi.mock('@/lib/db/activities', () => ({ getActivitiesForDeal: vi.fn().mockResolvedValue([]) }))
vi.mock('@/lib/db/activity-events', () => ({ getActivityEvents: vi.fn().mockResolvedValue([]) }))
vi.mock('@/lib/db/contacts', () => ({ getContactsForDeal: vi.fn().mockResolvedValue([]) }))
vi.mock('@/lib/db/summaries', () => ({ getLatestSummary: vi.fn().mockResolvedValue(null) }))
vi.mock('@/lib/db/case-analysis', () => ({ getLatestAnalysis: vi.fn().mockResolvedValue(null) }))
vi.mock('@/lib/db/tasks', () => ({ getOpenTaskCountForDeal: vi.fn().mockResolvedValue(0) }))
vi.mock('@/lib/db/settings', () => ({ loadOwnerMap: vi.fn().mockResolvedValue({}) }))
vi.mock('@/lib/logger', () => ({ log: { info: vi.fn(), warn: vi.fn(), error: vi.fn() } }))

import { GET } from './route'
import { getActivitiesForDeal } from '@/lib/db/activities'
import { getLatestSummary } from '@/lib/db/summaries'
import { getLatestAnalysis } from '@/lib/db/case-analysis'
import { getOpenTaskCountForDeal } from '@/lib/db/tasks'

const mockGetActivities = vi.mocked(getActivitiesForDeal)
const mockGetSummary = vi.mocked(getLatestSummary)
const mockGetAnalysis = vi.mocked(getLatestAnalysis)
const mockGetTaskCount = vi.mocked(getOpenTaskCountForDeal)

function makeRequest(dealId = 'deal-123') {
  return new NextRequest(`http://localhost/api/deals/${dealId}/story`)
}

beforeEach(() => vi.clearAllMocks())

describe('GET /api/deals/[id]/story', () => {
  it('returns days array and currentState', async () => {
    const res = await GET(makeRequest(), { params: Promise.resolve({ id: 'deal-123' }) })
    expect(res.status).toBe(200)
    const json = await res.json()
    expect(Array.isArray(json.days)).toBe(true)
    expect(json.currentState).toBeDefined()
  })

  it('returns empty days when no activities exist', async () => {
    const res = await GET(makeRequest(), { params: Promise.resolve({ id: 'deal-123' }) })
    const json = await res.json()
    expect(json.days).toHaveLength(0)
  })

  it('groups activities into StoryDays with date, categories, eventCount', async () => {
    mockGetActivities.mockResolvedValue([
      { id: 1, type: 'note', body: 'Spoke with attorney.', authorOwnerId: null, direction: null, timestamp: new Date('2026-06-05T14:00:00Z'), syncedAt: new Date() },
      { id: 2, type: 'note', body: 'Follow-up scheduled.', authorOwnerId: null, direction: null, timestamp: new Date('2026-06-05T10:00:00Z'), syncedAt: new Date() },
    ] as Parameters<typeof mockGetActivities>[0] extends infer _R ? never : never)
    const res = await GET(makeRequest(), { params: Promise.resolve({ id: 'deal-123' }) })
    const json = await res.json()
    expect(json.days).toHaveLength(1)
    expect(json.days[0].eventCount).toBe(2)
    expect(json.days[0].date).toBe('2026-06-05')
  })

  it('returns currentState with unknown health when no summary', async () => {
    const res = await GET(makeRequest(), { params: Promise.resolve({ id: 'deal-123' }) })
    const json = await res.json()
    expect(json.currentState.health).toBe('unknown')
    expect(json.currentState.status).toBeNull()
  })

  it('returns currentState with AI summary when present', async () => {
    mockGetSummary.mockResolvedValue({
      summaryJson: {
        current_status: 'Waiting on attorney',
        last_meaningful_activity: 'Email sent Jun 4',
        blockers: ['Attorney not yet responded'],
        suggested_next_step: 'Follow up Thursday',
        who_needs_something: null,
        mo_action_required: false,
        documents_mentioned_missing: [],
      },
      generatedAt: new Date('2026-06-05T10:00:00Z'),
    } as Awaited<ReturnType<typeof mockGetSummary>>)
    const res = await GET(makeRequest(), { params: Promise.resolve({ id: 'deal-123' }) })
    const json = await res.json()
    expect(json.currentState.status).toBe('Waiting on attorney')
    expect(json.currentState.health).toBe('waiting')
    expect(json.currentState.blocker).toBe('Attorney not yet responded')
    expect(json.currentState.nextAction).toBe('Follow up Thursday')
  })

  it('prefers the latest case_analysis over the summary for currentState', async () => {
    mockGetSummary.mockResolvedValue({
      summaryJson: { current_status: 'STALE summary', last_meaningful_activity: '', blockers: ['old'], suggested_next_step: 'old step', who_needs_something: null, mo_action_required: false, documents_mentioned_missing: [] },
      generatedAt: new Date('2026-01-01T00:00:00Z'),
    } as Awaited<ReturnType<typeof mockGetSummary>>)
    mockGetAnalysis.mockResolvedValue({
      health: 'blocked',
      statusLabel: 'Blocked on probate',
      blockers: ['Estate not opened'],
      nextAction: 'Open estate',
      lastMeaningfulActivity: 'Attorney call Jun 9',
      createdAt: new Date('2026-06-09T12:00:00Z'),
      source: 'agent',
    } as Awaited<ReturnType<typeof mockGetAnalysis>>)
    const res = await GET(makeRequest(), { params: Promise.resolve({ id: 'deal-123' }) })
    const json = await res.json()
    expect(json.currentState.status).toBe('Blocked on probate')
    expect(json.currentState.health).toBe('blocked')
    expect(json.currentState.blocker).toBe('Estate not opened')
    expect(json.currentState.source).toBe('ai')
  })

  it('reflects openTaskCount in currentState', async () => {
    mockGetTaskCount.mockResolvedValue(3)
    const res = await GET(makeRequest(), { params: Promise.resolve({ id: 'deal-123' }) })
    const json = await res.json()
    expect(json.currentState.openTaskCount).toBe(3)
  })

  it('serializes happenedAt as ISO string in events', async () => {
    mockGetActivities.mockResolvedValue([
      { id: 1, type: 'note', body: 'Test', authorOwnerId: null, direction: null, timestamp: new Date('2026-06-05T14:00:00Z'), syncedAt: new Date() },
    ] as Parameters<typeof mockGetActivities>[0] extends infer _R ? never : never)
    const res = await GET(makeRequest(), { params: Promise.resolve({ id: 'deal-123' }) })
    const json = await res.json()
    const event = json.days[0].events[0]
    expect(typeof event.happenedAt).toBe('string')
    expect(event.happenedAt).toMatch(/^\d{4}-\d{2}-\d{2}T/)
  })
})
