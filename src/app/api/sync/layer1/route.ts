import { NextRequest, NextResponse } from 'next/server'
import { isAuthenticated, isCronRequest, isAgentRequest, unauthorizedResponse } from '@/lib/auth/require-session'
import { runLayer1Sync } from '@/lib/sync/layer1'
import { log } from '@/lib/logger'

// Called by Vercel Cron (see vercel.json) and by the manual sync button in the dashboard.
export async function POST(req: NextRequest) {
  if (!isCronRequest(req) && !isAgentRequest(req) && !(await isAuthenticated())) {
    return unauthorizedResponse()
  }

  const force = req.nextUrl.searchParams.get('force') === 'true'
  const trigger = isCronRequest(req) ? 'cron' : 'manual'

  try {
    const result = await runLayer1Sync(force)
    log.info('layer1 sync complete', { trigger, force, ...result })
    return NextResponse.json(result)
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    log.error('layer1 sync failed', { trigger, force, error: message })
    return NextResponse.json({ error: message }, { status: 500 })
  }
}
