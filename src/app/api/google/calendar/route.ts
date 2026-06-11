import { NextRequest, NextResponse } from 'next/server'
import { isAuthedOrAgent, unauthorizedResponse } from '@/lib/auth/require-session'
import { isGoogleConfigured } from '@/lib/integrations/google/auth'
import { getUpcomingEvents } from '@/lib/integrations/google/calendar'

// GET /api/google/calendar?days=14 — upcoming events on the primary calendar (read-only).
export async function GET(req: NextRequest) {
  if (!(await isAuthedOrAgent(req))) return unauthorizedResponse()
  if (!isGoogleConfigured()) {
    return NextResponse.json({ error: 'Google not configured' }, { status: 400 })
  }
  const days = Math.min(Math.max(Number(new URL(req.url).searchParams.get('days')) || 14, 1), 90)
  try {
    const events = await getUpcomingEvents({ days })
    return NextResponse.json({ days, count: events.length, events })
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    return NextResponse.json({ error: message }, { status: 502 })
  }
}
