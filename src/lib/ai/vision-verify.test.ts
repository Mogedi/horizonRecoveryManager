import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('./client', () => ({
  callClaudeWithImages: vi.fn(),
}))
vi.mock('@/lib/logger', () => ({ log: { info: vi.fn(), warn: vi.fn(), error: vi.fn() } }))

import { callClaudeWithImages } from './client'
import { verifyScreenshot } from './vision-verify'

const CLAUDE_OK = JSON.stringify({
  passed: true,
  confidence: 'high',
  findings: ['Google Drive sidebar found', 'Tax Sale Deed.pdf present'],
  missingItems: [],
  extracted: { 'all file names visible in the Google Drive card on the right sidebar': 'Tax Sale Deed.pdf' },
})

const SPEC = {
  description: 'HubSpot deal page — Google Drive sidebar card shows attached files',
  expectedItems: ['Tax Sale Deed.pdf'],
  extractFields: ['all file names visible in the Google Drive card on the right sidebar'],
}

beforeEach(() => {
  vi.mocked(callClaudeWithImages).mockResolvedValue(CLAUDE_OK)
})

describe('verifyScreenshot — mimeType handling', () => {
  it('passes image/jpeg to callClaudeWithImages by default (not image/png)', async () => {
    await verifyScreenshot('fakejpegbase64', SPEC)

    expect(callClaudeWithImages).toHaveBeenCalledWith(
      expect.any(String),
      [{ data: 'fakejpegbase64', mimeType: 'image/jpeg' }],
      expect.any(String),
      expect.any(Number),
    )
  })

  it('passes image/png when explicitly specified', async () => {
    await verifyScreenshot('fakepngbase64', SPEC, 'image/png')

    expect(callClaudeWithImages).toHaveBeenCalledWith(
      expect.any(String),
      [{ data: 'fakepngbase64', mimeType: 'image/png' }],
      expect.any(String),
      expect.any(Number),
    )
  })

  it('passes image/jpeg when explicitly specified', async () => {
    await verifyScreenshot('fakejpegbase64', SPEC, 'image/jpeg')

    expect(callClaudeWithImages).toHaveBeenCalledWith(
      expect.any(String),
      [{ data: 'fakejpegbase64', mimeType: 'image/jpeg' }],
      expect.any(String),
      expect.any(Number),
    )
  })
})

describe('verifyScreenshot — result parsing', () => {
  it('returns parsed result on success', async () => {
    const result = await verifyScreenshot('fakejpegbase64', SPEC)

    expect(result.passed).toBe(true)
    expect(result.confidence).toBe('high')
    expect(result.findings).toContain('Tax Sale Deed.pdf present')
    expect(result.missingItems).toEqual([])
  })

  it('returns failed result with low confidence when Claude response is not valid JSON', async () => {
    vi.mocked(callClaudeWithImages).mockResolvedValue('not json at all')

    const result = await verifyScreenshot('fakejpegbase64', SPEC)

    expect(result.passed).toBe(false)
    expect(result.confidence).toBe('low')
    expect(result.findings[0]).toMatch(/could not parse/i)
  })

  it('strips markdown code fences that Claude adds despite instructions', async () => {
    // This is the exact pattern we see in production logs: Claude wraps JSON in ```json ... ```
    const fencedResponse = '```json\n' + CLAUDE_OK + '\n```'
    vi.mocked(callClaudeWithImages).mockResolvedValue(fencedResponse)

    const result = await verifyScreenshot('fakejpegbase64', SPEC)

    expect(result.passed).toBe(true)
    expect(result.confidence).toBe('high')
  })

  it('strips plain ``` fences without language tag', async () => {
    const fencedResponse = '```\n' + CLAUDE_OK + '\n```'
    vi.mocked(callClaudeWithImages).mockResolvedValue(fencedResponse)

    const result = await verifyScreenshot('fakejpegbase64', SPEC)

    expect(result.passed).toBe(true)
  })
})
