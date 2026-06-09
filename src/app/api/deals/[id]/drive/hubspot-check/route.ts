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
//
// This is intentionally POST-only (not cached) — each call takes a fresh screenshot.
// The result is returned to the client for display; it is NOT persisted to DB
// since HubSpot sidebar state can change at any time.

import { NextRequest, NextResponse } from 'next/server'
import { isAuthenticated, isCronRequest, unauthorizedResponse } from '@/lib/auth/require-session'
import { getDealById, updateDealHubspotCheck } from '@/lib/db/deals'
import { checkHubSpotDriveAttachments } from '@/lib/integrations/hubspot-browser/drive-check'
import { classifyFiles } from '@/lib/integrations/google/doc-classifier'
import { log } from '@/lib/logger'

type Params = { params: Promise<{ id: string }> }

export async function POST(req: NextRequest, { params }: Params) {
  if (!(await isAuthenticated()) && !isCronRequest(req)) return unauthorizedResponse()

  const { id } = await params

  const deal = await getDealById(id)
  if (!deal) {
    return NextResponse.json({ error: 'Deal not found' }, { status: 404 })
  }

  // Determine which files to look for — use request body if provided,
  // otherwise fall back to the classified required docs from the Drive cache.
  let expectedFiles: string[]
  try {
    const body = await req.json() as { expectedFiles?: string[] }
    if (Array.isArray(body.expectedFiles) && body.expectedFiles.length > 0) {
      expectedFiles = body.expectedFiles
    } else {
      const cached = JSON.parse(JSON.stringify(deal.driveFilesCache ?? [])) as import('@/lib/integrations/google/drive-index').DriveFileEntry[]
      const checklist = classifyFiles(cached)
      expectedFiles = checklist.required
        .filter(d => d.found && d.file)
        .map(d => d.file!.name)
    }
  } catch {
    return NextResponse.json({ error: 'Invalid request body' }, { status: 400 })
  }

  if (expectedFiles.length === 0) {
    return NextResponse.json({
      error: 'No expected files specified and no classified docs found in Drive cache',
    }, { status: 422 })
  }

  try {
    log.info('hubspot-check: starting', { hubspotId: id, expectedFiles })
    const result = await checkHubSpotDriveAttachments(id, expectedFiles)

    // Persist: store result (without screenshot) and screenshot separately
    if (result.checked) {
      const { screenshotBase64, ...checkWithoutScreenshot } = result
      await updateDealHubspotCheck(id, checkWithoutScreenshot, screenshotBase64)
    }

    return NextResponse.json(result)
  } catch (err) {
    log.error('hubspot-check: failed', { hubspotId: id, err })
    return NextResponse.json(
      { error: err instanceof Error ? err.message : 'Check failed' },
      { status: 500 }
    )
  }
}
