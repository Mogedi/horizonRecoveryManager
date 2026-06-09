import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('@/lib/browser/screenshot', () => ({ takeScreenshot: vi.fn() }))
vi.mock('@/lib/ai/vision-verify', () => ({ verifyScreenshot: vi.fn() }))
vi.mock('@/lib/browser/client', () => ({
  loadHubSpotCookies: () => [{ name: 'hubspotutk', value: 'fake', domain: '.hubspot.com' }],
}))
vi.mock('@/lib/logger', () => ({ log: { info: vi.fn(), warn: vi.fn(), error: vi.fn() } }))

import { takeScreenshot } from '@/lib/browser/screenshot'
import { verifyScreenshot } from '@/lib/ai/vision-verify'
import { log } from '@/lib/logger'
import {
  checkHubSpotDriveAttachments,
  matchFilesInText,
  buildDocStatuses,
  buildStructured,
  buildCheckSummary,
  runVisionAnalysis,
} from './drive-check'

// ── Fixtures ──────────────────────────────────────────────────────────────────

const SIDEBAR_TEXT_WITH_FILES = `
Google Drive (3/25)  + Add
PropertyProfile.pdf
Updated on Apr 15, 2026
Attached by mogedi@horizonrecoverygroup.com
Rodney Mullis ($26K) of NoticeTemplate
Updated on May 18, 2026
Attached by marwa@horizonrecoverygroup.com
Tax Sale Deed.pdf
Updated on Apr 15, 2026
Attached by mogedi@horizonrecoverygroup.com
Contacts (6)
`

const SIDEBAR_TEXT_MISSING_DEED = `
Google Drive (2/25)  + Add
PropertyProfile.pdf
Updated on Apr 15, 2026
Rodney Mullis ($26K) of NoticeTemplate
Updated on May 18, 2026
Contacts (6)
`

const SCREENSHOT_RESULT_DOM_FOUND = {
  base64: 'fakejpegdata',
  mimeType: 'image/jpeg' as const,
  width: 1440,
  height: 900,
  extractedText: SIDEBAR_TEXT_WITH_FILES,
}

const SCREENSHOT_RESULT_DOM_MISSING = {
  base64: 'fakejpegdata',
  mimeType: 'image/jpeg' as const,
  width: 1440,
  height: 900,
  extractedText: SIDEBAR_TEXT_MISSING_DEED,
}

const SCREENSHOT_RESULT_NO_TEXT = {
  base64: 'fakejpegdata',
  mimeType: 'image/jpeg' as const,
  width: 1440,
  height: 900,
  extractedText: null,
}

const VISION_RESULT_PASSED = {
  passed: true,
  confidence: 'high' as const,
  findings: ['Tax Sale Deed.pdf found in Google Drive sidebar'],
  missingItems: [],
  extracted: {
    'all file names visible in the Google Drive card on the right sidebar': 'Tax Sale Deed.pdf',
  },
  raw: '{}',
}

const VISION_RESULT_FAILED = {
  passed: false,
  confidence: 'medium' as const,
  findings: ['Tax Sale Deed.pdf not found in Google Drive sidebar'],
  missingItems: ['Tax Sale Deed.pdf'],
  extracted: {
    'all file names visible in the Google Drive card on the right sidebar': 'PropertyProfile.pdf',
  },
  raw: '{}',
}

const EXPECTED = ['Tax Sale Deed.pdf', 'Rodney Mullis ($26K) of NoticeTemplate']

beforeEach(() => {
  vi.stubEnv('HUBSPOT_PORTAL_ID', '244678779')
  vi.mocked(takeScreenshot).mockResolvedValue(SCREENSHOT_RESULT_DOM_FOUND)
  vi.mocked(verifyScreenshot).mockResolvedValue(VISION_RESULT_PASSED)
  vi.clearAllMocks()
  vi.stubEnv('HUBSPOT_PORTAL_ID', '244678779')
})

// ── matchFilesInText (pure function) ─────────────────────────────────────────

