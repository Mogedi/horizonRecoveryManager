// Indexes Google Drive folders → deals.
// GET — returns current indexing status (how many deals have a folder linked)
// POST — runs the indexing job

import { NextRequest, NextResponse } from 'next/server'
import { indexDriveFolders, getCasesFolderIds } from '@/lib/integrations/google/drive-index'
import { isGoogleConfigured } from '@/lib/integrations/google/auth'
import { isAuthenticated, isCronRequest, unauthorizedResponse } from '@/lib/auth/require-session'
import { prisma } from '@/lib/db/client'
import { log } from '@/lib/logger'

export async function GET(req: NextRequest) {
  if (!(await isAuthenticated()) && !isCronRequest(req)) return unauthorizedResponse()

  if (!isGoogleConfigured()) {
    return NextResponse.json({ configured: false })
  }

  const [total, indexed] = await Promise.all([
    prisma.deal.count(),
    prisma.deal.count({ where: { NOT: { driveFolderId: null } } }),
  ])

  return NextResponse.json({
    configured: true,
    casesFolderIds: getCasesFolderIds(),
    dealsTotal: total,
    dealsIndexed: indexed,
    dealsUnindexed: total - indexed,
    coveragePct: total > 0 ? Math.round((indexed / total) * 100) : 0,
  })
}

export async function POST(req: NextRequest) {
  if (!(await isAuthenticated()) && !isCronRequest(req)) return unauthorizedResponse()

  if (!isGoogleConfigured()) {
    return NextResponse.json({ error: 'Google credentials not configured' }, { status: 400 })
  }

  if (getCasesFolderIds().length === 0) {
    return NextResponse.json({ error: 'GOOGLE_DRIVE_CASES_FOLDER_IDS not set in .env.local' }, { status: 400 })
  }

  log.info('drive index triggered')

  try {
    const report = await indexDriveFolders()
    return NextResponse.json({ ok: true, report })
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    log.error('drive index failed', { error: message })
    return NextResponse.json({ ok: false, error: message }, { status: 500 })
  }
}
