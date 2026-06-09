// Checks whether Google Drive files are linked to a HubSpot deal via the
// HubSpot App Store Google Drive integration.
//
// Problem: HubSpot's API does not expose App Store integration data. Files
// may exist in Google Drive but employees may skip the step of linking them
// to the HubSpot deal sidebar. This check is the only way to verify the link
// without manually opening HubSpot.
//
// Approach — DOM-first with vision fallback:
//   1. Screenshot the HubSpot deal page (always — stored for record)
//   2. Extract the right sidebar innerText alongside the screenshot (zero AI cost)
//   3. Match expected file names against sidebar text (fast, exact, reliable)
//   4. If DOM match finds all expected files → return result (no Claude Vision call)
//   5. If DOM match is incomplete → fall back to Claude Vision analysis
//
// Why DOM-first: HubSpot renders file names as plain text links in the sidebar.
// innerText extraction is 100% accurate, avoids JPEG compression artifacts on small
// text, and costs nothing. Vision is kept as a fallback for edge cases where the
// sidebar renders content in a way that doesn't appear in innerText.
//
// Required env vars:
//   HUBSPOT_PORTAL_ID        — numeric portal ID (from HubSpot settings)
//   HUBSPOT_SESSION_COOKIES  — JSON array of Playwright Cookie objects

import { takeScreenshot } from '@/lib/browser/screenshot'
import { verifyScreenshot } from '@/lib/ai/vision-verify'
import { loadHubSpotCookies } from '@/lib/browser/client'
import { BrowserError } from '@/lib/errors'
import { log } from '@/lib/logger'

// Per-document HubSpot link status — one entry per doc type checked.
// Computed at check time (route handler has full context), persisted in DB,
// and used in the UI to show per-row HS badges without re-doing string matching.
// Query example: WHERE hubspot_doc_status @> '[{"type":"tax_sale_deed","linked":false}]'
export type HubSpotDocStatus = {
  type: string        // classifier key: 'tax_sale_deed' | 'notice_letter' | 'property_radar' | ...
  label: string       // human-readable: 'Tax Sale Deed'
  linked: boolean     // true = file found in HubSpot Drive sidebar
  fileName: string | null  // Drive file name that was checked (null if no file candidate)
}

// Structured findings — the durable analysis asset stored in hubspotCheck JSON.
// structured.documents is the source of truth. structured.verification is derived
// from documents at write time (a reduce) and never maintained independently.
// expected=true for all current entries since all come from classifiedDocs.
export type StructuredDocument = {
  type: string
  label: string
  linked: boolean
  expected: boolean    // was this document part of the verification requirements?
  fileName: string | null
}

export type StructuredFindings = {
  documents: StructuredDocument[]
  verification: {
    requiredDocumentsFound: number
    requiredDocumentsMissing: number
    allRequiredDocumentsPresent: boolean
  }
}

export type HubSpotDriveCheckResult = {
  checked: boolean         // false if portal ID or cookies not configured
  filesLinked: boolean     // true if ALL expectedFiles found in sidebar
  linkedFiles: string[]    // file names found in the Google Drive sidebar
  missingFiles: string[]   // expectedFiles not visible in the sidebar
  confidence: 'high' | 'medium' | 'low'
  findings: string[]       // human-readable observations
  sessionExpired: boolean  // true if the page showed a login screen
  screenshotBase64: string | null
  checkedAt: string        // ISO timestamp
  detectionMethod: 'dom' | 'vision'  // which path found the result
  // Per-doc-type status — populated by the route handler after the check.
  // null when the check ran without classifier metadata (e.g. all-files fallback mode).
  docStatuses: HubSpotDocStatus[] | null
  // Durable structured findings — populated by route handler, stored in hubspotCheck JSON.
  // Future systems consume this without re-running vision. hubspotDocStatus column is the
  // GIN-indexed counterpart for DB queries; both come from the same source.
  structured?: StructuredFindings
  summary?: string
}

// Verdict event sent to onVerdictReady — identical shape but screenshotBase64 is always null.
// docStatuses is also null here; the route handler fills it in the SSE event after building it.
export type HubSpotDriveVerdictEvent = Omit<HubSpotDriveCheckResult, 'screenshotBase64'> & {
  screenshotBase64: null
}

// Internal: result of the fast DOM analysis phase
type DomPhase1 = {
  sessionExpired: boolean
  found: string[]
  missing: string[]
  domSucceeded: boolean
}

