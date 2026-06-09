import { describe, it, expect } from 'vitest'
import { buildCurrentState } from './state'

type SummaryInput = { summaryJson: unknown; generatedAt: Date } | null

describe('buildCurrentState', () => {
  it('returns safe nulls when summary is null', () => {
    const state = buildCurrentState(null, 0)
    expect(state.status).toBeNull()
    expect(state.health).toBe('unknown')
    expect(state.blocker).toBeNull()
    expect(state.nextAction).toBeNull()
    expect(state.lastMeaningfulActivity).toBeNull()
    expect(state.generatedAt).toBeNull()
    expect(state.source).toBeNull()
    expect(state.openTaskCount).toBe(0)
  })

  it('reflects openTaskCount from argument', () => {
    const state = buildCurrentState(null, 5)
    expect(state.openTaskCount).toBe(5)
  })

  it('maps SummaryJson fields to CurrentState', () => {
    const generatedAt = new Date('2026-06-05T10:00:00Z')
    const summary: SummaryInput = {
      summaryJson: {
        current_status: 'Waiting on County Attorney',
        last_meaningful_activity: 'Attorney emailed Jun 4',
        blockers: ['County response pending'],
        suggested_next_step: 'Follow up next Tuesday',
        who_needs_something: null,
        mo_action_required: false,
        documents_mentioned_missing: [],
      },
      generatedAt,
    }
    const state = buildCurrentState(summary, 2)
    expect(state.status).toBe('Waiting on County Attorney')
    expect(state.lastMeaningfulActivity).toBe('Attorney emailed Jun 4')
    expect(state.nextAction).toBe('Follow up next Tuesday')
    expect(state.blocker).toBe('County response pending')
    expect(state.generatedAt).toEqual(generatedAt)
    expect(state.source).toBe('ai')
    expect(state.openTaskCount).toBe(2)
  })

  it('uses first blocker when multiple exist', () => {
    const summary: SummaryInput = {
      summaryJson: {
        current_status: 'Active',
        last_meaningful_activity: '',
        blockers: ['First blocker', 'Second blocker'],
        suggested_next_step: '',
        who_needs_something: null,
        mo_action_required: false,
        documents_mentioned_missing: [],
      },
      generatedAt: new Date(),
    }
    const state = buildCurrentState(summary, 0)
    expect(state.blocker).toBe('First blocker')
  })

  it('sets blocker to null when blockers array is empty', () => {
    const summary: SummaryInput = {
      summaryJson: {
        current_status: 'On track',
        last_meaningful_activity: '',
        blockers: [],
        suggested_next_step: '',
        who_needs_something: null,
        mo_action_required: false,
        documents_mentioned_missing: [],
      },
      generatedAt: new Date(),
    }
    const state = buildCurrentState(summary, 0)
    expect(state.blocker).toBeNull()
  })

  // ── health inference ──────────────────────────────────────────────────────

  describe('health inference from status', () => {
    function healthFor(status: string) {
      return buildCurrentState({
        summaryJson: { current_status: status, last_meaningful_activity: '', blockers: [], suggested_next_step: '', who_needs_something: null, mo_action_required: false, documents_mentioned_missing: [] },
        generatedAt: new Date(),
      }, 0).health
    }

    it('waiting → waiting on county', () => {
      expect(healthFor('Waiting on County Attorney')).toBe('waiting')
    })

    it('pending → waiting', () => {
      expect(healthFor('Pending attorney response')).toBe('waiting')
    })

    it('awaiting → waiting', () => {
      expect(healthFor('Awaiting probate filing')).toBe('waiting')
    })

    it('blocked → blocked', () => {
      expect(healthFor('Blocked — cannot proceed without death certificate')).toBe('blocked')
    })

    it('on hold → blocked', () => {
      expect(healthFor('On hold pending estate opening')).toBe('blocked')
    })

    it('on track → on_track', () => {
      expect(healthFor('On track — agreement signed')).toBe('on_track')
    })

    it('signed → on_track', () => {
      expect(healthFor('Signed and in progress')).toBe('on_track')
    })

    it('filed → active', () => {
      expect(healthFor('Filed with probate court')).toBe('active')
    })

    it('submitted → active', () => {
      expect(healthFor('Submitted to county clerk')).toBe('active')
    })

    it('unknown status string → unknown', () => {
      expect(healthFor('Random status text with no keywords')).toBe('unknown')
    })

    it('empty status → unknown', () => {
      expect(healthFor('')).toBe('unknown')
    })
  })
})
