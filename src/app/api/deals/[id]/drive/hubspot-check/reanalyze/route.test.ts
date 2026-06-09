import { describe, it, expect, vi, beforeEach } from 'vitest'
import { NextRequest } from 'next/server'

vi.mock('@/lib/auth/require-session', () => ({
  isAuthenticated: vi.fn().mockResolvedValue(true),
  isCronRequest: vi.fn().mockReturnValue(false),
  unauthorizedResponse: vi.fn(),
}))
vi.mock('@/lib/db/deals', () => ({
  getDealById: vi.fn(),
  updateDealHubspotCheck: vi.fn().mockResolvedValue(undefined),
}))
vi.mock('@/lib/integrations/hubspot-browser/drive-check', () => ({
  runVisionAnalysis: vi.fn(),
  buildDocStatuses: vi.fn(),
  buildStructured: vi.fn(),
  buildCheckSummary: vi.fn(),
}))
vi.mock('@/lib/integrations/hubspot-browser/expected-files', () => ({
  buildExpectedFiles: vi.fn(),
}))
vi.mock('@/lib/logger', () => ({ log: { info: vi.fn(), warn: vi.fn(), error: vi.fn() } }))

import { POST } from './route'
import { getDealById, updateDealHubspotCheck } from '@/lib/db/deals'
import { runVisionAnalysis, buildDocStatuses, buildStructured, buildCheckSummary } from '@/lib/integrations/hubspot-browser/drive-check'
import { buildExpectedFiles } from '@/lib/integrations/hubspot-browser/expected-files'

const mockGetDealById = vi.mocked(getDealById)
const mockUpdateDealHubspotCheck = vi.mocked(updateDealHubspotCheck)
const mockRunVisionAnalysis = vi.mocked(runVisionAnalysis)
const mockBuildExpectedFiles = vi.mocked(buildExpectedFiles)
const mockBuildDocStatuses = vi.mocked(buildDocStatuses)
const mockBuildStructured = vi.mocked(buildStructured)
const mockBuildCheckSummary = vi.mocked(buildCheckSummary)

const SCREENSHOT = 'fakejpegbase64data'

const dealWithScreenshot = {
  hubspotId: 'deal-123',
  name: 'Test Deal',
  hubspotScreenshot: SCREENSHOT,
  driveFilesCache: [],
  docVerification: null,
  hubspotCheck: null,
  hubspotCheckAt: null,
  hubspotDocStatus: null,
}

const dealWithoutScreenshot = { ...dealWithScreenshot, hubspotScreenshot: null }

const visionResult = {
  filesLinked: true,
  linkedFiles: ['Tax Deed.pdf'],
  missingFiles: [],
  confidence: 'high' as const,
  findings: ['Tax Deed.pdf found'],
}

const docStatuses = [{ type: 'tax_sale_deed', label: 'Tax Sale Deed', fileName: 'Tax Deed.pdf', linked: true }]
const structured = {
  documents: [{ type: 'tax_sale_deed', label: 'Tax Sale Deed', linked: true, expected: true, fileName: 'Tax Deed.pdf' }],
  verification: { requiredDocumentsFound: 1, requiredDocumentsMissing: 0, allRequiredDocumentsPresent: true },
}

function makeRequest(id = 'deal-123') {
  return new NextRequest(`http://localhost/api/deals/${id}/drive/hubspot-check/reanalyze`, { method: 'POST' })
}

beforeEach(() => {
  vi.clearAllMocks()
  mockGetDealById.mockResolvedValue(dealWithScreenshot as any)
  mockBuildExpectedFiles.mockReturnValue({ expectedFiles: ['Tax Deed.pdf'], classifiedDocs: [{ type: 'tax_sale_deed', label: 'Tax Sale Deed', fileName: 'Tax Deed.pdf' }] })
  mockRunVisionAnalysis.mockResolvedValue(visionResult)
  mockBuildDocStatuses.mockReturnValue(docStatuses as any)
  mockBuildStructured.mockReturnValue(structured)
  mockBuildCheckSummary.mockReturnValue('1 of 1 required documents linked in HubSpot')
})

describe('POST /reanalyze', () => {
  it('returns 404 when deal not found', async () => {
    mockGetDealById.mockResolvedValue(null)
    const res = await POST(makeRequest(), { params: Promise.resolve({ id: 'deal-123' }) })
    expect(res.status).toBe(404)
  })

  it('returns 422 with code NO_SCREENSHOT when deal has no saved screenshot', async () => {
    mockGetDealById.mockResolvedValue(dealWithoutScreenshot as any)
    const res = await POST(makeRequest(), { params: Promise.resolve({ id: 'deal-123' }) })
    expect(res.status).toBe(422)
    const body = await res.json()
    expect(body.code).toBe('NO_SCREENSHOT')
  })

  it('calls buildExpectedFiles with the deal', async () => {
    await POST(makeRequest(), { params: Promise.resolve({ id: 'deal-123' }) })
    expect(mockBuildExpectedFiles).toHaveBeenCalledWith(dealWithScreenshot)
  })

  it('calls runVisionAnalysis with the saved screenshot and expectedFiles', async () => {
    await POST(makeRequest(), { params: Promise.resolve({ id: 'deal-123' }) })
    expect(mockRunVisionAnalysis).toHaveBeenCalledWith(SCREENSHOT, ['Tax Deed.pdf'])
  })

  it('calls updateDealHubspotCheck with structured findings (preserves screenshot)', async () => {
    await POST(makeRequest(), { params: Promise.resolve({ id: 'deal-123' }) })
    const [id, checkData, screenshot, statuses] = mockUpdateDealHubspotCheck.mock.calls[0]
    expect(id).toBe('deal-123')
    // Preserves the existing screenshot — does NOT pass null
    expect(screenshot).toBe(SCREENSHOT)
    expect(checkData).toMatchObject({ structured, summary: '1 of 1 required documents linked in HubSpot' })
    expect(statuses).toBe(docStatuses)
  })

  it('returns 200 with the vision result', async () => {
    const res = await POST(makeRequest(), { params: Promise.resolve({ id: 'deal-123' }) })
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.filesLinked).toBe(true)
    expect(body.linkedFiles).toContain('Tax Deed.pdf')
    expect(body.detectionMethod).toBe('vision')
  })

  it('returns 422 with NO_SCREENSHOT when expectedFiles is empty', async () => {
    mockBuildExpectedFiles.mockReturnValue({ expectedFiles: [], classifiedDocs: null })
    const res = await POST(makeRequest(), { params: Promise.resolve({ id: 'deal-123' }) })
    expect(res.status).toBe(422)
    const body = await res.json()
    expect(body.code).toBe('NO_DRIVE_FILES')
  })
})
