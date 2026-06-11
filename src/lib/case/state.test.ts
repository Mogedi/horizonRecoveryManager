import { describe, it, expect } from 'vitest'
import { buildCurrentState } from './state'
import type { AnalysisStateInput, SummaryStateInput } from './state'

describe('buildCurrentState', () => {
  it('returns safe nulls when both analysis and summary are null', () => {
    const state = buildCurrentState(null, null, 0)
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
    const state = buildCurrentState(null, null, 5)
    expect(state.openTaskCount).toBe(5)
  })

  // ── summary fallback path (no analysis yet) ──────────────────────────────────

  describe('summary fallback', () => {
    it('maps SummaryJson fields to CurrentState', () => {
      const generatedAt = new Date('2026-06-05T10:00:00Z')
      const summary: SummaryStateInput = {
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
      const state = buildCurrentState(null, summary, 2)
      expect(state.status).toBe('Waiting on County Attorney')
      expect(state.lastMeaningfulActivity).toBe('Attorney emailed Jun 4')
      expect(state.nextAction).toBe('Follow up next Tuesday')
      expect(state.blocker).toBe('County response pending')
      expect(state.generatedAt).toEqual(generatedAt)
      expect(state.source).toBe('ai')
      expect(state.openTaskCount).toBe(2)
    })

    it('uses first blocker when multiple exist', () => {
      const summary: SummaryStateInput = {
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
      const state = buildCurrentState(null, summary, 0)
      expect(state.blocker).toBe('First blocker')
    })

    it('sets blocker to null when blockers array is empty', () => {
      const summary: SummaryStateInput = {
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
      const state = buildCurrentState(null, summary, 0)
      expect(state.blocker).toBeNull()
    })

    function healthFor(status: string) {
      return buildCurrentState(
        null,
        {
          summaryJson: { current_status: status, last_meaningful_activity: '', blockers: [], suggested_next_step: '', who_needs_something: null, mo_action_required: false, documents_mentioned_missing: [] },
          generatedAt: new Date(),
        },
        0
      ).health
    }

    it('infers health from summary status text', () => {
      expect(healthFor('Waiting on County Attorney')).toBe('waiting')
      expect(healthFor('Blocked — cannot proceed')).toBe('blocked')
      expect(healthFor('On track — agreement signed')).toBe('on_track')
      expect(healthFor('Filed with probate court')).toBe('active')
      expect(healthFor('Random text with no keywords')).toBe('unknown')
    })
  })

  // ── analysis path (AI-interpretation layer wins over summary) ────────────────

  describe('analysis path', () => {
    const baseAnalysis = (over: Partial<NonNullable<AnalysisStateInput>> = {}): AnalysisStateInput => ({
      health: 'waiting',
      statusLabel: 'Waiting on County',
      blockers: ['County response pending', 'second'],
      nextAction: 'Follow up Tuesday',
      lastMeaningfulActivity: 'Attorney emailed Jun 4',
      createdAt: new Date('2026-06-09T12:00:00Z'),
      source: 'agent',
      ...over,
    })

    it('uses analysis fields directly (health is taken, not inferred)', () => {
      const state = buildCurrentState(baseAnalysis({ statusLabel: 'Anything', health: 'blocked' }), null, 3)
      expect(state.status).toBe('Anything')
      expect(state.health).toBe('blocked') // taken verbatim, not inferred from "Anything"
      expect(state.blocker).toBe('County response pending')
      expect(state.nextAction).toBe('Follow up Tuesday')
      expect(state.lastMeaningfulActivity).toBe('Attorney emailed Jun 4')
      expect(state.openTaskCount).toBe(3)
      expect(state.source).toBe('ai')
    })

    it('analysis overrides summary when both are present', () => {
      const summary: SummaryStateInput = {
        summaryJson: {
          current_status: 'STALE SUMMARY STATUS',
          last_meaningful_activity: 'old',
          blockers: ['old blocker'],
          suggested_next_step: 'old step',
          who_needs_something: null,
          mo_action_required: false,
          documents_mentioned_missing: [],
        },
        generatedAt: new Date('2026-01-01T00:00:00Z'),
      }
      const state = buildCurrentState(baseAnalysis(), summary, 0)
      expect(state.status).toBe('Waiting on County')
      expect(state.generatedAt).toEqual(new Date('2026-06-09T12:00:00Z'))
    })

    it('maps human-sourced analysis to source=human', () => {
      const state = buildCurrentState(baseAnalysis({ source: 'human' }), null, 0)
      expect(state.source).toBe('human')
    })

    it('handles empty blockers array', () => {
      const state = buildCurrentState(baseAnalysis({ blockers: [] }), null, 0)
      expect(state.blocker).toBeNull()
    })
  })
})
