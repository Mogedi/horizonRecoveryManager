import { describe, it, expect, vi, beforeEach } from 'vitest'
import type { DriveFileEntry } from '@/lib/integrations/google/drive-index'

// Mock external dependencies before importing the module under test
vi.mock('@/lib/integrations/google/client', () => ({
  googleClient: {
    exportFileAsText: vi.fn(),
    downloadFileAsBase64: vi.fn(),
  },
}))

vi.mock('./client', () => ({
  callClaude: vi.fn(),
  callClaudeWithDocuments: vi.fn(),
}))

vi.mock('@/lib/logger', () => ({ log: { info: vi.fn(), warn: vi.fn(), error: vi.fn() } }))

import { googleClient } from '@/lib/integrations/google/client'
import { callClaude, callClaudeWithDocuments } from './client'
import {
  scoreFile, extractFile, buildPrompt, verifyAllFiles,
  MAX_FILES, MAX_TEXT_CHARS, REQUIRED_LABELS,
  type PropertyContext,
} from './doc-verify'

// ─── Fixtures ─────────────────────────────────────────────────────────────────

function makeFile(overrides: Partial<DriveFileEntry> = {}): DriveFileEntry {
  return {
    id: 'file-1',
    name: 'test.pdf',
    mimeType: 'application/pdf',
    modifiedAt: '2024-01-01T00:00:00Z',
    webViewLink: 'https://drive.google.com/file/file-1',
    iconLink: null,
    sizeBytes: 100_000,
    ...overrides,
  }
}

const PROPERTY: PropertyContext = {
  address: '175 Deer Creek Cir, Gray, GA 31032',
  parcelId: 'J52 00 253',
  taxSaleDate: '2023-05-01',
}

const CLAUDE_RESPONSE = JSON.stringify({
  fileClassifications: [
    { fileName: 'deed.pdf', docType: 'tax_sale_deed', confidence: 'high', extractedDetails: '175 Deer Creek, Jones County' },
  ],
  requiredDocuments: [
    {
      type: 'tax_sale_deed',
      status: 'present_verified',
      fileName: 'deed.pdf',
      details: 'Tax sale deed for 175 Deer Creek Cir matches CRM address.',
      evidence: { propertyAddress: '175 Deer Creek Cir', parcelId: 'J52 00 253', saleDate: '2023-05-01', grantor: 'Jones County Tax Commissioner', grantee: 'Horizon Recovery LLC', otherDetails: null },
      mismatches: [],
    },
    { type: 'property_radar', status: 'missing', fileName: null, details: 'Not found.', evidence: null, mismatches: [] },
    { type: 'notice_letter', status: 'missing', fileName: null, details: 'Not found.', evidence: null, mismatches: [] },
  ],
  consolidatedData: {
    propertyAddress: '175 Deer Creek Cir, Gray, GA 31032',
    parcelId: 'J52 00 253',
    taxSaleDate: '2023-05-01',
    saleAmount: '$32,000',
    grantor: 'Jones County Tax Commissioner',
    grantee: 'Nicholas Cameron',
    county: 'Jones',
    bookPage: 'Book 01155, Page 0653',
    currentOwner: null,
    assessedValue: null,
    deedRecordedDate: '2023-12-15',
  },
  summary: 'Tax sale deed found and verified. PropertyRadar profile not present.',
  overallMatch: false,
})

// ─── scoreFile ────────────────────────────────────────────────────────────────

