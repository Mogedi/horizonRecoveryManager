// AI-driven document verification for overage cases.
//
// Extraction strategy (no local parser):
//   - Google Docs/Presentations → Drive text export (free, instant)
//   - Native PDFs → download as base64 → Anthropic PDF document blocks
//   - Everything else → skip
//
// A single Claude call receives all content: PDF document blocks + Google Doc
// text embedded in the prompt. Claude reads PDFs natively via the Anthropic API.

import { callClaude, callClaudeWithDocuments } from './client'
import { googleClient } from '@/lib/integrations/google/client'
import { log } from '@/lib/logger'
import type { DriveFileEntry } from '@/lib/integrations/google/drive-index'

// ─── Types ────────────────────────────────────────────────────────────────────

export type DocType = 'tax_sale_deed' | 'property_radar' | 'notice_letter' | 'other'

export type FileClassification = {
  fileId: string
  fileName: string
  docType: DocType
  confidence: 'high' | 'medium' | 'low'
  extractedDetails: string
}

export type DocEvidence = {
  propertyAddress: string | null
  parcelId: string | null
  saleDate: string | null
  grantor: string | null
  grantee: string | null
  otherDetails: string | null
}

export type RequiredDocResult = {
  type: 'tax_sale_deed' | 'property_radar' | 'notice_letter'
  label: string
  status: 'present_verified' | 'present_mismatch' | 'present_unverified' | 'missing'
  fileId: string | null
  fileName: string | null
  details: string
  evidence: DocEvidence | null
  mismatches: string[]
}

// Consolidated facts across all verified documents — one value per field, best available.
// Serves as the "source of truth" for quick display without re-reading per-doc evidence.
export type ConsolidatedData = {
  propertyAddress: string | null
  parcelId: string | null
  taxSaleDate: string | null       // date of the tax sale (from deed)
  saleAmount: string | null        // sale price at tax auction
  grantor: string | null           // who transferred (e.g. county tax commissioner)
  grantee: string | null           // recipient at auction
  county: string | null
  bookPage: string | null          // deed recording reference
  currentOwner: string | null      // from PropertyRadar (may differ from grantee)
  assessedValue: string | null     // from PropertyRadar
  deedRecordedDate: string | null  // when deed was recorded (may differ from sale date)
  taxLienAgainst: string | null    // verbatim text from deed: who the lien/assessment was against
  taxLienDebtors: string[] | null  // individual names parsed from taxLienAgainst
  state: string | null             // US state (e.g. "Georgia")
  zipCode: string | null           // ZIP code of the property
}

export type OwnerTrackingEntry = {
  name: string       // name as it appears in the lien document
  tracked: boolean   // true if a matching contact exists in the deal
}

export type FullVerificationReport = {
  fileClassifications: FileClassification[]
  requiredDocuments: RequiredDocResult[]
  consolidatedData: ConsolidatedData
  summary: string                  // one paragraph — what was verified and any issues
  overallMatch: boolean
  confidence: 'high' | 'medium' | 'low'   // how certain the AI is in its classifications
  confidenceReason: string                 // one sentence explaining the confidence level
  ownerTrackingCheck: OwnerTrackingEntry[] | null  // per-debtor tracking status; null if no lien debtors found
  propertyContext: { address: string | null; parcelId: string | null; taxSaleDate: string | null }
  skippedFiles: string[]
  verifiedAt: string
}

export type PropertyContext = {
  address: string | null
  parcelId: string | null
  taxSaleDate: string | null
  contactNames?: string[]   // names of HubSpot contacts currently tracked for this deal
}

// ─── Constants ────────────────────────────────────────────────────────────────

export const MAX_FILES = 5
export const MAX_TEXT_CHARS = 3000   // per Google Doc text export — keeps prompt size bounded

const SKIP_MIME_TYPES = new Set([
  'application/vnd.google-apps.folder',
  'application/vnd.google-apps.spreadsheet',
  'application/vnd.google-apps.form',
  'image/jpeg', 'image/png', 'image/gif', 'image/webp',
  'video/mp4', 'audio/mpeg',
])

