import type { DriveFileEntry } from './drive-index'

export type DocType = 'tax_sale_deed' | 'property_radar' | 'notice_letter'

export type DocStatus = {
  type: DocType
  label: string
  found: boolean
  file: DriveFileEntry | null
  // A file that partially matched but wasn't strong enough to classify.
  // Shown in UI as "possible match" with a reason.
  possibleMatch: DriveFileEntry | null
  possibleMatchReason: string | null
}

export type DocChecklist = {
  required: DocStatus[]
  unclassified: DriveFileEntry[]
}

type DocDef = {
  type: DocType
  label: string
  // Strong patterns — file is classified as this doc type
  patterns: RegExp[]
  // Weak patterns — file might be this doc type, surface as a hint
  weakPatterns: RegExp[]
  weakReason: string   // shown to user when only a weak match is found
}

const REQUIRED_DOCS: DocDef[] = [
  {
    type: 'tax_sale_deed',
    label: 'Tax Sale Deed',
    patterns: [
      /tax.?sale.?deed/i,
      /tax.?deed/i,
      /deed.of.sale/i,
      /certificate.of.title/i,
    ],
    weakPatterns: [/\bdeed\b/i],
    weakReason: 'File name contains "deed" — may be the Tax Sale Deed',
  },
  {
    type: 'property_radar',
    label: 'PropertyRadar Profile',
    patterns: [
      /propertyradar/i,
      /property.radar/i,
      /property.profile/i,
      /pr.report/i,
    ],
    weakPatterns: [/\bradar\b/i, /property.*report/i],
    weakReason: 'File name suggests a property report — may be the PropertyRadar Profile',
  },
  {
    type: 'notice_letter',
    label: 'Notice Letter',
    patterns: [
      /notice.?letter/i,
      /outreach.?letter/i,
      /mailed.?notice/i,
      /horizon.*letter/i,
      /notice.?template/i,   // "of NoticeTemplate" naming convention
      /noticetemplate/i,
      /of.notice/i,
    ],
    weakPatterns: [/\bnotice\b/i, /\bletter\b/i, /\boutreach\b/i, /\btemplate\b/i],
    weakReason: 'File name contains "notice", "letter", or "template" — may be the Notice Letter',
  },
]

function matchStrong(name: string): DocType | null {
  for (const doc of REQUIRED_DOCS) {
    if (doc.patterns.some(p => p.test(name))) return doc.type
  }
  return null
}

function matchWeak(name: string): { type: DocType; reason: string } | null {
  for (const doc of REQUIRED_DOCS) {
    if (doc.weakPatterns.some(p => p.test(name))) {
      return { type: doc.type, reason: doc.weakReason }
    }
  }
  return null
}

export function classifyFiles(files: DriveFileEntry[]): DocChecklist {
  const matched = new Map<DocType, DriveFileEntry>()
  const unclassified: DriveFileEntry[] = []

  for (const file of files) {
    const docType = matchStrong(file.name)
    if (docType && !matched.has(docType)) {
      matched.set(docType, file)
    } else {
      unclassified.push(file)
    }
  }

  // For unmatched doc types, find the best weak match from unclassified files
  const weakMatches = new Map<DocType, { file: DriveFileEntry; reason: string }>()
  for (const file of unclassified) {
    const weak = matchWeak(file.name)
    if (weak && !matched.has(weak.type) && !weakMatches.has(weak.type)) {
      weakMatches.set(weak.type, { file, reason: weak.reason })
    }
  }

  const required: DocStatus[] = REQUIRED_DOCS.map(doc => {
    const file = matched.get(doc.type) ?? null
    const weak = weakMatches.get(doc.type) ?? null
    return {
      type: doc.type,
      label: doc.label,
      found: file !== null,
      file,
      possibleMatch: file ? null : (weak?.file ?? null),
      possibleMatchReason: file ? null : (weak?.reason ?? null),
    }
  })

  return { required, unclassified }
}