describe('scoreFile', () => {
  it('awards points for deed keywords', () => {
    const f = makeFile({ name: 'Tax Sale Deed Jones.pdf' })
    expect(scoreFile(f)).toBeGreaterThan(0)
  })

  it('ranks google docs higher than PDFs', () => {
    const gdoc = makeFile({ name: 'Notice', mimeType: 'application/vnd.google-apps.document' })
    const pdf = makeFile({ name: 'Notice', mimeType: 'application/pdf' })
    expect(scoreFile(gdoc)).toBeGreaterThan(scoreFile(pdf))
  })

  it('penalizes very large files', () => {
    const small = makeFile({ name: 'deed.pdf', sizeBytes: 500_000 })
    const large = makeFile({ name: 'deed.pdf', sizeBytes: 20 * 1024 * 1024 })
    expect(scoreFile(small)).toBeGreaterThan(scoreFile(large))
  })

  it('scores higher for multiple keyword matches', () => {
    const multi = makeFile({ name: 'Tax Sale Deed Certificate.pdf' })
    const single = makeFile({ name: 'document.pdf' })
    expect(scoreFile(multi)).toBeGreaterThan(scoreFile(single))
  })

  it('gives score 0 for a file with no keywords or bonus mimeType', () => {
    const f = makeFile({ name: 'scan001.docx', mimeType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' })
    expect(scoreFile(f)).toBe(0)
  })
})

// ─── extractFile ──────────────────────────────────────────────────────────────

describe('extractFile', () => {
  beforeEach(() => vi.clearAllMocks())

  it('exports google docs as text', async () => {
    vi.mocked(googleClient.exportFileAsText).mockResolvedValue('  some doc text  ')
    const f = makeFile({ mimeType: 'application/vnd.google-apps.document' })
    const result = await extractFile(f)
    expect(result).toEqual({ kind: 'text', text: 'some doc text' })
    expect(googleClient.exportFileAsText).toHaveBeenCalledWith(f.id)
  })

  it('exports google presentations as text', async () => {
    vi.mocked(googleClient.exportFileAsText).mockResolvedValue('slide text')
    const f = makeFile({ mimeType: 'application/vnd.google-apps.presentation' })
    const result = await extractFile(f)
    expect(result).toEqual({ kind: 'text', text: 'slide text' })
  })

  it('downloads PDFs as base64', async () => {
    vi.mocked(googleClient.downloadFileAsBase64).mockResolvedValue({ data: 'abc123', mimeType: 'application/pdf' })
    const f = makeFile({ mimeType: 'application/pdf' })
    const result = await extractFile(f)
    expect(result).toEqual({ kind: 'pdf', base64: 'abc123' })
    expect(googleClient.downloadFileAsBase64).toHaveBeenCalledWith(f.id)
  })

  it('skips unsupported mime types', async () => {
    const f = makeFile({ mimeType: 'image/jpeg' })
    const result = await extractFile(f)
    expect(result).toEqual({ kind: 'skip' })
    expect(googleClient.exportFileAsText).not.toHaveBeenCalled()
    expect(googleClient.downloadFileAsBase64).not.toHaveBeenCalled()
  })

  it('skips spreadsheets', async () => {
    const f = makeFile({ mimeType: 'application/vnd.google-apps.spreadsheet' })
    const result = await extractFile(f)
    expect(result).toEqual({ kind: 'skip' })
  })
})

// ─── buildPrompt ──────────────────────────────────────────────────────────────

describe('buildPrompt', () => {
  const textDoc = { file: makeFile({ name: 'notice.gdoc' }), text: 'Dear owner, surplus funds available.' }
  const pdfFile = makeFile({ name: 'deed.pdf' })

  it('includes property context when provided', () => {
    const prompt = buildPrompt([], [], PROPERTY)
    expect(prompt).toContain('175 Deer Creek')
    expect(prompt).toContain('J52 00 253')
    expect(prompt).toContain('2023-05-01')
  })

  it('shows fallback text when no property context', () => {
    const prompt = buildPrompt([], [], { address: null, parcelId: null, taxSaleDate: null })
    expect(prompt).toContain('none')
  })

  it('embeds google doc text with file name', () => {
    const prompt = buildPrompt([textDoc], [], PROPERTY)
    expect(prompt).toContain('notice.gdoc')
    expect(prompt).toContain('Dear owner, surplus funds available.')
  })

  it('truncates long text to MAX_TEXT_CHARS', () => {
    const longText = 'x'.repeat(MAX_TEXT_CHARS + 500)
    const longDoc = { file: makeFile({ name: 'long.gdoc' }), text: longText }
    const prompt = buildPrompt([longDoc], [], PROPERTY)
    // The truncated text (MAX_TEXT_CHARS chars of 'x') should appear
    expect(prompt).toContain('x'.repeat(MAX_TEXT_CHARS))
    // But not beyond MAX_TEXT_CHARS
    expect(prompt).not.toContain('x'.repeat(MAX_TEXT_CHARS + 1))
  })

  it('lists PDF files by name in the prompt', () => {
    const prompt = buildPrompt([], [{ file: pdfFile }], PROPERTY)
    expect(prompt).toContain('deed.pdf')
    expect(prompt).toContain('document blocks')
  })

  it('includes both text docs and PDF notes when both present', () => {
    const prompt = buildPrompt([textDoc], [{ file: pdfFile }], PROPERTY)
    expect(prompt).toContain('notice.gdoc')
    expect(prompt).toContain('Dear owner')
    expect(prompt).toContain('deed.pdf')
  })

  it('includes all required doc types in the task description', () => {
    const prompt = buildPrompt([], [], PROPERTY)
    expect(prompt).toContain('tax_sale_deed')
    expect(prompt).toContain('property_radar')
    expect(prompt).toContain('notice_letter')
  })
})

// ─── verifyAllFiles ───────────────────────────────────────────────────────────

describe('verifyAllFiles', () => {
  beforeEach(() => vi.clearAllMocks())

  it('returns empty result when no files are provided', async () => {
    const report = await verifyAllFiles([], PROPERTY)
    expect(report.requiredDocuments).toHaveLength(3)
    expect(report.requiredDocuments.every(d => d.status === 'missing')).toBe(true)
    expect(report.overallMatch).toBe(false)
    expect(report.fileClassifications).toHaveLength(0)
  })

  it('skips image and folder mime types', async () => {
    const files = [
      makeFile({ name: 'photo.jpg', mimeType: 'image/jpeg' }),
      makeFile({ name: 'folder', mimeType: 'application/vnd.google-apps.folder' }),
    ]
    const report = await verifyAllFiles(files, PROPERTY)
    expect(report.skippedFiles).toContain('photo.jpg')
    expect(report.skippedFiles).toContain('folder')
    expect(callClaude).not.toHaveBeenCalled()
    expect(callClaudeWithDocuments).not.toHaveBeenCalled()
  })

  it('uses callClaudeWithDocuments when PDFs are present', async () => {
    vi.mocked(googleClient.downloadFileAsBase64).mockResolvedValue({ data: 'base64data', mimeType: 'application/pdf' })
    vi.mocked(callClaudeWithDocuments).mockResolvedValue(CLAUDE_RESPONSE)

    const files = [makeFile({ id: 'deed-id', name: 'deed.pdf', mimeType: 'application/pdf' })]
    const report = await verifyAllFiles(files, PROPERTY)

    expect(callClaudeWithDocuments).toHaveBeenCalledOnce()
    expect(callClaude).not.toHaveBeenCalled()
    const [docs] = vi.mocked(callClaudeWithDocuments).mock.calls[0]
    expect(docs[0]).toMatchObject({ data: 'base64data', mimeType: 'application/pdf', label: 'deed.pdf' })
    expect(report.requiredDocuments[0].status).toBe('present_verified')
    expect(report.requiredDocuments[0].fileId).toBe('deed-id')
  })

  it('uses callClaude (no doc blocks) when only Google Docs are present', async () => {
    vi.mocked(googleClient.exportFileAsText).mockResolvedValue('notice letter content')
    vi.mocked(callClaude).mockResolvedValue(CLAUDE_RESPONSE)

    const files = [makeFile({ name: 'notice.gdoc', mimeType: 'application/vnd.google-apps.document' })]
    await verifyAllFiles(files, PROPERTY)

    expect(callClaude).toHaveBeenCalledOnce()
    expect(callClaudeWithDocuments).not.toHaveBeenCalled()
  })

  it('selects only the top MAX_FILES files by score', async () => {
    vi.mocked(googleClient.downloadFileAsBase64).mockResolvedValue({ data: 'b64', mimeType: 'application/pdf' })
    vi.mocked(callClaudeWithDocuments).mockResolvedValue(CLAUDE_RESPONSE)

    const files = Array.from({ length: 8 }, (_, i) =>
      makeFile({ id: `f${i}`, name: `file${i}.pdf`, mimeType: 'application/pdf' })
    )
    const report = await verifyAllFiles(files, PROPERTY)

    // Only MAX_FILES should be passed to Claude
    const [docs] = vi.mocked(callClaudeWithDocuments).mock.calls[0]
    expect(docs.length).toBeLessThanOrEqual(MAX_FILES)
    // Remaining 3 should be in skippedFiles
    expect(report.skippedFiles.length).toBe(8 - MAX_FILES)
  })

  it('parses claude JSON response and maps fileId correctly', async () => {
    vi.mocked(googleClient.downloadFileAsBase64).mockResolvedValue({ data: 'b64', mimeType: 'application/pdf' })
    vi.mocked(callClaudeWithDocuments).mockResolvedValue(CLAUDE_RESPONSE)

    const files = [makeFile({ id: 'deed-id-123', name: 'deed.pdf' })]
    const report = await verifyAllFiles(files, PROPERTY)

    const deed = report.requiredDocuments.find(d => d.type === 'tax_sale_deed')!
    expect(deed.status).toBe('present_verified')
    expect(deed.fileId).toBe('deed-id-123')
    expect(deed.fileName).toBe('deed.pdf')
    expect(deed.evidence?.propertyAddress).toBe('175 Deer Creek Cir')
    expect(deed.evidence?.grantor).toBe('Jones County Tax Commissioner')
    expect(deed.mismatches).toHaveLength(0)
  })

  it('handles claude response wrapped in markdown code fences', async () => {
    vi.mocked(googleClient.downloadFileAsBase64).mockResolvedValue({ data: 'b64', mimeType: 'application/pdf' })
    vi.mocked(callClaudeWithDocuments).mockResolvedValue('```json\n' + CLAUDE_RESPONSE + '\n```')

    const files = [makeFile({ name: 'deed.pdf' })]
    const report = await verifyAllFiles(files, PROPERTY)
    expect(report.requiredDocuments[0].status).toBe('present_verified')
  })

  it('throws on invalid JSON from claude', async () => {
    vi.mocked(googleClient.downloadFileAsBase64).mockResolvedValue({ data: 'b64', mimeType: 'application/pdf' })
    vi.mocked(callClaudeWithDocuments).mockResolvedValue('this is not json')

    const files = [makeFile({ name: 'deed.pdf' })]
    await expect(verifyAllFiles(files, PROPERTY)).rejects.toThrow('invalid JSON')
  })

  it('defaults missing required doc to status=missing', async () => {
    vi.mocked(googleClient.downloadFileAsBase64).mockResolvedValue({ data: 'b64', mimeType: 'application/pdf' })
    // Claude returns no requiredDocuments array at all
    vi.mocked(callClaudeWithDocuments).mockResolvedValue(JSON.stringify({
      fileClassifications: [], requiredDocuments: [], overallMatch: false,
    }))

    const files = [makeFile({ name: 'unknown.pdf' })]
    const report = await verifyAllFiles(files, PROPERTY)
    expect(report.requiredDocuments.every(d => d.status === 'missing')).toBe(true)
    expect(report.requiredDocuments.every(d => d.label === REQUIRED_LABELS[d.type])).toBe(true)
  })

  it('passes extraction errors gracefully and skips failed files', async () => {
    vi.mocked(googleClient.downloadFileAsBase64).mockRejectedValue(new Error('network error'))
    vi.mocked(callClaude).mockResolvedValue(JSON.stringify({
      fileClassifications: [], requiredDocuments: [], overallMatch: false,
    }))

    const files = [makeFile({ name: 'deed.pdf', mimeType: 'application/pdf' })]
    const report = await verifyAllFiles(files, PROPERTY)
    // The failed file is skipped; no readable/pdf docs → returns empty result without calling Claude
    expect(report.requiredDocuments.every(d => d.status === 'missing')).toBe(true)
  })

  it('includes verifiedAt timestamp in the report', async () => {
    vi.mocked(googleClient.downloadFileAsBase64).mockResolvedValue({ data: 'b64', mimeType: 'application/pdf' })
    vi.mocked(callClaudeWithDocuments).mockResolvedValue(CLAUDE_RESPONSE)

    const before = new Date().toISOString()
    const report = await verifyAllFiles([makeFile({ name: 'deed.pdf' })], PROPERTY)
    const after = new Date().toISOString()

    expect(report.verifiedAt >= before).toBe(true)
    expect(report.verifiedAt <= after).toBe(true)
  })

  it('sets overallMatch false when only deed found (no propertyradar)', async () => {
    vi.mocked(googleClient.downloadFileAsBase64).mockResolvedValue({ data: 'b64', mimeType: 'application/pdf' })
    vi.mocked(callClaudeWithDocuments).mockResolvedValue(CLAUDE_RESPONSE)

    const report = await verifyAllFiles([makeFile({ name: 'deed.pdf' })], PROPERTY)
    // CLAUDE_RESPONSE has overallMatch: false (property_radar missing)
    expect(report.overallMatch).toBe(false)
  })

  it('populates consolidatedData from claude response', async () => {
    vi.mocked(googleClient.downloadFileAsBase64).mockResolvedValue({ data: 'b64', mimeType: 'application/pdf' })
    vi.mocked(callClaudeWithDocuments).mockResolvedValue(CLAUDE_RESPONSE)

    const report = await verifyAllFiles([makeFile({ name: 'deed.pdf' })], PROPERTY)
    expect(report.consolidatedData.propertyAddress).toBe('175 Deer Creek Cir, Gray, GA 31032')
    expect(report.consolidatedData.saleAmount).toBe('$32,000')
    expect(report.consolidatedData.bookPage).toBe('Book 01155, Page 0653')
    expect(report.consolidatedData.county).toBe('Jones')
    expect(report.consolidatedData.deedRecordedDate).toBe('2023-12-15')
  })

  it('populates summary from claude response', async () => {
    vi.mocked(googleClient.downloadFileAsBase64).mockResolvedValue({ data: 'b64', mimeType: 'application/pdf' })
    vi.mocked(callClaudeWithDocuments).mockResolvedValue(CLAUDE_RESPONSE)

    const report = await verifyAllFiles([makeFile({ name: 'deed.pdf' })], PROPERTY)
    expect(report.summary).toBe('Tax sale deed found and verified. PropertyRadar profile not present.')
  })

  it('returns empty consolidatedData and summary when no files readable', async () => {
    const report = await verifyAllFiles([], PROPERTY)
    expect(report.consolidatedData.propertyAddress).toBeNull()
    expect(report.summary).toBeTruthy()   // reason string, not empty
  })

  it('includes consolidatedData with all-null values when claude omits it', async () => {
    vi.mocked(googleClient.downloadFileAsBase64).mockResolvedValue({ data: 'b64', mimeType: 'application/pdf' })
    vi.mocked(callClaudeWithDocuments).mockResolvedValue(JSON.stringify({
      fileClassifications: [], requiredDocuments: [], overallMatch: false,
      // no consolidatedData, no summary
    }))

    const report = await verifyAllFiles([makeFile({ name: 'deed.pdf' })], PROPERTY)
    expect(report.consolidatedData).toBeDefined()
    expect(Object.values(report.consolidatedData).every(v => v === null)).toBe(true)
    expect(report.summary).toBe('')
  })

  it('passes max_tokens=8000 to callClaudeWithDocuments (PDF path)', async () => {
    vi.mocked(googleClient.downloadFileAsBase64).mockResolvedValue({ data: 'b64', mimeType: 'application/pdf' })
    vi.mocked(callClaudeWithDocuments).mockResolvedValue(CLAUDE_RESPONSE)

    await verifyAllFiles([makeFile({ name: 'deed.pdf', mimeType: 'application/pdf' })], PROPERTY)

    const call = vi.mocked(callClaudeWithDocuments).mock.calls[0]
    // callClaudeWithDocuments(documents, prompt, system, maxTokens)
    expect(call[3]).toBe(8000)
  })

  it('passes max_tokens=8000 to callClaude (text-only path)', async () => {
    vi.mocked(googleClient.exportFileAsText).mockResolvedValue('notice letter content')
    vi.mocked(callClaude).mockResolvedValue(CLAUDE_RESPONSE)

    await verifyAllFiles(
      [makeFile({ name: 'notice.gdoc', mimeType: 'application/vnd.google-apps.document' })],
      PROPERTY,
    )

    const call = vi.mocked(callClaude).mock.calls[0]
    // callClaude(prompt, system, maxTokens)
    expect(call[2]).toBe(8000)
  })
})