export const REQUIRED_LABELS: Record<string, string> = {
  tax_sale_deed: 'Tax Sale Deed',
  property_radar: 'PropertyRadar Profile',
  notice_letter: 'Notice Letter',
}

// Name keywords used only for ranking — not for classification (Claude classifies by content)
const RANK_KEYWORDS = [
  'deed', 'title', 'certificate', 'tax', 'sale',
  'radar', 'propertyradar', 'profile', 'report',
  'notice', 'letter', 'template', 'outreach', 'surplus',
]

// ─── File scoring ─────────────────────────────────────────────────────────────

export function scoreFile(file: DriveFileEntry): number {
  const name = file.name.toLowerCase()
  let score = RANK_KEYWORDS.filter(k => name.includes(k)).length
  if (file.mimeType === 'application/pdf') score += 1
  if (file.mimeType === 'application/vnd.google-apps.document') score += 2
  if (file.sizeBytes && file.sizeBytes > 15 * 1024 * 1024) score -= 2   // very large → deprioritize
  return score
}

// ─── File extraction ──────────────────────────────────────────────────────────

type ExtractResult =
  | { kind: 'text'; text: string }
  | { kind: 'pdf'; base64: string }
  | { kind: 'skip' }

export async function extractFile(file: DriveFileEntry): Promise<ExtractResult> {
  if (file.mimeType === 'application/vnd.google-apps.document' ||
      file.mimeType === 'application/vnd.google-apps.presentation') {
    const text = await googleClient.exportFileAsText(file.id)
    return { kind: 'text', text: text.trim() }
  }

  if (file.mimeType === 'application/pdf') {
    const { data } = await googleClient.downloadFileAsBase64(file.id)
    return { kind: 'pdf', base64: data }
  }

  return { kind: 'skip' }
}

// ─── Claude prompt ────────────────────────────────────────────────────────────

const SYSTEM = `You are a document verification assistant for Horizon Recovery LLC, a surplus funds recovery firm.
Always respond with valid JSON only — no markdown, no preamble.`