describe('matchFilesInText', () => {
  it('finds files with exact name match', () => {
    const { found, missing } = matchFilesInText(['Tax Sale Deed.pdf'], SIDEBAR_TEXT_WITH_FILES)
    expect(found).toContain('Tax Sale Deed.pdf')
    expect(missing).toHaveLength(0)
  })

  it('finds long file names via 25-char prefix match (handles HubSpot truncation)', () => {
    // HubSpot may truncate "Rodney Mullis ($26K) of NoticeTemplate" to "Rodney Mullis ($26K) of No..."
    const truncatedText = SIDEBAR_TEXT_WITH_FILES.replace(
      'Rodney Mullis ($26K) of NoticeTemplate',
      'Rodney Mullis ($26K) of No...',
    )
    const { found, missing } = matchFilesInText(
      ['Rodney Mullis ($26K) of NoticeTemplate'],
      truncatedText,
    )
    expect(found).toContain('Rodney Mullis ($26K) of NoticeTemplate')
    expect(missing).toHaveLength(0)
  })

  it('reports missing files correctly', () => {
    const { found, missing } = matchFilesInText(EXPECTED, SIDEBAR_TEXT_MISSING_DEED)
    expect(found).toContain('Rodney Mullis ($26K) of NoticeTemplate')
    expect(missing).toContain('Tax Sale Deed.pdf')
  })

  it('is case-insensitive', () => {
    const { found } = matchFilesInText(['TAX SALE DEED.PDF'], SIDEBAR_TEXT_WITH_FILES)
    expect(found).toContain('TAX SALE DEED.PDF')
  })
})

// ── DOM-first path ────────────────────────────────────────────────────────────

describe('DOM-first detection path', () => {
  it('returns detectionMethod=dom and does NOT call verifyScreenshot when all files found in DOM', async () => {
    vi.mocked(takeScreenshot).mockResolvedValue(SCREENSHOT_RESULT_DOM_FOUND)

    const result = await checkHubSpotDriveAttachments('123', EXPECTED)

    expect(result.detectionMethod).toBe('dom')
    expect(result.filesLinked).toBe(true)
    expect(result.confidence).toBe('high')
    expect(vi.mocked(verifyScreenshot)).not.toHaveBeenCalled()
  })

  it('includes all expected files in linkedFiles when DOM succeeds', async () => {
    vi.mocked(takeScreenshot).mockResolvedValue(SCREENSHOT_RESULT_DOM_FOUND)

    const result = await checkHubSpotDriveAttachments('123', EXPECTED)

    expect(result.linkedFiles).toContain('Tax Sale Deed.pdf')
    expect(result.linkedFiles).toContain('Rodney Mullis ($26K) of NoticeTemplate')
    expect(result.missingFiles).toHaveLength(0)
  })

  it('always stores screenshotBase64 even on the DOM path', async () => {
    vi.mocked(takeScreenshot).mockResolvedValue(SCREENSHOT_RESULT_DOM_FOUND)

    const result = await checkHubSpotDriveAttachments('123', EXPECTED)

    expect(result.screenshotBase64).toBe('fakejpegdata')
  })

  it('logs step 1/3 and step 2/3 with DOM method on success', async () => {
    vi.mocked(takeScreenshot).mockResolvedValue(SCREENSHOT_RESULT_DOM_FOUND)
    await checkHubSpotDriveAttachments('123', EXPECTED)

    const calls = vi.mocked(log.info).mock.calls
    const step1 = calls.find(c => String(c[0]).includes('step 1/3'))
    const step2 = calls.find(c => String(c[0]).includes('step 2/3') && String(c[0]).includes('complete'))

    expect(step1).toBeDefined()
    expect(step2![1]).toMatchObject({ method: 'dom', found: expect.arrayContaining(EXPECTED) })
  })

  it('uses body as extractText (resilient to HubSpot layout changes) and waits for Google Drive text', async () => {
    vi.mocked(takeScreenshot).mockResolvedValue(SCREENSHOT_RESULT_DOM_FOUND)
    await checkHubSpotDriveAttachments('123', EXPECTED)

    const opts = vi.mocked(takeScreenshot).mock.calls[0][1]!
    expect(opts.extractText).toBe('body')
    expect(opts.waitForText).toBe('Google Drive')
  })
})

// ── Vision fallback path ──────────────────────────────────────────────────────

