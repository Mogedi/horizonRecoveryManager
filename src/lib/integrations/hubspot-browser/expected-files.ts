import { classifyFiles } from '@/lib/integrations/google/doc-classifier'
import type { DriveFileEntry } from '@/lib/integrations/google/drive-index'
import type { FullVerificationReport } from '@/lib/ai/doc-verify'

export type ClassifiedDoc = { type: string; label: string; fileName: string | null }

// Determines which Drive file names to look for during a HubSpot check.
// Three-tier priority:
//   1. verifyReport — AI confirmed the exact type→fileId mapping; use Drive file name from cache
//   2. Classifier — matched or possible-match files from the Drive cache
//   3. All cached files — fallback when classifier finds nothing
export function buildExpectedFiles(
  deal: { docVerification: unknown; driveFilesCache: unknown }
): { expectedFiles: string[]; classifiedDocs: ClassifiedDoc[] | null } {
  const cached = JSON.parse(JSON.stringify(deal.driveFilesCache ?? [])) as DriveFileEntry[]
  const driveFileById = new Map(cached.map(f => [f.id, f]))

  // Priority 1: verifyReport fileId → Drive file name
  if (deal.docVerification) {
    const report = deal.docVerification as unknown as FullVerificationReport
    const fromReport = report.requiredDocuments
      .filter(r => r.fileId && driveFileById.get(r.fileId))
      .map(r => ({ type: r.type, label: r.label, fileName: driveFileById.get(r.fileId!)!.name }))
    if (fromReport.length > 0) {
      return { expectedFiles: fromReport.map(d => d.fileName), classifiedDocs: fromReport }
    }
  }

  // Priority 2: classifier (strong matches + possibleMatches)
  const checklist = classifyFiles(cached)
  const classified = checklist.required
    .filter(d => d.file || d.possibleMatch)
    .map(d => ({ type: d.type, label: d.label, fileName: (d.file ?? d.possibleMatch)!.name }))
  if (classified.length > 0) {
    return { expectedFiles: classified.map(d => d.fileName), classifiedDocs: classified }
  }

  // Priority 3: all cached files
  return { expectedFiles: cached.map(f => f.name).filter(Boolean), classifiedDocs: null }
}
