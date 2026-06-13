// POST /api/deals/[id]/drive/hubspot-check
//
// Screenshots the HubSpot deal page and uses Claude Vision to verify
// that the specified Drive files appear in HubSpot's Google Drive sidebar.
//
// Request body:
//   { expectedFiles: string[] }  — file names to look for in the sidebar
//                                  defaults to all classified required docs if omitted
//
// Response:
//   HubSpotDriveCheckResult (see src/lib/integrations/hubspot-browser/drive-check.ts)

import { NextRequest, NextResponse } from 'next/server'
import { isAuthedOrAgent, unauthorizedResponse } from '@/lib/auth/require-session'
import { getDealById, updateDealHubspotCheck } from '@/lib/db/deals'
import {
  checkHubSpotDriveAttachments,
  buildDocStatuses,
  buildStructured,
  buildCheckSummary,
} from '@/lib/integrations/hubspot-browser/drive-check'
import { buildExpectedFiles } from '@/lib/integrations/hubspot-browser/expected-files'
import { log } from '@/lib/logger'

// Browser automation (Playwright screenshot + Claude Vision) is slow — allow up to 60s.
// Set via route segment config instead of vercel.json `functions`, which doesn't reliably
// match src/app App Router paths. Memory uses the plan default (raise via Pro plan if needed).
export const maxDuration = 60

type Params = { params: Promise<{ id: string }> }

export async function POST(req: NextRequest, { params }: Params) {
  if (!(await isAuthedOrAgent(req))) return unauthorizedResponse()

  const { id } = await params

  const deal = await getDealById(id)
  if (!deal) {
    return NextResponse.json({ error: 'Deal not found' }, { status: 404 })
  }

  let expectedFiles: string[]
  let classifiedDocs: ReturnType<typeof buildExpectedFiles>['classifiedDocs']
  try {
    const body = await req.json() as { expectedFiles?: string[] }
    if (Array.isArray(body.expectedFiles) && body.expectedFiles.length > 0) {
      expectedFiles = body.expectedFiles
      classifiedDocs = null
    } else {
      ;({ expectedFiles, classifiedDocs } = buildExpectedFiles(deal))
    }
  } catch {
    return NextResponse.json({ error: 'Invalid request body' }, { status: 400 })
  }

  if (expectedFiles.length === 0) {
    return NextResponse.json({
      error: 'No Drive files found — sync Drive first or specify files manually',
    }, { status: 422 })
  }

  try {
    const result = await checkHubSpotDriveAttachments(id, expectedFiles)

    if (result.checked) {
      const docStatuses = classifiedDocs
        ? buildDocStatuses(classifiedDocs, result.linkedFiles)
        : undefined

      const structured = docStatuses ? buildStructured(docStatuses) : undefined
      const summary = structured ? buildCheckSummary(structured) : undefined

      log.info('hubspot-check step 3/3: persisting to DB', {
        hubspotId: id, hasScreenshot: !!result.screenshotBase64, docTypes: docStatuses?.map(d => d.type),
      })
      const { screenshotBase64, ...checkData } = result
      await updateDealHubspotCheck(
        id,
        { ...checkData, structured, summary },
        screenshotBase64,
        docStatuses,
      )
      log.info('hubspot-check step 3/3: persisted', { hubspotId: id })
    }

    log.info('hubspot-check: complete', {
      hubspotId: id, checked: result.checked, sessionExpired: result.sessionExpired,
      filesLinked: result.filesLinked,
    })
    return NextResponse.json(result)
  } catch (err) {
    log.error('hubspot-check: failed', {
      hubspotId: id,
      step: (err as { step?: string } | null)?.step ?? 'unknown',
      err: err instanceof Error ? { name: err.name, message: err.message } : err,
    })
    return NextResponse.json(
      { error: err instanceof Error ? err.message : 'Check failed' },
      { status: 500 }
    )
  }
}
