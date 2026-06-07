import { NextRequest, NextResponse } from 'next/server'
import { runLayer1Sync } from '@/lib/sync/layer1'

// Called by Vercel Cron (see vercel.json) and by the manual sync button in the dashboard.
// Cron sends a POST with no body. Manual button sends POST with optional { force: true }.
export async function POST(req: NextRequest) {
  // Verify cron secret or dashboard session — Vercel Cron sets this header automatically.
  const cronSecret = req.headers.get('x-vercel-cron-signature')
  const dashboardToken = req.headers.get('x-dashboard-token')

  const isFromCron = cronSecret !== null
  const isFromDashboard = dashboardToken === process.env.DASHBOARD_PASSWORD

  if (!isFromCron && !isFromDashboard) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  let force = false
  try {
    const body = await req.json().catch(() => ({}))
    force = body?.force === true
  } catch {
    // no body is fine
  }

  try {
    const result = await runLayer1Sync(force)
    console.log(`[layer1] ${result.mode} sync: ${result.dealsSynced} deals, ${result.apiCallsMade} API calls`)
    return NextResponse.json(result)
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    console.error('[layer1] sync failed:', message)
    return NextResponse.json({ error: message }, { status: 500 })
  }
}
