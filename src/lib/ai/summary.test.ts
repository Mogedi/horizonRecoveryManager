import { describe, it, expect } from 'vitest'
import { parseSummaryResponse, type SummaryJson } from './summary'
import { AIError } from './errors'

const VALID_JSON: SummaryJson = {
  current_status: 'Owner agreed to sign but has not returned docs.',
  last_meaningful_activity: 'Called Jane on 2026-05-20 — she confirmed interest.',
  blockers: ['Missing notarized authorization form'],
  who_needs_something: 'We need Jane to return the signed agreement.',
  suggested_next_step: 'Call Jane again — it has been 7 business days.',
  mo_action_required: true,
  documents_mentioned_missing: ['notarized authorization form'],
}

describe('parseSummaryResponse', () => {
  it('parses a valid JSON string', () => {
    const result = parseSummaryResponse(JSON.stringify(VALID_JSON))
    expect(result.mo_action_required).toBe(true)
    expect(result.current_status).toBe('Owner agreed to sign but has not returned docs.')
    expect(result.blockers).toHaveLength(1)
    expect(result.documents_mentioned_missing).toContain('notarized authorization form')
  })

  it('throws AIError when response is not valid JSON', () => {
    expect(() => parseSummaryResponse('not json at all')).toThrow(AIError)
  })

  it('throws AIError when required field is missing', () => {
    const missing = { ...VALID_JSON }
    // @ts-expect-error intentional deletion for test
    delete missing.mo_action_required
    expect(() => parseSummaryResponse(JSON.stringify(missing))).toThrow(AIError)
  })

  it('throws AIError when blockers is not an array', () => {
    const bad = { ...VALID_JSON, blockers: 'not an array' }
    expect(() => parseSummaryResponse(JSON.stringify(bad))).toThrow(AIError)
  })

  it('throws AIError when documents_mentioned_missing is not an array', () => {
    const bad = { ...VALID_JSON, documents_mentioned_missing: null }
    expect(() => parseSummaryResponse(JSON.stringify(bad))).toThrow(AIError)
  })

  it('handles empty arrays for blockers and documents_mentioned_missing', () => {
    const noBlockers = { ...VALID_JSON, blockers: [], documents_mentioned_missing: [] }
    const result = parseSummaryResponse(JSON.stringify(noBlockers))
    expect(result.blockers).toHaveLength(0)
    expect(result.documents_mentioned_missing).toHaveLength(0)
  })

  it('handles mo_action_required: false', () => {
    const notUrgent = { ...VALID_JSON, mo_action_required: false }
    const result = parseSummaryResponse(JSON.stringify(notUrgent))
    expect(result.mo_action_required).toBe(false)
  })

  it('throws AIError when response is wrapped in markdown code fences', () => {
    // Claude occasionally wraps JSON in ```json ... ``` — the parser must reject this,
    // not silently pass the fence string through as the field value.
    const wrapped = '```json\n' + JSON.stringify(VALID_JSON) + '\n```'
    expect(() => parseSummaryResponse(wrapped)).toThrow(AIError)
  })

  it('throws AIError when mo_action_required is a string instead of boolean', () => {
    // Prompt templating bug could cause Claude to return "true" (string) vs true (boolean)
    const bad = { ...VALID_JSON, mo_action_required: 'true' }
    expect(() => parseSummaryResponse(JSON.stringify(bad))).toThrow(AIError)
  })
})