export function buildPrompt(
  textDocs: Array<{ file: DriveFileEntry; text: string }>,
  pdfDocs: Array<{ file: DriveFileEntry }>,
  property: PropertyContext
): string {
  const propertyLines = [
    property.address ? `Address: ${property.address}` : null,
    property.parcelId ? `Parcel ID: ${property.parcelId}` : null,
    property.taxSaleDate ? `Tax Sale Date: ${property.taxSaleDate}` : null,
    (property.contactNames ?? []).length > 0
      ? `Tracked contacts: ${(property.contactNames ?? []).join(', ')}`
      : 'Tracked contacts: (none on file)',
  ].filter(Boolean).join('\n')

  const textSections = textDocs.length > 0
    ? textDocs.map((d, i) =>
        `--- Text Document ${i + 1}: "${d.file.name}" ---\n${d.text.slice(0, MAX_TEXT_CHARS)}\n--- End ---`
      ).join('\n\n')
    : ''

  const pdfNote = pdfDocs.length > 0
    ? `PDF documents (passed as document blocks above — read them directly):\n${pdfDocs.map((d, i) => `  PDF ${i + 1}: "${d.file.name}"`).join('\n')}`
    : ''

  const docSections = [textSections, pdfNote].filter(Boolean).join('\n\n')

  return `Property details from CRM:
${propertyLines || '(none — still classify all documents)'}

Documents to analyze:
${docSections}

TASK:
1. Classify each document by type and extract all visible details.
2. Determine whether each required document is present and matches the CRM property.
3. For the tax_sale_deed: extract EXACTLY who the tax lien was assessed against (the delinquent taxpayer text verbatim), then parse each individual name from that text.
4. Cross-reference each tax lien debtor name against the tracked contacts list. Use fuzzy matching (ignore middle initials, minor spelling variants).
5. For the notice_letter: verify accuracy against the deed and property profile — check that the name, property address, parcel ID, county, and any other facts in the letter match the other documents. List any errors or discrepancies.
6. Consolidate the best value for each field across all documents.
7. Write a structured summary of findings — see format instructions below.

Required document types:
- tax_sale_deed: Official deed from a tax sale (issued by county tax commissioner/collector)
- property_radar: PropertyRadar property report/profile (ownership, parcel, assessed value)
- notice_letter: Outreach or notice letter sent to property owner about surplus funds

Summary format — use markdown, NOT a plain paragraph:
- One bullet per document found (bold the document type): **Tax Sale Deed** — [one sentence finding]
  - Sub-bullet for each key fact confirmed or issue found
- Final bullet: **Overall** — [one sentence verdict]

Respond with ONLY this JSON (no markdown wrapping):
{
  "fileClassifications": [
    {
      "fileName": "<exact file name>",
      "docType": "tax_sale_deed | property_radar | notice_letter | other",
      "confidence": "high | medium | low",
      "extractedDetails": "<address, parcel ID, names, dates, county, amounts — quote from the document>"
    }
  ],
  "requiredDocuments": [
    {
      "type": "tax_sale_deed",
      "status": "present_verified | present_mismatch | present_unverified | missing",
      "fileName": "<file name or null>",
      "details": "<one sentence: what confirmed the match, or why missing>",
      "evidence": {
        "propertyAddress": "<as shown in document, or null>",
        "parcelId": "<parcel ID, or null>",
        "saleDate": "<sale date, or null>",
        "grantor": "<e.g. county tax commissioner, or null>",
        "grantee": "<recipient name, or null>",
        "otherDetails": "<sale amount, county, book/page, or null>"
      },
      "mismatches": ["<e.g. 'Deed: 123 Oak St — CRM: 124 Oak St'>"]
    },
    {
      "type": "property_radar",
      "status": "present_verified | present_mismatch | present_unverified | missing",
      "fileName": "<file name or null>",
      "details": "<one sentence>",
      "evidence": { "propertyAddress": null, "parcelId": null, "saleDate": null, "grantor": null, "grantee": null, "otherDetails": null },
      "mismatches": []
    },
    {
      "type": "notice_letter",
      "status": "present_verified | present_mismatch | present_unverified | missing",
      "fileName": "<file name or null>",
      "details": "<one sentence: letter accuracy verdict or why missing>",
      "evidence": { "propertyAddress": null, "parcelId": null, "saleDate": null, "grantor": null, "grantee": null, "otherDetails": null },
      "mismatches": ["<any errors in the letter vs. the deed/property profile, e.g. 'Letter says parcel 123 but deed says parcel 456'>"]
    }
  ],
  "consolidatedData": {
    "propertyAddress": "<best available address across all docs, or null>",
    "parcelId": "<parcel ID, or null>",
    "taxSaleDate": "<date of tax sale, or null>",
    "saleAmount": "<sale price at auction, or null>",
    "grantor": "<county tax commissioner name, or null>",
    "grantee": "<buyer at auction, or null>",
    "county": "<county name, or null>",
    "state": "<US state name, e.g. Georgia, or null>",
    "zipCode": "<ZIP code of the property, or null>",
    "bookPage": "<deed book and page number, or null>",
    "currentOwner": "<current owner from PropertyRadar, or null>",
    "assessedValue": "<assessed value from PropertyRadar, or null>",
    "deedRecordedDate": "<date deed was recorded, or null>",
    "taxLienAgainst": "<VERBATIM text from deed of who the lien was assessed against, or null if not found>",
    "taxLienDebtors": ["<individual name 1>", "<individual name 2>"]
  },
  "ownerTrackingCheck": [
    { "name": "<debtor name as in deed>", "tracked": true },
    { "name": "<debtor name as in deed>", "tracked": false }
  ],
  "summary": "<markdown-formatted summary per instructions above>",
  "confidence": "high | medium | low",
  "confidenceReason": "<one sentence: why this confidence level>",
  "overallMatch": false
}

Notes:
- taxLienDebtors: empty array [] if taxLienAgainst is null
- ownerTrackingCheck: empty array [] if no debtors found; use fuzzy name matching (ignore middle initials)
- Confidence rules: high = all docs present, clear text, fields match; medium = minor gaps or one doc missing; low = key docs missing or significant mismatches
- Status rules: present_verified = found AND fields match CRM; present_mismatch = found BUT address or parcel ID differs; present_unverified = found but content unclear; missing = not in folder
- overallMatch: true only if tax_sale_deed AND property_radar are both present_verified or present_unverified`
}

