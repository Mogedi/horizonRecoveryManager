// POST /api/deals/[id]/drive/hubspot-check/stream
//
// SSE variant of /hubspot-check for the two-phase UI.
// Streams two events in sequence:
//
//   { type: 'verdict',    ...HubSpotDriveVerdictEvent }  — ~5s  DOM fast path
//   { type: 'screenshot', base64: string }               — ~25s after humanize+capture
//   { type: 'error',      message: string }              — on failure
//
// Phase 1 (verdict): persisted to DB immediately with screenshotBase64=null.
// Phase 2 (screenshot): DB updated with the captured screenshot.
//
// The existing POST /hubspot-check (JSON response) remains unchanged for bulk checks.

import { NextRequest } from 'next/server'
import { isAuthenticated, isCronRequest, unauthorizedResponse } from '@/lib/auth/require-session'
import { getDealById, updateDealHubspotCheck } from '@/lib/db/deals'
import {
  checkHubSpotDriveAttachments,
  buildDocStatuses,
  buildStructured,
  buildCheckSummary,
  type HubSpotDriveCheckResult,
  type HubSpotDriveVerdictEvent,
} from '@/lib/integrations/hubspot-browser/drive-check'
import { buildExpectedFiles } from '@/lib/integrations/hubspot-browser/expected-files'
import { log } from '@/lib/logger'

type Params = { params: Promise<{ id: string }> }

const encoder = new TextEncoder()
function sse(data: object): Uint8Array {
  return encoder.encode(`data: ${JSON.stringify(data)}\n\n`)
}

export async function POST(req: NextRequest, { params }: Params) {
  if (!(await isAuthenticated()) && !isCronRequest(req)) return unauthorizedResponse()

  const { id } = await params

  const deal = await getDealById(id)
  if (!deal) return new Response('Deal not found', { status: 404 })

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
    return new Response('Invalid request body', { status: 400 })
  }

  if (expectedFiles.length === 0) {
    return new Response('No Drive files found — sync Drive first or specify files manually', { status: 422 })
  }

  // Build docStatuses + structured + summary from a check result.
  // Called separately for Phase 1 (verdict) and Phase 2 (final) because
  // vision may find more files than DOM — each write uses its own linkedFiles.
  function buildCheckData(result: Pick<HubSpotDriveCheckResult, 'linkedFiles'>) {
    if (!classifiedDocs) return { docStatuses: undefined, structured: undefined, summary: undefined }
    const docStatuses = buildDocStatuses(classifiedDocs, result.linkedFiles)
    const structured = buildStructured(docStatuses)
    const summary = buildCheckSummary(structured)
    return { docStatuses, structured, summary }
  }

  const stream = new TransformStream<Uint8Array, Uint8Array>()
  const writer = stream.writable.getWriter()

  ;(async () => {
    try {
      let verdictSent = false

      const result = await checkHubSpotDriveAttachments(
        id,
        expectedFiles,
        async (verdict: HubSpotDriveVerdictEvent) => {
          verdictSent = true
          const { docStatuses, structured, summary } = buildCheckData(verdict)
          await writer.write(sse({ type: 'verdict', ...verdict, docStatuses: docStatuses ?? null }))
          log.info('hubspot-check/stream: verdict sent', {
            hubspotId: id, filesLinked: verdict.filesLinked, sessionExpired: verdict.sessionExpired,
            docStatuses: docStatuses?.map(d => `${d.type}:${d.linked}`),
          })
          if (verdict.checked) {
            const { screenshotBase64: _, ...checkData } = verdict
            await updateDealHubspotCheck(id, { ...checkData, structured, summary }, null, docStatuses)
          }
        },
      )

      if (!verdictSent) {
        const { screenshotBase64: _, ...checkData } = result
        await writer.write(sse({ type: 'verdict', ...checkData, screenshotBase64: null }))
        log.info('hubspot-check/stream: fallback verdict sent (not configured)', { hubspotId: id })
      }

      if (result.screenshotBase64) {
        await writer.write(sse({ type: 'screenshot', base64: result.screenshotBase64 }))
        log.info('hubspot-check/stream: screenshot sent', { hubspotId: id })
        const { screenshotBase64, ...checkData } = result
        const { docStatuses, structured, summary } = buildCheckData(result)
        await updateDealHubspotCheck(id, { ...checkData, structured, summary }, screenshotBase64, docStatuses)
      }

      log.info('hubspot-check/stream: complete', {
        hubspotId: id, filesLinked: result.filesLinked, checked: result.checked,
      })
    } catch (err) {
      log.error('hubspot-check/stream: failed', {
        hubspotId: id,
        err: err instanceof Error ? { name: err.name, message: err.message } : err,
      })
      await writer.write(sse({
        type: 'error',
        message: err instanceof Error ? err.message : 'Check failed',
      }))
    } finally {
      await writer.close()
    }
  })()

  return new Response(stream.readable, {
    headers: {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      Connection: 'keep-alive',
    },
  })
}
