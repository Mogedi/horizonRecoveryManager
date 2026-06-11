import { NextRequest, NextResponse } from 'next/server'
import { cookies } from 'next/headers'
import { syncJustCallSample, syncJustCallFull } from '@/lib/integrations/justcall/sync'
import { prisma } from '@/lib/db/client'
import { log } from '@/lib/logger'

// Ensure sync_sources table has the three canonical sources seeded.
async function ensureSyncSourcesSeeded(): Promise<void> {
  const sources = [
    { name: 'HUBSPOT', isActive: true },
    { name: 'JUSTCALL', isActive: false },
    { name: 'GOOGLE', isActive: false },
  ]
  for (const s of sources) {
    await prisma.syncSource.upsert({
      where: { name: s.name },
      create: { name: s.name, isActive: s.isActive },
      update: {}, // don't overwrite isActive if already set
    })
  }
}

function isAuthenticated(req: NextRequest): boolean {
  // Cookie auth (browser requests)
  const cookieHeader = req.headers.get('cookie') ?? ''
  if (cookieHeader.includes('auth=')) return true

  // Cron token auth (server-side requests)
  const cronSecret = process.env.CRON_SECRET
  if (cronSecret) {
    const auth = req.headers.get('authorization')
    if (auth === `Bearer ${cronSecret}`) return true
  }

  // Hermes agent token (server-side requests from the VPS scheduler)
  const hermesToken = process.env.HERMES_TOKEN
  if (hermesToken && req.headers.get('authorization') === `Bearer ${hermesToken}`) return true

  return false
}

// GET — returns current JustCall sync status
export async function GET(req: NextRequest) {
  if (!isAuthenticated(req)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  await ensureSyncSourcesSeeded()

  const source = await prisma.syncSource.findUnique({ where: { name: 'JUSTCALL' } })
  const recentEvents = await prisma.activityEvent.count({ where: { source: 'JUSTCALL' } })

  return NextResponse.json({
    isActive: source?.isActive ?? false,
    lastSyncedAt: source?.lastSyncedAt ?? null,
    totalEventsStored: recentEvents,
  })
}

// POST — trigger a JustCall sync
// Body: { mode: 'sample' } — 'full' mode is blocked until Mo approves the sample
export async function POST(req: NextRequest) {
  if (!isAuthenticated(req)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  await ensureSyncSourcesSeeded()

  let mode: 'sample' | 'full' = 'sample'
  try {
    const body = await req.json().catch(() => ({}))
    if (body.mode === 'full') mode = 'full'
  } catch {
    // Default to sample
  }

  log.info('justcall sync triggered', { mode })

  try {
    const report = mode === 'full'
      ? await syncJustCallFull()
      : await syncJustCallSample()

    return NextResponse.json({
      ok: true,
      report: {
        mode: report.mode,
        since: report.since.toISOString(),
        until: report.until.toISOString(),
        callsFetched: report.callsFetched,
        callsMatched: report.callsMatched,
        callsUnmatched: report.callsUnmatched,
        callsSkipped: report.callsSkipped,
        dealsUpdated: report.dealsUpdated,
        matchRate: report.callsFetched > 0
          ? `${Math.round((report.callsMatched / report.callsFetched) * 100)}%`
          : 'n/a',
        durationMs: report.durationMs,
      },
    })
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    log.error('justcall sync failed', { mode, error: message })
    return NextResponse.json({ ok: false, error: message }, { status: 500 })
  }
}