// ─── Main export ──────────────────────────────────────────────────────────────

export async function verifyAllFiles(
  files: DriveFileEntry[],
  property: PropertyContext
): Promise<FullVerificationReport> {
  const verifiedAt = new Date().toISOString()
  const skippedFiles: string[] = []

  // Filter unsupported types, rank by document likelihood, take top MAX_FILES
  const candidates = files.filter(f => {
    if (SKIP_MIME_TYPES.has(f.mimeType)) { skippedFiles.push(f.name); return false }
    return true
  })

  const ranked = [...candidates].sort((a, b) => scoreFile(b) - scoreFile(a))
  const selected = ranked.slice(0, MAX_FILES)
  for (const f of ranked.slice(MAX_FILES)) skippedFiles.push(f.name)

  log.info('doc verify: file selection', {
    total: files.length, candidates: candidates.length,
    selected: selected.length, skipped: skippedFiles.length,
  })

  if (selected.length === 0) {
    return empty('No readable documents found in this folder.', property, skippedFiles, verifiedAt)
  }

  // Extract all selected files in parallel
  const extractions = await Promise.allSettled(
    selected.map(async f => ({ file: f, result: await extractFile(f) }))
  )

  const textDocs: Array<{ file: DriveFileEntry; text: string }> = []
  const pdfDocs: Array<{ file: DriveFileEntry; base64: string }> = []

  for (const outcome of extractions) {
    if (outcome.status === 'rejected') {
      const file = selected[extractions.indexOf(outcome)]
      log.warn('doc verify: extraction failed', { fileName: file?.name, error: String(outcome.reason) })
      skippedFiles.push(file?.name ?? 'unknown')
      continue
    }
    const { file, result } = outcome.value
    if (result.kind === 'text') textDocs.push({ file, text: result.text })
    else if (result.kind === 'pdf') pdfDocs.push({ file, base64: result.base64 })
    else skippedFiles.push(file.name)
  }

  if (textDocs.length === 0 && pdfDocs.length === 0) {
    return empty('No supported documents could be read.', property, skippedFiles, verifiedAt)
  }

  log.info('doc verify: sending to Claude', { textDocs: textDocs.length, pdfDocs: pdfDocs.length })

  // Single Claude call: PDFs as Anthropic document blocks, Google Doc text in the prompt
  let raw: string
  const prompt = buildPrompt(textDocs, pdfDocs, property)
  if (pdfDocs.length > 0) {
    const documents = pdfDocs.map(d => ({
      data: d.base64,
      mimeType: 'application/pdf' as const,
      label: d.file.name,
    }))
    raw = await callClaudeWithDocuments(documents, prompt, SYSTEM, 8000)
  } else {
    raw = await callClaude(prompt, SYSTEM, 8000)
  }

  // Parse response
  let parsed: {
    fileClassifications: Array<{ fileName: string; docType: DocType; confidence: string; extractedDetails: string }>
    requiredDocuments: Array<{ type: string; status: string; fileName: string | null; details: string; evidence?: DocEvidence; mismatches?: string[] }>
    consolidatedData?: Partial<ConsolidatedData>
    ownerTrackingCheck?: Array<{ name: string; tracked: boolean }>
    summary?: string
    confidence?: string
    confidenceReason?: string
    overallMatch: boolean
  }

  try {
    const cleaned = raw.replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/i, '').trim()
    parsed = JSON.parse(cleaned)
  } catch {
    throw new Error(`Claude returned invalid JSON: ${raw.slice(0, 300)}`)
  }

  const fileByName = new Map<string, DriveFileEntry>([
    ...textDocs.map(d => [d.file.name, d.file] as [string, DriveFileEntry]),
    ...pdfDocs.map(d => [d.file.name, d.file] as [string, DriveFileEntry]),
  ])

  const fileClassifications: FileClassification[] = (parsed.fileClassifications ?? []).map(c => ({
    fileId: fileByName.get(c.fileName)?.id ?? '',
    fileName: c.fileName,
    docType: c.docType ?? 'other',
    confidence: (c.confidence as 'high' | 'medium' | 'low') ?? 'low',
    extractedDetails: c.extractedDetails ?? '',
  }))

  const requiredDocuments: RequiredDocResult[] = (['tax_sale_deed', 'property_radar', 'notice_letter'] as const).map(type => {
    const r = parsed.requiredDocuments?.find(d => d.type === type)
    const matchedFile = r?.fileName ? fileByName.get(r.fileName) : null
    return {
      type,
      label: REQUIRED_LABELS[type],
      status: (r?.status as RequiredDocResult['status']) ?? 'missing',
      fileId: matchedFile?.id ?? null,
      fileName: r?.fileName ?? null,
      details: r?.details ?? 'Not found.',
      evidence: r?.evidence ?? null,
      mismatches: r?.mismatches ?? [],
    }
  })

  const consolidatedData: ConsolidatedData = {
    propertyAddress: parsed.consolidatedData?.propertyAddress ?? null,
    parcelId: parsed.consolidatedData?.parcelId ?? null,
    taxSaleDate: parsed.consolidatedData?.taxSaleDate ?? null,
    saleAmount: parsed.consolidatedData?.saleAmount ?? null,
    grantor: parsed.consolidatedData?.grantor ?? null,
    grantee: parsed.consolidatedData?.grantee ?? null,
    county: parsed.consolidatedData?.county ?? null,
    state: parsed.consolidatedData?.state ?? null,
    zipCode: parsed.consolidatedData?.zipCode ?? null,
    bookPage: parsed.consolidatedData?.bookPage ?? null,
    currentOwner: parsed.consolidatedData?.currentOwner ?? null,
    assessedValue: parsed.consolidatedData?.assessedValue ?? null,
    deedRecordedDate: parsed.consolidatedData?.deedRecordedDate ?? null,
    taxLienAgainst: parsed.consolidatedData?.taxLienAgainst ?? null,
    taxLienDebtors: parsed.consolidatedData?.taxLienDebtors ?? null,
  }

  return {
    fileClassifications,
    requiredDocuments,
    consolidatedData,
    summary: parsed.summary ?? '',
    overallMatch: parsed.overallMatch ?? false,
    confidence: (parsed.confidence as 'high' | 'medium' | 'low') ?? 'low',
    confidenceReason: parsed.confidenceReason ?? '',
    ownerTrackingCheck: parsed.ownerTrackingCheck ?? null,
    propertyContext: property,
    skippedFiles,
    verifiedAt,
  }
}

const EMPTY_CONSOLIDATED: ConsolidatedData = {
  propertyAddress: null, parcelId: null, taxSaleDate: null, saleAmount: null,
  grantor: null, grantee: null, county: null, state: null, zipCode: null,
  bookPage: null, currentOwner: null, assessedValue: null, deedRecordedDate: null,
  taxLienAgainst: null, taxLienDebtors: null,
}

function empty(reason: string, property: PropertyContext, skippedFiles: string[], verifiedAt: string): FullVerificationReport {
  return {
    fileClassifications: [],
    requiredDocuments: (['tax_sale_deed', 'property_radar', 'notice_letter'] as const).map(type => ({
      type, label: REQUIRED_LABELS[type], status: 'missing' as const,
      fileId: null, fileName: null, details: reason, evidence: null, mismatches: [],
    })),
    consolidatedData: EMPTY_CONSOLIDATED,
    summary: reason,
    overallMatch: false,
    confidence: 'low' as const,
    confidenceReason: reason,
    ownerTrackingCheck: null,
    propertyContext: property,
    skippedFiles,
    verifiedAt,
  }
}
