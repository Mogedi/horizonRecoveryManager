import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest'
import { buildSummaryPrompt } from './prompts'

// buildSummaryPrompt filters activities against the real wall clock (`new Date()`), so pin
// "now" to a fixed reference date — otherwise these fixtures age out of the lookback window
// and the suite breaks purely because time passed (see prompts.ts cutoff).
beforeAll(() => {
  vi.useFakeTimers()
  vi.setSystemTime(new Date('2026-06-07T00:00:00Z'))
})
afterAll(() => {
  vi.useRealTimers()
})

const deal = {
  hubspotId: 'deal-123',
  name: 'FULTON - 456 Elm St - JANE DOE',
  stage: 'stage-signed',
  amount: 45000,
  stageEnteredAt: new Date('2026-05-01T00:00:00Z'),
  lastActivityDate: new Date('2026-05-20T00:00:00Z'),
  contactCount: 2,
  hasValidPhone: true,
  syncedAt: new Date('2026-06-07T00:00:00Z'),
  uniqueCallDays: 0,
}

const contacts = [
  {
    id: 1,
    contactHubspotId: 'c-1',
    name: 'Jane Doe',
    contactType: 'owner',
    ownershipStatus: 'primary',
    isDeceased: false,
    doNotContact: false,
    phoneNumbers: ['(555) 123-4567'],
    emailList: ['jane@example.com'],
  },
]

const activities = [
  {
    id: 10,
    type: 'note',
    body: 'Called Jane — she will sign next week.',
    authorOwnerId: 'owner-99',
    direction: null,
    timestamp: new Date('2026-05-20T14:00:00Z'),
    metadata: null,
    syncedAt: new Date('2026-06-07T00:00:00Z'),
  },
  {
    id: 11,
    type: 'call',
    body: 'Left voicemail.',
    authorOwnerId: 'owner-99',
    direction: 'outbound',
    timestamp: new Date('2026-05-15T10:00:00Z'),
    metadata: null,
    syncedAt: new Date('2026-06-07T00:00:00Z'),
  },
]

const stageMap = { 'stage-signed': 'Signed / In Progress' }

describe('buildSummaryPrompt', () => {
  it('includes deal name in the prompt', () => {
    const prompt = buildSummaryPrompt(deal, contacts, activities, stageMap, 28)
    expect(prompt).toContain('FULTON - 456 Elm St - JANE DOE')
  })

  it('includes resolved stage name', () => {
    const prompt = buildSummaryPrompt(deal, contacts, activities, stageMap, 28)
    expect(prompt).toContain('Signed / In Progress')
  })

  it('includes contact name', () => {
    const prompt = buildSummaryPrompt(deal, contacts, activities, stageMap, 28)
    expect(prompt).toContain('Jane Doe')
  })

  it('includes activity bodies', () => {
    const prompt = buildSummaryPrompt(deal, contacts, activities, stageMap, 28)
    expect(prompt).toContain('Called Jane — she will sign next week.')
    expect(prompt).toContain('Left voicemail.')
  })

  it('instructs Claude to return JSON (exact instruction string present)', () => {
    const prompt = buildSummaryPrompt(deal, contacts, activities, stageMap, 28)
    expect(prompt).toContain('Return ONLY a valid JSON object')
    expect(prompt).toContain('mo_action_required')
    expect(prompt).toContain('current_status')
    expect(prompt).toContain('suggested_next_step')
    expect(prompt).toContain('documents_mentioned_missing')
  })

  it('filters out activities older than lookbackDays', () => {
    // Activity from 60 days ago — should be excluded with 28-day window
    const oldActivities = [
      {
        id: 20,
        type: 'note',
        body: 'Very old note from 60 days ago.',
        authorOwnerId: 'owner-99',
        direction: null,
        timestamp: new Date('2026-04-07T00:00:00Z'), // 60 days before 2026-06-07
        metadata: null,
        syncedAt: new Date('2026-06-07T00:00:00Z'),
      },
    ]
    const prompt = buildSummaryPrompt(deal, contacts, oldActivities, stageMap, 28)
    expect(prompt).not.toContain('Very old note from 60 days ago.')
  })

  it('includes amount', () => {
    const prompt = buildSummaryPrompt(deal, contacts, activities, stageMap, 28)
    expect(prompt).toContain('45000')
  })
})