// Returns the HubSpot deal page URL for a given numeric deal ID.
function dealUrl(dealId: string): string {
  const portalId = process.env.HUBSPOT_PORTAL_ID
  if (!portalId) throw new BrowserError('HUBSPOT_PORTAL_ID env var is not set')
  return `https://app.hubspot.com/contacts/${portalId}/deal/${dealId}`
}

// Match expected file names against sidebar text.
// Uses prefix matching (first 25 chars) because HubSpot can truncate long file names
// with CSS ellipsis — innerText may return either the full or truncated string
// depending on the browser's computed style.
export function matchFilesInText(
  expectedFiles: string[],
  sidebarText: string,
): { found: string[]; missing: string[] } {
  const text = sidebarText.toLowerCase()
  const found: string[] = []
  const missing: string[] = []

  for (const file of expectedFiles) {
    // Try exact match first, then prefix match (first 25 chars handles truncation)
    const prefix = file.slice(0, 25).toLowerCase()
    if (text.includes(file.toLowerCase()) || (prefix.length >= 10 && text.includes(prefix))) {
      found.push(file)
    } else {
      missing.push(file)
    }
  }

  return { found, missing }
}

// Pure helper: detect session expiry and match files from page text.
// null means the selector/waitForText timed out — the Drive card didn't render in time.
// This is NOT a session expiry; fall through to vision fallback so Claude can see the screenshot.
// Only actual login-page text (when the browser was redirected to /login) means session expired.
function analyzeDom(text: string | null, expectedFiles: string[]): DomPhase1 {
  if (text === null) {
    return { sessionExpired: false, found: [], missing: expectedFiles, domSucceeded: false }
  }

  const lower = text.toLowerCase()
  const sessionExpired =
    lower.includes('log in') ||
    lower.includes('sign in') ||
    lower.includes('please sign in') ||
    lower.includes('create a free account')

  if (sessionExpired) {
    return { sessionExpired: true, found: [], missing: expectedFiles, domSucceeded: false }
  }

  const { found, missing } = matchFilesInText(expectedFiles, text)
  return { sessionExpired: false, found, missing, domSucceeded: missing.length === 0 }
}

// Build a verdict event (no screenshotBase64) from DOM phase1 data.
function buildVerdictEvent(
  phase1: DomPhase1,
  expectedFiles: string[],
): HubSpotDriveVerdictEvent {
  if (phase1.sessionExpired) {
    return {
      checked: true, filesLinked: false,
      linkedFiles: [], missingFiles: expectedFiles,
      confidence: 'high', findings: ['Session expired — HubSpot showed a login page'],
      sessionExpired: true, checkedAt: new Date().toISOString(),
      detectionMethod: 'dom', screenshotBase64: null, docStatuses: null,
    }
  }
  return {
    checked: true, filesLinked: phase1.domSucceeded,
    linkedFiles: phase1.found, missingFiles: phase1.missing,
    confidence: 'high',
    findings: phase1.found.map(f => `"${f}" found in HubSpot Google Drive sidebar (DOM)`),
    sessionExpired: false, checkedAt: new Date().toISOString(),
    detectionMethod: 'dom', screenshotBase64: null, docStatuses: null,
  }
}