describe('Vision fallback path', () => {
  it('calls verifyScreenshot when DOM text is missing a file', async () => {
    vi.mocked(takeScreenshot).mockResolvedValue(SCREENSHOT_RESULT_DOM_MISSING)
    vi.mocked(verifyScreenshot).mockResolvedValue(VISION_RESULT_PASSED)

    const result = await checkHubSpotDriveAttachments('123', EXPECTED)

    expect(vi.mocked(verifyScreenshot)).toHaveBeenCalledOnce()
    expect(result.detectionMethod).toBe('vision')
  })

  it('calls verifyScreenshot when extractedText is null (selector not found, not session expired)', async () => {
    vi.mocked(takeScreenshot).mockResolvedValue(SCREENSHOT_RESULT_NO_TEXT)
    vi.mocked(verifyScreenshot).mockResolvedValue(VISION_RESULT_PASSED)

    await checkHubSpotDriveAttachments('123', EXPECTED)

    // null = Drive card didn't load in time → vision fallback (NOT session expired)
    expect(vi.mocked(verifyScreenshot)).toHaveBeenCalledOnce()
  })

  it('passes the correct mimeType from screenshot to verifyScreenshot', async () => {
    vi.mocked(takeScreenshot).mockResolvedValue(SCREENSHOT_RESULT_DOM_MISSING)
    await checkHubSpotDriveAttachments('123', EXPECTED)

    const [, , mimeType] = vi.mocked(verifyScreenshot).mock.calls[0]
    expect(mimeType).toBe('image/jpeg')
  })

  it('returns vision result when vision says files are missing', async () => {
    vi.mocked(takeScreenshot).mockResolvedValue(SCREENSHOT_RESULT_DOM_MISSING)
    vi.mocked(verifyScreenshot).mockResolvedValue(VISION_RESULT_FAILED)

    const result = await checkHubSpotDriveAttachments('123', EXPECTED)

    expect(result.filesLinked).toBe(false)
    expect(result.missingFiles).toContain('Tax Sale Deed.pdf')
  })
})

// ── Session expiry detection ──────────────────────────────────────────────────

describe('Session expiry detection', () => {
  it('falls through to vision when extractedText is null — null means selector not found, NOT session expired', async () => {
    // null = the body/sidebar selector timed out (HubSpot lazy-loaded Drive card not rendered yet)
    // This was previously a false-positive "session expired"; the correct behaviour is vision fallback
    vi.mocked(takeScreenshot).mockResolvedValue(SCREENSHOT_RESULT_NO_TEXT)
    vi.mocked(verifyScreenshot).mockResolvedValue(VISION_RESULT_PASSED)

    const result = await checkHubSpotDriveAttachments('123', EXPECTED)

    expect(result.sessionExpired).toBe(false)
    expect(vi.mocked(verifyScreenshot)).toHaveBeenCalledOnce()
  })

  it('returns sessionExpired=true when page text contains login page text', async () => {
    vi.mocked(takeScreenshot).mockResolvedValue({
      ...SCREENSHOT_RESULT_DOM_FOUND,
      extractedText: 'Log in to HubSpot',
    })

    const result = await checkHubSpotDriveAttachments('123', EXPECTED)

    expect(result.sessionExpired).toBe(true)
    // session expired is detected from body text — do not call vision
    expect(vi.mocked(verifyScreenshot)).not.toHaveBeenCalled()
  })
})

// ── Not configured ────────────────────────────────────────────────────────────

describe('Not configured', () => {
  it('returns checked=false when HUBSPOT_PORTAL_ID is missing', async () => {
    vi.stubEnv('HUBSPOT_PORTAL_ID', '')
    const result = await checkHubSpotDriveAttachments('123', EXPECTED)

    expect(result.checked).toBe(false)
    expect(vi.mocked(takeScreenshot)).not.toHaveBeenCalled()
  })
})

// ── buildDocStatuses (pure) ───────────────────────────────────────────────────

describe('buildDocStatuses', () => {
  const docs = [
    { type: 'tax_sale_deed', label: 'Tax Sale Deed', fileName: 'Tax Deed Smith.pdf' },
    { type: 'property_radar', label: 'PropertyRadar Profile', fileName: 'Lloyd Smith.pdf' },
    { type: 'notice_letter', label: 'Notice Letter', fileName: null },
  ]

  it('marks files as linked when present in linkedFiles (case-insensitive)', () => {
    const result = buildDocStatuses(docs, ['tax deed smith.pdf'])
    expect(result[0].linked).toBe(true)
    expect(result[1].linked).toBe(false)
  })

  it('marks fileName=null entries as not linked', () => {
    const result = buildDocStatuses(docs, ['Tax Deed Smith.pdf', 'Lloyd Smith.pdf'])
    expect(result[2].linked).toBe(false)
    expect(result[2].fileName).toBeNull()
  })

  it('preserves type, label, fileName from input', () => {
    const result = buildDocStatuses(docs, [])
    expect(result[0]).toMatchObject({ type: 'tax_sale_deed', label: 'Tax Sale Deed', fileName: 'Tax Deed Smith.pdf' })
  })
})

