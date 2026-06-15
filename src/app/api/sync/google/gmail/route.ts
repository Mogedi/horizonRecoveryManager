import { NextRequest, NextResponse } from 'next/server'
import { syncGmailSample, syncGmailFull, syncGmailBackfill } from '@/lib/integrations/google/sync'
import { isGoogleConfigured } from '@/lib/integrations/google/auth'
import { prisma } from '@/lib/db/client'
import { log } from '@/lib/logger'
import { isAuthedOrAgent, unauthorizedResponse } from '@/lib/auth/require-session'

export async function GET(req: NextRequest) {
  if (!(await isAuthedOrAgent(req))) return unauthorizedResponse()

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
  if (!(await isAuthedOrAgent(req))) return unauthorizedResponse()

  if (!isGoogleConfigured()) {
    return NextResponse.json({ error: 'Google credentials not configured — see scripts/google-auth.mjs' }, { status: 400 })
  }

  const body = await req.json().catch(() => ({}))
  const mode: 'sample' | 'full' | 'backfill' =
    body.mode === 'backfill' ? 'backfill' : body.mode === 'full' ? 'full' : 'sample'

  log.info('google gmail sync triggered', { mode })

  try {
    const report =
      mode === 'backfill' ? await syncGmailBackfill() : mode === 'full' ? await syncGmailFull() : await syncGmailSample()

    return NextResponse.json({
      ok: true,
      report: {
        mode: report.mode,
        since: report.since.toISOString(),
        until: report.until.toISOString(),
        messagesFetched: report.messagesFetched,
        messagesMatched: report.messagesMatched,
        messagesUnmatched: report.messagesUnmatched,
        bodiesFetched: report.bodiesFetched,
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
