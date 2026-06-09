import { describe, it, expect, vi, beforeEach } from 'vitest'
import { buildExpectedFiles } from './expected-files'

vi.mock('@/lib/integrations/google/doc-classifier', () => ({
  classifyFiles: vi.fn(),
}))

import { classifyFiles } from '@/lib/integrations/google/doc-classifier'

const mockClassifyFiles = vi.mocked(classifyFiles)

const makeFile = (id: string, name: string) => ({
  id, name, mimeType: 'application/pdf', modifiedAt: null,
  webViewLink: null, iconLink: null, sizeBytes: null,
})

const emptyChecklist = {
  required: [
    { type: 'tax_sale_deed' as const, label: 'Tax Sale Deed', found: false, file: null, possibleMatch: null, possibleMatchReason: null },
    { type: 'property_radar' as const, label: 'PropertyRadar Profile', found: false, file: null, possibleMatch: null, possibleMatchReason: null },
    { type: 'notice_letter' as const, label: 'Notice Letter', found: false, file: null, possibleMatch: null, possibleMatchReason: null },
  ],
  unclassified: [],
}

describe('buildExpectedFiles', () => {
  beforeEach(() => { mockClassifyFiles.mockReset() })

  it('returns empty expectedFiles when driveFilesCache is empty and no docVerification', () => {
    mockClassifyFiles.mockReturnValue(emptyChecklist)
    const result = buildExpectedFiles({ docVerification: null, driveFilesCache: [] })
    expect(result.expectedFiles).toEqual([])
    expect(result.classifiedDocs).toBeNull()
  })

  // ── Priority 1: verifyReport ────────────────────────────────────────────────

  it('P1: uses verifyReport fileId→Drive name when match exists', () => {
    const files = [makeFile('file-1', 'Tax Deed Smith.pdf'), makeFile('file-2', 'Lloyd Smith.pdf')]
    const docVerification = {
      requiredDocuments: [
        { type: 'tax_sale_deed', label: 'Tax Sale Deed', fileId: 'file-1', status: 'present_verified' },
        { type: 'property_radar', label: 'PropertyRadar Profile', fileId: null, status: 'missing' },
      ],
    }
    const result = buildExpectedFiles({ docVerification, driveFilesCache: files })
    expect(result.expectedFiles).toEqual(['Tax Deed Smith.pdf'])
    expect(result.classifiedDocs).toEqual([
      { type: 'tax_sale_deed', label: 'Tax Sale Deed', fileName: 'Tax Deed Smith.pdf' },
    ])
    expect(mockClassifyFiles).not.toHaveBeenCalled()
  })

  it('P1: returns multiple files when multiple fileIds match cache', () => {
    const files = [makeFile('f1', 'Deed.pdf'), makeFile('f2', 'Profile.pdf')]
    const docVerification = {
      requiredDocuments: [
        { type: 'tax_sale_deed', label: 'Tax Sale Deed', fileId: 'f1', status: 'present_verified' },
        { type: 'property_radar', label: 'PropertyRadar Profile', fileId: 'f2', status: 'present_verified' },
      ],
    }
    const result = buildExpectedFiles({ docVerification, driveFilesCache: files })
    expect(result.expectedFiles).toEqual(['Deed.pdf', 'Profile.pdf'])
    expect(result.classifiedDocs).toHaveLength(2)
    expect(mockClassifyFiles).not.toHaveBeenCalled()
  })

  it('P1→P2: falls through to classifier when no fileId matches cache', () => {
    const files = [makeFile('file-1', 'Tax Deed.pdf')]
    const docVerification = {
      requiredDocuments: [
        { type: 'tax_sale_deed', label: 'Tax Sale Deed', fileId: 'file-999', status: 'present_verified' },
      ],
    }
    mockClassifyFiles.mockReturnValue(emptyChecklist)
    buildExpectedFiles({ docVerification, driveFilesCache: files })
    expect(mockClassifyFiles).toHaveBeenCalled()
  })

  // ── Priority 2: classifier ──────────────────────────────────────────────────

  it('P2: uses classifier strong match when no docVerification', () => {
    const files = [makeFile('f1', 'Tax Sale Deed - Smith.pdf'), makeFile('f2', 'Misc.pdf')]
    const checklist = {
      required: [
        { type: 'tax_sale_deed' as const, label: 'Tax Sale Deed', found: true, file: makeFile('f1', 'Tax Sale Deed - Smith.pdf'), possibleMatch: null, possibleMatchReason: null },
        { type: 'property_radar' as const, label: 'PropertyRadar Profile', found: false, file: null, possibleMatch: null, possibleMatchReason: null },
        { type: 'notice_letter' as const, label: 'Notice Letter', found: false, file: null, possibleMatch: null, possibleMatchReason: null },
      ],
      unclassified: [],
    }
    mockClassifyFiles.mockReturnValue(checklist)
    const result = buildExpectedFiles({ docVerification: null, driveFilesCache: files })
    expect(result.expectedFiles).toEqual(['Tax Sale Deed - Smith.pdf'])
    expect(result.classifiedDocs).toEqual([
      { type: 'tax_sale_deed', label: 'Tax Sale Deed', fileName: 'Tax Sale Deed - Smith.pdf' },
    ])
  })

  it('P2: includes possibleMatch files', () => {
    const files = [makeFile('f1', 'deed.pdf')]
    const checklist = {
      required: [
        { type: 'tax_sale_deed' as const, label: 'Tax Sale Deed', found: false, file: null, possibleMatch: makeFile('f1', 'deed.pdf'), possibleMatchReason: 'Contains "deed"' },
        { type: 'property_radar' as const, label: 'PropertyRadar Profile', found: false, file: null, possibleMatch: null, possibleMatchReason: null },
        { type: 'notice_letter' as const, label: 'Notice Letter', found: false, file: null, possibleMatch: null, possibleMatchReason: null },
      ],
      unclassified: [],
    }
    mockClassifyFiles.mockReturnValue(checklist)
    const result = buildExpectedFiles({ docVerification: null, driveFilesCache: files })
    expect(result.expectedFiles).toEqual(['deed.pdf'])
    expect(result.classifiedDocs?.[0]?.type).toBe('tax_sale_deed')
  })

  it('P2: prefers strong match (file) over possibleMatch for same doc type', () => {
    const files = [makeFile('f1', 'Tax Deed.pdf'), makeFile('f2', 'possible.pdf')]
    const checklist = {
      required: [
        { type: 'tax_sale_deed' as const, label: 'Tax Sale Deed', found: true, file: makeFile('f1', 'Tax Deed.pdf'), possibleMatch: makeFile('f2', 'possible.pdf'), possibleMatchReason: null },
        { type: 'property_radar' as const, label: 'PropertyRadar Profile', found: false, file: null, possibleMatch: null, possibleMatchReason: null },
        { type: 'notice_letter' as const, label: 'Notice Letter', found: false, file: null, possibleMatch: null, possibleMatchReason: null },
      ],
      unclassified: [],
    }
    mockClassifyFiles.mockReturnValue(checklist)
    const result = buildExpectedFiles({ docVerification: null, driveFilesCache: files })
    expect(result.expectedFiles).toEqual(['Tax Deed.pdf'])
  })

  // ── Priority 3: all files ───────────────────────────────────────────────────

  it('P3: returns all file names when classifier finds nothing', () => {
    const files = [makeFile('f1', 'Unknown.pdf'), makeFile('f2', 'Another.pdf')]
    mockClassifyFiles.mockReturnValue(emptyChecklist)
    const result = buildExpectedFiles({ docVerification: null, driveFilesCache: files })
    expect(result.expectedFiles).toEqual(['Unknown.pdf', 'Another.pdf'])
    expect(result.classifiedDocs).toBeNull()
  })

  it('P3: null driveFilesCache is treated as empty array', () => {
    mockClassifyFiles.mockReturnValue(emptyChecklist)
    const result = buildExpectedFiles({ docVerification: null, driveFilesCache: null })
    expect(result.expectedFiles).toEqual([])
    expect(result.classifiedDocs).toBeNull()
  })
})
