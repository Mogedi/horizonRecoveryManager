// Bulk document verification — processes one deal per call to stay within Vercel timeouts.
//
// GET  — returns list of deal IDs that have Drive files but no verification yet
// POST — verifies one specific deal (body: { hubspotId })
//        client calls this repeatedly until the GET list is empty

import { NextRequest, NextResponse } from 'next/server'
import { getDealsNeedingVerification, updateDealDocVerification } from '@/lib/db/deals'
import { isAuthenticated, unauthorizedResponse } from '@/lib/auth/require-session'
import { isGoogleConfigured } from '@/lib/integrations/google/auth'
import { verifyAllFiles } from '@/lib/ai/doc-verify'
import type { DriveFileEntry } from '@/lib/integrations/google/drive-index'
import { log } from '@/lib/logger'

export async function GET(req: NextRequest) {
  if (!await isAuthenticated()) return unauthorizedResponse()

  const pending = await getDealsNeedingVerification()
  return NextResponse.json({
    count: pending.length,
    deals: pending.map(d => ({ hubspotId: d.hubspotId, name: d.name })),
  })
}

export async function POST(req: NextRequest) {
  if (!await isAuthenticated()) return unauthorizedResponse()
  if (!isGoogleConfigured()) return NextResponse.json({ error: 'Google not configured' }, { status: 400 })

  const { hubspotId } = await req.json() as { hubspotId: string }
  if (!hubspotId) return NextResponse.json({ error: 'hubspotId required' }, { status: 400 })

  // Re-fetch this specific deal from the pending list so we have fresh data
  const pending = await getDealsNeedingVerification()
  const deal = pending.find(d => d.hubspotId === hubspotId)

  if (!deal) {
    return NextResponse.json({ skipped: true, reason: 'already verified or no Drive files' })
  }

  const files = deal.driveFilesCache as DriveFileEntry[]
  if (!files || files.length === 0) {
    return NextResponse.json({ skipped: true, reason: 'empty Drive cache' })
  }

  try {
    log.info('bulk verify: starting', { hubspotId, name: deal.name, fileCount: files.length })

    const report = await verifyAllFiles(files, {
      address: deal.propertyAddress ?? null,
      parcelId: deal.parcelId ?? null,
      taxSaleDate: deal.taxSaleDate?.toISOString().slice(0, 10) ?? null,
      contactNames: deal.contactNames,
    })

    await updateDealDocVerification(hubspotId, report)

    log.info('bulk verify: done', {
      hubspotId, name: deal.name,
      overallMatch: report.overallMatch,
      confidence: report.confidence,
    })

    return NextResponse.json({
      hubspotId,
      name: deal.name,
      overallMatch: report.overallMatch,
      confidence: report.confidence,
      summary: report.summary,
    })
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    log.error('bulk verify: failed', { hubspotId, error: message })
    return NextResponse.json({ error: message, hubspotId }, { status: 500 })
  }
}