export async function checkHubSpotDriveAttachments(
  hubspotId: string,
  expectedFiles: string[],
  // Two-phase UX: fires with the DOM verdict BEFORE the screenshot is ready.
  // Callers can stream this verdict immediately; screenshot arrives in the full return value.
  onVerdictReady?: (verdict: HubSpotDriveVerdictEvent) => Promise<void>,
): Promise<HubSpotDriveCheckResult> {
  const portalId = process.env.HUBSPOT_PORTAL_ID
  if (!portalId) {
    log.warn('hubspot-browser: HUBSPOT_PORTAL_ID not set — skipping drive check')
    return notConfigured()
  }

  const cookies = loadHubSpotCookies()
  if (cookies.length === 0) {
    log.warn('hubspot-browser: HUBSPOT_SESSION_COOKIES not set — skipping drive check')
    return notConfigured()
  }

  const url = dealUrl(hubspotId)

  // ── Step 1: Navigate, extract sidebar text, then humanize + screenshot ─────
  // The onTextExtracted hook fires between text extraction and humanize+screenshot,
  // giving the caller a fast Phase 1 verdict before the screenshot is taken (~5s vs ~25s).
  log.info('hubspot-check step 1/3: capturing screenshot + sidebar text', { hubspotId, url })
  const t1 = Date.now()

  let phase1: DomPhase1 | null = null

  const { base64, mimeType, width, height, extractedText } = await takeScreenshot(url, {
    cookies,
    viewport: { width: 1440, height: 900 },
    // Wait until the Google Drive card has actually rendered in the sidebar.
    // HubSpot lazy-loads app cards after the main record page, so we can't rely on
    // a container selector — we wait for the text content we actually need.
    waitForText: 'Google Drive',
    // Extract the full page body text. Using 'body' rather than a specific sidebar
    // selector makes this resilient to HubSpot layout changes and obfuscated class names.
    // File names like "Tax Sale Deed.pdf" are distinctive enough that false positives
    // from other page content are not a concern.
    extractText: 'body',
    type: 'jpeg',
    quality: 80,
    onTextExtracted: async (text) => {
      // Phase 1: DOM text ready — before humanize+screenshot (~5s into the request)
      phase1 = analyzeDom(text, expectedFiles)
      if (onVerdictReady) {
        log.info('hubspot-check: phase 1 verdict ready — firing callback', { hubspotId })
        await onVerdictReady(buildVerdictEvent(phase1, expectedFiles))
      }
    },
  })

  // Backward compat: mocked takeScreenshot may not call onTextExtracted.
  // In that case, analyze extractedText from the return value.
  if (!phase1) {
    phase1 = analyzeDom(extractedText, expectedFiles)
  }

  const screenshotKB = Math.round((base64.length * 3) / 4 / 1024)
  log.info('hubspot-check step 1/3: screenshot captured', {
    hubspotId, ms: Date.now() - t1, mimeType, width, height, sizeKB: screenshotKB,
    domTextLength: extractedText?.length ?? 0,
  })

  if (phase1.sessionExpired) {
    log.warn('hubspot-check: session appears expired', { hubspotId })
    return {
      checked: true, filesLinked: false, linkedFiles: [], missingFiles: expectedFiles,
      confidence: 'high', findings: ['Session expired — HubSpot showed a login page'],
      sessionExpired: true, screenshotBase64: base64,
      checkedAt: new Date().toISOString(), detectionMethod: 'dom', docStatuses: null,
    }
  }

  // ── Step 2: DOM-first detection ────────────────────────────────────────────
  log.info('hubspot-check step 2/3: DOM file detection', { hubspotId, expectedFiles })
  const t2 = Date.now()

  const { found: domFound, missing: domMissing, domSucceeded } = phase1

  log.info('hubspot-check step 2/3: DOM detection complete', {
    hubspotId, ms: Date.now() - t2,
    method: domSucceeded ? 'dom' : 'dom-incomplete→vision-fallback',
    found: domFound, missing: domMissing,
  })

  if (domSucceeded) {
    return {
      checked: true,
      filesLinked: true,
      linkedFiles: domFound,
      missingFiles: [],
      confidence: 'high',
      findings: domFound.map(f => `"${f}" found in HubSpot Google Drive sidebar (DOM)`),
      sessionExpired: false,
      screenshotBase64: base64,
      checkedAt: new Date().toISOString(),
      detectionMethod: 'dom',
      docStatuses: null,  // populated by route handler which has doc-type metadata
    }
  }

  // ── Step 3: Vision fallback (only if DOM missed files) ─────────────────────
  log.info('hubspot-check step 3/3: vision fallback', {
    hubspotId, mimeType, domFound, domMissing,
  })
  const t3 = Date.now()

  const visionResult = await verifyScreenshot(base64, {
    description: 'HubSpot deal page — Google Drive sidebar card shows attached files',
    expectedItems: expectedFiles,
    extractFields: ['all file names visible in the Google Drive card on the right sidebar'],
  }, mimeType)

  log.info('hubspot-check step 3/3: vision complete', {
    hubspotId, ms: Date.now() - t3,
    passed: visionResult.passed, confidence: visionResult.confidence,
    findings: visionResult.findings,
  })

  const visionSessionExpired = visionResult.findings.some(f =>
    f.toLowerCase().includes('session_expired') || f.toLowerCase().includes('login')
  )

  const allLinked = [...new Set([
    ...domFound,
    ...(visionResult.extracted['all file names visible in the Google Drive card on the right sidebar']
      ?.split(/[,\n]+/).map(s => s.trim()).filter(Boolean) ?? []),
  ])]

  return {
    checked: true,
    filesLinked: visionResult.passed && !visionSessionExpired,
    linkedFiles: allLinked,
    missingFiles: visionResult.missingItems,
    confidence: visionResult.confidence,
    findings: visionResult.findings,
    sessionExpired: visionSessionExpired,
    screenshotBase64: base64,
    checkedAt: new Date().toISOString(),
    detectionMethod: 'vision',
    docStatuses: null,
  }
}

