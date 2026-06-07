import { NextRequest, NextResponse } from 'next/server'
import { isAuthenticated, isCronRequest, unauthorizedResponse } from '@/lib/auth/require-session'
import { runLayer1Sync } from '@/lib/sync/layer1'

// Called by Vercel Cron (see vercel.json) and by the manual sync button in the dashboard.
export async function POST(req: NextRequest) {
  if (!isCronRequest(req) && !(await isAuthenticated())) {
    return unauthorizedResponse()
  }

  const force = req.nextUrl.searchParams.get('force') === 'true'

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
