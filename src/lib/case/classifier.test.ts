import { describe, it, expect } from 'vitest'
import { categorizeEvent, type ClassifierInput } from './classifier'

function evt(overrides: Partial<ClassifierInput>): ClassifierInput {
  return { type: 'note', body: null, outcome: null, ...overrides }
}

describe('categorizeEvent', () => {
  // ── attorney_activity ──────────────────────────────────────────────────────

  describe('attorney_activity', () => {
    it('classifies email containing "attorney"', () => {
      expect(categorizeEvent(evt({ type: 'email', body: 'Attorney confirmed filing is complete.' }))).toBe('attorney_activity')
    })

    it('classifies note containing "law firm"', () => {
      expect(categorizeEvent(evt({ type: 'note', body: 'Spoke with the law firm about next steps.' }))).toBe('attorney_activity')
    })

    it('classifies note containing "counsel"', () => {
      expect(categorizeEvent(evt({ type: 'note', body: 'Legal counsel responded regarding probate.' }))).toBe('attorney_activity')
    })

    it('classifies email containing "probate court"', () => {
      expect(categorizeEvent(evt({ type: 'email', body: 'Probate court date is set for July 15.' }))).toBe('attorney_activity')
    })

    it('classifies note containing "circuit court"', () => {
      expect(categorizeEvent(evt({ type: 'note', body: 'Waiting on circuit court order.' }))).toBe('attorney_activity')
    })

    it('overrides client_contact: answered call body mentioning attorney', () => {
      expect(categorizeEvent(evt({ type: 'call', outcome: 'answered', body: 'Spoke with attorney about case status.' }))).toBe('attorney_activity')
    })

    it('is case-insensitive', () => {
      expect(categorizeEvent(evt({ type: 'note', body: 'ATTORNEY replied to our inquiry.' }))).toBe('attorney_activity')
    })
  })

  // ── document_received ─────────────────────────────────────────────────────

  describe('document_received', () => {
    it('classifies note containing "certificate"', () => {
      expect(categorizeEvent(evt({ type: 'note', body: 'Marriage certificate received from client.' }))).toBe('document_received')
    })

    it('classifies note containing "deed"', () => {
      expect(categorizeEvent(evt({ type: 'note', body: 'Tax deed uploaded to Google Drive.' }))).toBe('document_received')
    })

    it('classifies note containing "signed"', () => {
      expect(categorizeEvent(evt({ type: 'note', body: 'Agreement signed and returned.' }))).toBe('document_received')
    })

    it('classifies note body with "received"', () => {
      expect(categorizeEvent(evt({ type: 'note', body: 'Documents received from Shirley.' }))).toBe('document_received')
    })

    it('classifies note containing "affidavit"', () => {
      expect(categorizeEvent(evt({ type: 'note', body: 'Affidavit notarized today.' }))).toBe('document_received')
    })

    it('takes lower priority than attorney_activity', () => {
      expect(categorizeEvent(evt({ type: 'note', body: 'Attorney sent the deed to our office.' }))).toBe('attorney_activity')
    })
  })

  // ── client_contact ────────────────────────────────────────────────────────

  describe('client_contact', () => {
    it('classifies answered call with no body', () => {
      expect(categorizeEvent(evt({ type: 'call', outcome: 'answered', body: null }))).toBe('client_contact')
    })

    it('classifies answered call with non-keyword body', () => {
      expect(categorizeEvent(evt({ type: 'call', outcome: 'answered', body: 'Spoke about availability.' }))).toBe('client_contact')
    })
  })

  // ── internal_note ─────────────────────────────────────────────────────────

  describe('internal_note', () => {
    it('classifies note with no keywords', () => {
      expect(categorizeEvent(evt({ type: 'note', body: 'Spoke with Kathleen about next steps.' }))).toBe('internal_note')
    })

    it('classifies note with null body', () => {
      expect(categorizeEvent(evt({ type: 'note', body: null }))).toBe('internal_note')
    })

    it('classifies note with empty body', () => {
      expect(categorizeEvent(evt({ type: 'note', body: '' }))).toBe('internal_note')
    })
  })

  // ── follow_up ─────────────────────────────────────────────────────────────

  describe('follow_up', () => {
    it('classifies task type', () => {
      expect(categorizeEvent(evt({ type: 'task' }))).toBe('follow_up')
    })

    it('classifies voicemail call', () => {
      expect(categorizeEvent(evt({ type: 'call', outcome: 'voicemail' }))).toBe('follow_up')
    })
  })

  // ── outreach_attempt ──────────────────────────────────────────────────────

  describe('outreach_attempt', () => {
    it('classifies no_answer call', () => {
      expect(categorizeEvent(evt({ type: 'call', outcome: 'no_answer' }))).toBe('outreach_attempt')
    })

    it('classifies busy call', () => {
      expect(categorizeEvent(evt({ type: 'call', outcome: 'busy' }))).toBe('outreach_attempt')
    })

    it('classifies call with unknown non-answered outcome', () => {
      expect(categorizeEvent(evt({ type: 'call', outcome: 'failed' }))).toBe('outreach_attempt')
    })
  })

  // ── uncategorized ─────────────────────────────────────────────────────────

  describe('uncategorized', () => {
    it('classifies email with no keywords and no outcome', () => {
      expect(categorizeEvent(evt({ type: 'email', body: 'Following up on the previous message.' }))).toBe('uncategorized')
    })

    it('classifies call with null outcome', () => {
      expect(categorizeEvent(evt({ type: 'call', outcome: null }))).toBe('uncategorized')
    })

    it('classifies sms type', () => {
      expect(categorizeEvent(evt({ type: 'sms', body: null }))).toBe('uncategorized')
    })
  })
})