// ─── Route handler helpers ────────────────────────────────────────────────────
// These are called by route handlers (not by checkHubSpotDriveAttachments) because
// only the route handler has classifiedDocs context after the check runs.

// Build per-doc-type statuses from classified docs and the actual linked files.
export function buildDocStatuses(
  classifiedDocs: Array<{ type: string; label: string; fileName: string | null }>,
  linkedFiles: string[],
): HubSpotDocStatus[] {
  const linked = new Set(linkedFiles.map(f => f.toLowerCase()))
  return classifiedDocs.map(doc => ({
    type: doc.type,
    label: doc.label,
    fileName: doc.fileName,
    linked: doc.fileName ? linked.has(doc.fileName.toLowerCase()) : false,
  }))
}

// Build structured findings from docStatuses. Verification counts are derived
// from documents at call time — never maintained independently.
export function buildStructured(docStatuses: HubSpotDocStatus[]): StructuredFindings {
  const documents: StructuredDocument[] = docStatuses.map(d => ({ ...d, expected: true }))
  const requiredDocumentsFound = documents.filter(d => d.linked).length
  const requiredDocumentsMissing = documents.filter(d => !d.linked).length
  return {
    documents,
    verification: {
      requiredDocumentsFound,
      requiredDocumentsMissing,
      allRequiredDocumentsPresent: requiredDocumentsMissing === 0,
    },
  }
}

// Human-readable one-line summary derived from structured findings.
export function buildCheckSummary(structured: StructuredFindings): string {
  const { requiredDocumentsFound, requiredDocumentsMissing, allRequiredDocumentsPresent } = structured.verification
  const total = requiredDocumentsFound + requiredDocumentsMissing
  const noun = `required document${total === 1 ? '' : 's'}`
  if (allRequiredDocumentsPresent) return `All ${total} ${noun} linked in HubSpot`
  return `${requiredDocumentsFound} of ${total} ${noun} linked in HubSpot`
}

// Vision-only analysis on a saved screenshot. Used by the reanalyze endpoint to
// skip the browser launch entirely. MimeType is always image/jpeg — all stored
// screenshots use takeScreenshot's hardcoded jpeg output.
export async function runVisionAnalysis(
  screenshotBase64: string,
  expectedFiles: string[],
): Promise<{
  filesLinked: boolean
  linkedFiles: string[]
  missingFiles: string[]
  confidence: 'high' | 'medium' | 'low'
  findings: string[]
}> {
  const visionResult = await verifyScreenshot(screenshotBase64, {
    description: 'HubSpot deal page — Google Drive sidebar card shows attached files',
    expectedItems: expectedFiles,
    extractFields: ['all file names visible in the Google Drive card on the right sidebar'],
  }, 'image/jpeg')

  const visionSessionExpired = visionResult.findings.some(f =>
    f.toLowerCase().includes('session_expired') || f.toLowerCase().includes('login')
  )

  const linkedFiles = [...new Set(
    (visionResult.extracted['all file names visible in the Google Drive card on the right sidebar']
      ?.split(/[,\n]+/).map(s => s.trim()).filter(Boolean) ?? [])
  )]

  return {
    filesLinked: visionResult.passed && !visionSessionExpired,
    linkedFiles,
    missingFiles: visionResult.missingItems,
    confidence: visionResult.confidence,
    findings: visionResult.findings,
  }
}

function notConfigured(): HubSpotDriveCheckResult {
  return {
    checked: false,
    filesLinked: false,
    linkedFiles: [],
    missingFiles: [],
    confidence: 'low',
    findings: ['HubSpot browser check not configured — set HUBSPOT_PORTAL_ID and HUBSPOT_SESSION_COOKIES'],
    sessionExpired: false,
    screenshotBase64: null,
    checkedAt: new Date().toISOString(),
    detectionMethod: 'dom',
    docStatuses: null,
  }
}
