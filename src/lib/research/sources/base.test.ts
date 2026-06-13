import { describe, it, expect, vi } from 'vitest'

// Avoid loading the Anthropic SDK for these pure-logic tests.
vi.mock('@/lib/ai/client', () => ({ callClaude: vi.fn() }))

import { detectBlock, normalizeCandidate } from './base'

describe('detectBlock', () => {
  it('detects Cloudflare interstitials', () => expect(detectBlock(null, 'Just a moment... checking your browser')).toBe('cloudflare'))
  it('detects CAPTCHAs', () => expect(detectBlock(200, 'Please complete the reCAPTCHA to continue')).toBe('captcha'))
  it('maps HTTP 403/429', () => {
    expect(detectBlock(403, 'ok')).toBe('http_403')
    expect(detectBlock(429, '')).toBe('http_429')
  })
  it('returns null for a clean page', () => expect(detectBlock(200, 'Owner: John Smith  Parcel: 123')).toBeNull())
})

describe('normalizeCandidate', () => {
  it('parses a record and drops empty shells', () => {
    expect(normalizeCandidate('s', 'u', { name: 'John', addresses: [{ line1: '1 Main', kind: 'property' }], phones: ['x'] })?.name).toBe('John')
    expect(normalizeCandidate('s', 'u', { name: null, addresses: [], phones: [] })).toBeNull()
  })
  it('coerces bad address kinds and numeric ages', () => {
    const c = normalizeCandidate('s', 'u', { name: 'J', ageOrDob: 62, addresses: [{ line1: '1 Main', kind: 'weird' }] })
    expect(c?.ageOrDob).toBe('62')
    expect(c?.addresses[0].kind).toBe('current')
  })
})
