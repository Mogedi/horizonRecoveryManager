import { describe, it, expect } from 'vitest'
import { buildStoryDays } from './story'
import type { CaseEvent } from './types'

function makeEvent(overrides: Partial<CaseEvent> & { happenedAt: Date }): CaseEvent {
  return {
    id: `hubspot:${Math.random()}`,
    source: 'hubspot',
    type: 'note',
    category: 'internal_note',
    participants: [],
    outcome: null,
    summary: 'A note was added.',
    durationSecs: null,
    rawRef: { table: 'deal_activities', id: 1 },
    ...overrides,
  }
}

describe('buildStoryDays', () => {
  it('returns empty array for no events', () => {
    expect(buildStoryDays([])).toEqual([])
  })

  it('groups events on the same ET day together', () => {
    const events = [
      makeEvent({ happenedAt: new Date('2026-06-05T14:00:00Z'), category: 'internal_note' }),
      makeEvent({ happenedAt: new Date('2026-06-05T10:00:00Z'), category: 'follow_up' }),
    ]
    const days = buildStoryDays(events)
    expect(days).toHaveLength(1)
    expect(days[0].date).toBe('2026-06-05')
    expect(days[0].eventCount).toBe(2)
  })

  it('separates events on different ET days', () => {
    const events = [
      makeEvent({ happenedAt: new Date('2026-06-05T14:00:00Z') }),
      makeEvent({ happenedAt: new Date('2026-06-04T14:00:00Z') }),
    ]
    const days = buildStoryDays(events)
    expect(days).toHaveLength(2)
  })

  it('handles timezone boundary: 11:30pm ET on Thursday = 3:30am UTC Friday', () => {
    // 2026-05-29T03:30:00Z = 2026-05-28T23:30:00 ET — should be May 28
    const events = [
      makeEvent({ happenedAt: new Date('2026-05-29T03:30:00Z') }),
    ]
    const days = buildStoryDays(events)
    expect(days).toHaveLength(1)
    expect(days[0].date).toBe('2026-05-28') // ET date, not UTC date
  })

  it('deduplicates categories within a day', () => {
    const events = [
      makeEvent({ happenedAt: new Date('2026-06-05T14:00:00Z'), category: 'internal_note' }),
      makeEvent({ happenedAt: new Date('2026-06-05T10:00:00Z'), category: 'internal_note' }),
      makeEvent({ happenedAt: new Date('2026-06-05T09:00:00Z'), category: 'attorney_activity' }),
    ]
    const days = buildStoryDays(events)
    expect(days[0].categories).toHaveLength(2)
    expect(days[0].categories).toContain('internal_note')
    expect(days[0].categories).toContain('attorney_activity')
  })

  it('orders days newest first', () => {
    const events = [
      makeEvent({ happenedAt: new Date('2026-06-03T14:00:00Z') }),
      makeEvent({ happenedAt: new Date('2026-06-05T14:00:00Z') }),
      makeEvent({ happenedAt: new Date('2026-06-04T14:00:00Z') }),
    ]
    const days = buildStoryDays(events)
    expect(days[0].date).toBe('2026-06-05')
    expect(days[1].date).toBe('2026-06-04')
    expect(days[2].date).toBe('2026-06-03')
  })

  it('orders events within a day newest first', () => {
    const e1 = makeEvent({ happenedAt: new Date('2026-06-05T09:00:00Z'), summary: 'Earlier' })
    const e2 = makeEvent({ happenedAt: new Date('2026-06-05T14:00:00Z'), summary: 'Later' })
    const days = buildStoryDays([e1, e2])
    expect(days[0].events[0].summary).toBe('Later')
    expect(days[0].events[1].summary).toBe('Earlier')
  })

  it('sets latestEventSummary from the newest event on that day', () => {
    const events = [
      makeEvent({ happenedAt: new Date('2026-06-05T09:00:00Z'), summary: 'Older event' }),
      makeEvent({ happenedAt: new Date('2026-06-05T14:00:00Z'), summary: 'Newest event' }),
    ]
    const days = buildStoryDays(events)
    expect(days[0].latestEventSummary).toBe('Newest event')
  })

  it('sets latestEventSummary to null when all events have null summary', () => {
    const events = [
      makeEvent({ happenedAt: new Date('2026-06-05T14:00:00Z'), summary: null }),
    ]
    const days = buildStoryDays(events)
    expect(days[0].latestEventSummary).toBeNull()
  })

  it('correctly counts events per day', () => {
    const events = [
      makeEvent({ happenedAt: new Date('2026-06-05T14:00:00Z') }),
      makeEvent({ happenedAt: new Date('2026-06-05T12:00:00Z') }),
      makeEvent({ happenedAt: new Date('2026-06-05T10:00:00Z') }),
      makeEvent({ happenedAt: new Date('2026-06-04T14:00:00Z') }),
    ]
    const days = buildStoryDays(events)
    expect(days[0].eventCount).toBe(3) // Jun 5
    expect(days[1].eventCount).toBe(1) // Jun 4
  })
})