// ── buildStructured (pure) ────────────────────────────────────────────────────

describe('buildStructured', () => {
  const statuses = [
    { type: 'tax_sale_deed', label: 'Tax Sale Deed', fileName: 'Deed.pdf', linked: true },
    { type: 'property_radar', label: 'PropertyRadar Profile', fileName: 'Profile.pdf', linked: false },
    { type: 'notice_letter', label: 'Notice Letter', fileName: null, linked: false },
  ]

  it('sets expected=true for all documents (all come from classifiedDocs)', () => {
    const result = buildStructured(statuses)
    expect(result.documents.every(d => d.expected)).toBe(true)
  })

  it('counts requiredDocumentsFound from linked documents', () => {
    const result = buildStructured(statuses)
    expect(result.verification.requiredDocumentsFound).toBe(1)
  })

  it('counts requiredDocumentsMissing from unlinked documents', () => {
    const result = buildStructured(statuses)
    expect(result.verification.requiredDocumentsMissing).toBe(2)
  })

  it('sets allRequiredDocumentsPresent=false when any missing', () => {
    const result = buildStructured(statuses)
    expect(result.verification.allRequiredDocumentsPresent).toBe(false)
  })

  it('sets allRequiredDocumentsPresent=true when all linked', () => {
    const allLinked = statuses.map(s => ({ ...s, linked: true }))
    const result = buildStructured(allLinked)
    expect(result.verification.allRequiredDocumentsPresent).toBe(true)
    expect(result.verification.requiredDocumentsMissing).toBe(0)
  })

  it('counts derived from documents — verification is never independent', () => {
    const result = buildStructured(statuses)
    const manualFound = result.documents.filter(d => d.linked).length
    const manualMissing = result.documents.filter(d => !d.linked).length
    expect(result.verification.requiredDocumentsFound).toBe(manualFound)
    expect(result.verification.requiredDocumentsMissing).toBe(manualMissing)
  })
})

// ── buildCheckSummary (pure) ──────────────────────────────────────────────────

describe('buildCheckSummary', () => {
  it('says "All N required documents linked" when all present', () => {
    const structured = buildStructured([
      { type: 'tax_sale_deed', label: 'Tax Sale Deed', fileName: 'Deed.pdf', linked: true },
      { type: 'property_radar', label: 'Profile', fileName: 'Profile.pdf', linked: true },
    ])
    expect(buildCheckSummary(structured)).toBe('All 2 required documents linked in HubSpot')
  })

  it('says "X of N required documents linked" when some missing', () => {
    const structured = buildStructured([
      { type: 'tax_sale_deed', label: 'Tax Sale Deed', fileName: 'Deed.pdf', linked: true },
      { type: 'property_radar', label: 'Profile', fileName: null, linked: false },
    ])
    expect(buildCheckSummary(structured)).toBe('1 of 2 required documents linked in HubSpot')
  })

  it('handles empty docStatuses', () => {
    const structured = buildStructured([])
    expect(buildCheckSummary(structured)).toBe('All 0 required documents linked in HubSpot')
  })
})

// ── runVisionAnalysis ─────────────────────────────────────────────────────────

describe('runVisionAnalysis', () => {
  it('calls verifyScreenshot with HubSpot-specific description and image/jpeg mimeType', async () => {
    vi.mocked(verifyScreenshot).mockResolvedValue(VISION_RESULT_PASSED)
    await runVisionAnalysis('fakejpeg', ['Tax Sale Deed.pdf'])

    const [, opts, mimeType] = vi.mocked(verifyScreenshot).mock.calls[0]
    expect(mimeType).toBe('image/jpeg')
    expect(opts.description).toContain('HubSpot deal page')
    expect(opts.expectedItems).toEqual(['Tax Sale Deed.pdf'])
  })

  it('returns filesLinked, linkedFiles, missingFiles from vision result', async () => {
    vi.mocked(verifyScreenshot).mockResolvedValue(VISION_RESULT_PASSED)
    const result = await runVisionAnalysis('fakejpeg', ['Tax Sale Deed.pdf'])

    expect(result.filesLinked).toBe(true)
    expect(result.linkedFiles).toContain('Tax Sale Deed.pdf')
    expect(result.missingFiles).toHaveLength(0)
  })

  it('returns filesLinked=false when vision fails', async () => {
    vi.mocked(verifyScreenshot).mockResolvedValue(VISION_RESULT_FAILED)
    const result = await runVisionAnalysis('fakejpeg', ['Tax Sale Deed.pdf'])

    expect(result.filesLinked).toBe(false)
    expect(result.missingFiles).toContain('Tax Sale Deed.pdf')
  })
})

