import { NextRequest, NextResponse } from 'next/server'
import { syncGmailSample, syncGmailFull } from '@/lib/integrations/google/sync'
import { isGoogleConfigured } from '@/lib/integrations/google/auth'
import { prisma } from '@/lib/db/client'
import { log } from '@/lib/logger'

function isAuthenticated(req: NextRequest): boolean {
  const cookieHeader = req.headers.get('cookie') ?? ''
  if (cookieHeader.includes('auth=')) return true
  const cronSecret = process.env.CRON_SECRET
  if (cronSecret && req.headers.get('authorization') === `Bearer ${cronSecret}`) return true
  const hermesToken = process.env.HERMES_TOKEN
  if (hermesToken && req.headers.get('authorization') === `Bearer ${hermesToken}`) return true
  return false
}

export async function GET(req: NextRequest) {
  if (!isAuthenticated(req)) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  if (!isGoogleConfigured()) {
    return NextResponse.json({ configured: false, message: 'Google credentials not configured' })
  }

  const source = await prisma.syncSource.findUnique({ where: { name: 'GOOGLE' } })
  const totalEmails = await prisma.activityEvent.count({ where: { source: 'GOOGLE', type: 'email' } })

  return NextResponse.json({
    configured: true,
    isActive: source?.isActive ?? false,
    lastSyncedAt: source?.lastSyncedAt ?? null,
    totalEmailsStored: totalEmails,
  })
}

// POST — trigger a Gmail sync.
// Body: { mode: 'sample' | 'full' }
// SECURITY: 'full' mode is blocked in the UI until Mo approves the sample.
export async function POST(req: NextRequest) {
  if (!isAuthenticated(req)) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  if (!isGoogleConfigured()) {
    return NextResponse.json({ error: 'Google credentials not configured — see scripts/google-auth.mjs' }, { status: 400 })
  }

  const body = await req.json().catch(() => ({}))
  const mode: 'sample' | 'full' = body.mode === 'full' ? 'full' : 'sample'

  log.info('google gmail sync triggered', { mode })

  try {
    const report = mode === 'full' ? await syncGmailFull() : await syncGmailSample()

    return NextResponse.json({
      ok: true,
      report: {
        mode: report.mode,
        since: report.since.toISOString(),
        until: report.until.toISOString(),
        messagesFetched: report.messagesFetched,
        messagesMatched: report.messagesMatched,
        messagesUnmatched: report.messagesUnmatched,
        matchRate: report.messagesFetched > 0
          ? `${Math.round((report.messagesMatched / report.messagesFetched) * 100)}%`
          : 'n/a',
        durationMs: report.durationMs,
      },
    })
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    log.error('google gmail sync failed', { mode, error: message })
    return NextResponse.json({ ok: false, error: message }, { status: 500 })
  }
}
