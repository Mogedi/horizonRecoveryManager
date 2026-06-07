import { describe, it, expect } from 'vitest'
import { normalizeToE164, normalizeJustCallRecord } from './normalize'
import type { JustCallCall } from './types'

describe('normalizeToE164', () => {
  it('passes through already-E164 numbers', () => {
    expect(normalizeToE164('+14045551234')).toBe('+14045551234')
  })

  it('handles 11-digit number with leading 1', () => {
    expect(normalizeToE164('14045551234')).toBe('+14045551234')
  })

  it('handles 10-digit number', () => {
    expect(normalizeToE164('4045551234')).toBe('+14045551234')
  })

  it('handles formatted (NXX) NXX-XXXX', () => {
    expect(normalizeToE164('(404) 555-1234')).toBe('+14045551234')
  })

  it('handles dashes NXX-NXX-XXXX', () => {
    expect(normalizeToE164('404-555-1234')).toBe('+14045551234')
  })

  it('handles dots NXX.NXX.XXXX', () => {
    expect(normalizeToE164('404.555.1234')).toBe('+14045551234')
  })

  it('returns null for null input', () => {
    expect(normalizeToE164(null)).toBeNull()
  })

  it('returns null for empty string', () => {
    expect(normalizeToE164('')).toBeNull()
  })

  it('returns null for too-short numbers', () => {
    expect(normalizeToE164('12345')).toBeNull()
  })

  it('returns null for non-phone string like a date', () => {
    expect(normalizeToE164('02/06/2024')).toBeNull() // 8 digits — too short
  })
})

function makeCall(overrides: Partial<JustCallCall> = {}): JustCallCall {
  return {
    id: 12345,
    call_sid: 'CA_test',
    contact_number: '4045551234',
    contact_name: 'Test Contact',
    contact_email: null,
    justcall_number: '7705559999',
    justcall_line_name: null,
    call_date: '2026-06-06T14:30:00Z',
    call_user_date: null,
    call_user_time: null,
    agent_id: 42,
    agent_name: 'Kathleen',
    agent_email: null,
    agent_active: null,
    call_info: {
      direction: 'Outgoing',
      type: 'Answered',
      status: 'Unarchived',
      disposition: null,
      notes: null,
      recording: null,
    },
    call_duration: {
      friendly_duration: '00:02:15',
      total_duration: 135,
      conversation_time: 120,
    },
    cost_incurred: null,
    ...overrides,
  }
}

describe('normalizeJustCallRecord', () => {
  it('normalizes an outbound answered call', () => {
    const result = normalizeJustCallRecord(makeCall())
    expect(result).not.toBeNull()
    expect(result!.externalId).toBe('12345')
    expect(result!.direction).toBe('outbound')
    expect(result!.outcome).toBe('answered')
    expect(result!.contactNumberE164).toBe('+14045551234')
    expect(result!.lineNumberE164).toBe('+17705559999')
    expect(result!.durationSecs).toBe(135)
    expect(result!.agentId).toBe('42')
    expect(result!.agentName).toBe('Kathleen')
    expect(result!.happenedAt).toEqual(new Date('2026-06-06T14:30:00Z'))
  })

  it('normalizes an inbound call', () => {
    const result = normalizeJustCallRecord(makeCall({
      call_info: { direction: 'Incoming', type: 'Answered', status: 'Unarchived', disposition: null, notes: null, recording: null },
    }))
    expect(result!.direction).toBe('inbound')
  })

  it('maps voicemail type to voicemail outcome', () => {
    const result = normalizeJustCallRecord(makeCall({
      call_info: { direction: 'Outgoing', type: 'Voicemail', status: 'Unarchived', disposition: null, notes: null, recording: null },
    }))
    expect(result!.outcome).toBe('voicemail')
  })

  it('maps Missed type to no_answer outcome', () => {
    const result = normalizeJustCallRecord(makeCall({
      call_info: { direction: 'Outgoing', type: 'Missed', status: 'Unarchived', disposition: null, notes: null, recording: null },
    }))
    expect(result!.outcome).toBe('no_answer')
  })

  it('maps Unanswered type to no_answer outcome', () => {
    const result = normalizeJustCallRecord(makeCall({
      call_info: { direction: 'Outgoing', type: 'Unanswered', status: 'Unarchived', disposition: null, notes: null, recording: null },
    }))
    expect(result!.outcome).toBe('no_answer')
  })

  it('returns null when contact_number cannot be normalized', () => {
    const result = normalizeJustCallRecord(makeCall({ contact_number: '123' }))
    expect(result).toBeNull()
  })
})