// ── onVerdictReady callback (two-phase check) ─────────────────────────────────

describe('onVerdictReady callback (two-phase check)', () => {
  // Simulate takeScreenshot calling the onTextExtracted callback before resolving
  // (mirrors real behavior: text is extracted before humanize+screenshot)
  function mockWithCallback(text: string | null, result = SCREENSHOT_RESULT_DOM_FOUND) {
    vi.mocked(takeScreenshot).mockImplementation(async (_url, opts) => {
      if (opts?.onTextExtracted) await opts.onTextExtracted(text)
      return result
    })
  }

  it('fires onVerdictReady with verdict when DOM succeeds (before screenshot in result)', async () => {
    mockWithCallback(SIDEBAR_TEXT_WITH_FILES)
    const onVerdictReady = vi.fn().mockResolvedValue(undefined)

    await checkHubSpotDriveAttachments('123', EXPECTED, onVerdictReady)

    expect(onVerdictReady).toHaveBeenCalledOnce()
  })

  it('passes filesLinked=true and screenshotBase64=null in the verdict event', async () => {
    mockWithCallback(SIDEBAR_TEXT_WITH_FILES)
    const onVerdictReady = vi.fn().mockResolvedValue(undefined)

    await checkHubSpotDriveAttachments('123', EXPECTED, onVerdictReady)

    const [verdict] = onVerdictReady.mock.calls[0]
    expect(verdict.filesLinked).toBe(true)
    expect(verdict.detectionMethod).toBe('dom')
    expect(verdict.screenshotBase64).toBeNull()
    expect(verdict.linkedFiles).toEqual(expect.arrayContaining(EXPECTED))
  })

  it('fires onVerdictReady with sessionExpired=true when sidebar shows login page', async () => {
    mockWithCallback('Log in to HubSpot')
    const onVerdictReady = vi.fn().mockResolvedValue(undefined)

    await checkHubSpotDriveAttachments('123', EXPECTED, onVerdictReady)

    const [verdict] = onVerdictReady.mock.calls[0]
    expect(verdict.sessionExpired).toBe(true)
    expect(verdict.filesLinked).toBe(false)
    expect(verdict.screenshotBase64).toBeNull()
  })

  it('fires onVerdictReady with missing files when DOM is incomplete', async () => {
    mockWithCallback(SIDEBAR_TEXT_MISSING_DEED, SCREENSHOT_RESULT_DOM_MISSING)
    vi.mocked(verifyScreenshot).mockResolvedValue(VISION_RESULT_FAILED)
    const onVerdictReady = vi.fn().mockResolvedValue(undefined)

    await checkHubSpotDriveAttachments('123', EXPECTED, onVerdictReady)

    const [verdict] = onVerdictReady.mock.calls[0]
    expect(verdict.missingFiles).toContain('Tax Sale Deed.pdf')
    expect(verdict.screenshotBase64).toBeNull()
  })

  it('is backwards-compatible — callers without onVerdictReady still get the full result', async () => {
    vi.mocked(takeScreenshot).mockResolvedValue(SCREENSHOT_RESULT_DOM_FOUND)

    const result = await checkHubSpotDriveAttachments('123', EXPECTED)

    expect(result.filesLinked).toBe(true)
    expect(result.screenshotBase64).toBe('fakejpegdata')
  })

  it('does NOT call onVerdictReady when HUBSPOT_PORTAL_ID is missing', async () => {
    vi.stubEnv('HUBSPOT_PORTAL_ID', '')
    const onVerdictReady = vi.fn()

    await checkHubSpotDriveAttachments('123', EXPECTED, onVerdictReady)

    expect(onVerdictReady).not.toHaveBeenCalled()
  })
})
