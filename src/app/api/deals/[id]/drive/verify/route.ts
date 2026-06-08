// AI document verification endpoint for a specific deal.
//
// GET  — returns the cached verification report from DB (if any).
// POST — downloads found Drive docs, runs Claude verification, stores result.
//
// Body (optional): { overrides: { [docType]: fileId } }
// Overrides let Mo manually assign a file to a doc type when auto-classification misses it.

import { NextRequest, NextResponse } from 'next/server'
import { getDealById, getDealContactNames, updateDealDocVerification } from '@/lib/db/deals'
import { isGoogleConfigured } from '@/lib/integrations/google/auth'
import { isAuthenticated, isCronRequest, unauthorizedResponse } from '@/lib/auth/require-session'
import { verifyAllFiles } from '@/lib/ai/doc-verify'
import type { DriveFileEntry } from '@/lib/integrations/google/drive-index'
import { log } from '@/lib/logger'

type Params = { params: Promise<{ id: string }> }

export async function GET(req: NextRequest, { params }: Params) {
  if (!(await isAuthenticated()) && !isCronRequest(req)) return unauthorizedResponse()

  const { id } = await params
  try {
    const deal = await getDealById(id)
    if (!deal) return NextResponse.json({ error: 'Deal not found' }, { status: 404 })

    return NextResponse.json({
      report: deal.docVerification ?? null,
      verifiedAt: deal.docVerificationAt?.toISOString() ?? null,
    })
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    log.error('doc verify GET failed', { dealId: id, error: message })
    return NextResponse.json({ error: message }, { status: 500 })
  }
}

export async function POST(req: NextRequest, { params }: Params) {
  if (!(await isAuthenticated()) && !isCronRequest(req)) return unauthorizedResponse()

  if (!isGoogleConfigured()) {
    return NextResponse.json({ error: 'Google not configured' }, { status: 400 })
  }

  const { id } = await params
  try {
    const deal = await getDealById(id)
    if (!deal) return NextResponse.json({ error: 'Deal not found' }, { status: 404 })

    if (!deal.driveFilesCache) {
      return NextResponse.json({ error: 'No Drive files cached for this deal. Open the Drive section first to load files.' }, { status: 400 })
    }

    const files = deal.driveFilesCache as DriveFileEntry[]

    if (files.length === 0) {
      return NextResponse.json({ error: 'Drive folder is empty.' }, { status: 400 })
    }

    log.info('doc verify start', { dealId: id, fileCount: files.length })

    const contactNames = await getDealContactNames(id)
    const report = await verifyAllFiles(files, {
      address: deal.propertyAddress ?? null,
      parcelId: deal.parcelId ?? null,
      taxSaleDate: deal.taxSaleDate?.toISOString().slice(0, 10) ?? null,
      contactNames,
    })

    await updateDealDocVerification(id, report)
    log.info('doc verify complete', { dealId: id, overallMatch: report.overallMatch })

    return NextResponse.json(report)
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    log.error('doc verify failed', { dealId: id, error: message })
    return NextResponse.json({ error: message }, { status: 500 })
  }
}
