import { NextRequest, NextResponse } from 'next/server'
import { cookies } from 'next/headers'
import { runLayer1Sync } from '@/lib/sync/layer1'

// Called by Vercel Cron (see vercel.json) and by the manual sync button in the dashboard.
// Vercel Cron sends Authorization: Bearer <CRON_SECRET>. Browser sends horizon_auth cookie.
export async function POST(req: NextRequest) {
  const authHeader = req.headers.get('authorization')
  const cronSecret = process.env.CRON_SECRET
  const isFromCron = !!cronSecret && authHeader === `Bearer ${cronSecret}`

  const cookieStore = await cookies()
  const isFromSession = cookieStore.get('horizon_auth')?.value === '1'

  if (!isFromCron && !isFromSession) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
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
