// POST /api/deals/[id]/drive/hubspot-check/reanalyze
//
// Vision-only re-analysis on the saved screenshot. Skips browser launch entirely.
// Use when a screenshot already exists and you want fresh analysis without
// the ~25s browser session.
//
// Returns 422 { code: 'NO_SCREENSHOT' } when no screenshot is saved for the deal.

import { NextRequest, NextResponse } from 'next/server'
import { isAuthenticated, isCronRequest, unauthorizedResponse } from '@/lib/auth/require-session'
import { getDealById, updateDealHubspotCheck } from '@/lib/db/deals'
import {
  runVisionAnalysis,
  buildDocStatuses,
  buildStructured,
  buildCheckSummary,
} from '@/lib/integrations/hubspot-browser/drive-check'
import { buildExpectedFiles } from '@/lib/integrations/hubspot-browser/expected-files'
import { log } from '@/lib/logger'

type Params = { params: Promise<{ id: string }> }

export async function POST(req: NextRequest, { params }: Params) {
  if (!(await isAuthenticated()) && !isCronRequest(req)) return unauthorizedResponse()

  const { id } = await params

  const deal = await getDealById(id)
  if (!deal) return NextResponse.json({ error: 'Deal not found' }, { status: 404 })

  if (!deal.hubspotScreenshot) {
    return NextResponse.json(
      { error: 'No saved screenshot for this deal — run a full check first', code: 'NO_SCREENSHOT' },
      { status: 422 }
    )
  }

  const { expectedFiles, classifiedDocs } = buildExpectedFiles(deal)

  if (expectedFiles.length === 0) {
    return NextResponse.json(
      { error: 'No Drive files found — sync Drive first', code: 'NO_DRIVE_FILES' },
      { status: 422 }
    )
  }

  try {
    log.info('hubspot-reanalyze: starting vision-only analysis', { hubspotId: id, expectedFiles })
    const t = Date.now()

    const visionResult = await runVisionAnalysis(deal.hubspotScreenshot, expectedFiles)

    log.info('hubspot-reanalyze: vision complete', {
      hubspotId: id, ms: Date.now() - t, filesLinked: visionResult.filesLinked,
    })

    const docStatuses = classifiedDocs
      ? buildDocStatuses(classifiedDocs, visionResult.linkedFiles)
      : undefined
    const structured = docStatuses ? buildStructured(docStatuses) : undefined
    const summary = structured ? buildCheckSummary(structured) : undefined

    const checkData = {
      checked: true,
      filesLinked: visionResult.filesLinked,
      linkedFiles: visionResult.linkedFiles,
      missingFiles: visionResult.missingFiles,
      confidence: visionResult.confidence,
      findings: visionResult.findings,
      sessionExpired: false,
      checkedAt: new Date().toISOString(),
      detectionMethod: 'vision' as const,
      docStatuses: docStatuses ?? null,
      structured,
      summary,
    }

    // Preserve the existing screenshot — we're only updating the analysis result
    await updateDealHubspotCheck(id, checkData, deal.hubspotScreenshot, docStatuses)

    log.info('hubspot-reanalyze: persisted', { hubspotId: id })
    return NextResponse.json(checkData)
  } catch (err) {
    log.error('hubspot-reanalyze: failed', {
      hubspotId: id,
      err: err instanceof Error ? { name: err.name, message: err.message } : err,
    })
    return NextResponse.json(
      { error: err instanceof Error ? err.message : 'Reanalysis failed' },
      { status: 500 }
    )
  }
}
