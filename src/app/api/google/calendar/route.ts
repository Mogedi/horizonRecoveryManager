import { NextRequest, NextResponse } from 'next/server'
import { isAuthedOrAgent, isAgentRequest, unauthorizedResponse } from '@/lib/auth/require-session'
import {
  assertAgentWritesEnabled, agentWritesDisabledResponse,
  extractRequestMeta, getCorrelationId, getIdempotencyKey,
} from '@/lib/agent/guard'
import { isGoogleConfigured } from '@/lib/integrations/google/auth'
import { getUpcomingEvents, createEvent } from '@/lib/integrations/google/calendar'
import { logAgentAction } from '@/lib/db/agent-audit'

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

// POST /api/google/calendar — create an event.
// Body: { title, start, end?, description?, location?, attendees?[], allDay?, durationMinutes? }
export async function POST(req: NextRequest) {
  const isAgent = isAgentRequest(req)
  if (!(await isAuthedOrAgent(req))) return unauthorizedResponse()
  if (isAgent && !(await assertAgentWritesEnabled())) return agentWritesDisabledResponse()
  if (!isGoogleConfigured()) return NextResponse.json({ error: 'Google not configured' }, { status: 400 })

  const b = (await req.json().catch(() => ({}))) as Record<string, unknown>
  if (!b.title || typeof b.title !== 'string' || !b.title.trim()) {
    return NextResponse.json({ error: 'title is required' }, { status: 400 })
  }
  if (!b.start || typeof b.start !== 'string') {
    return NextResponse.json({ error: 'start is required (ISO timestamp or YYYY-MM-DD)' }, { status: 400 })
  }

  try {
    const event = await createEvent({
      title: b.title.trim(),
      start: b.start,
      end: typeof b.end === 'string' ? b.end : undefined,
      description: typeof b.description === 'string' ? b.description : undefined,
      location: typeof b.location === 'string' ? b.location : undefined,
      attendees: Array.isArray(b.attendees) ? (b.attendees as string[]).filter((x) => typeof x === 'string') : undefined,
      allDay: b.allDay === true,
      durationMinutes: typeof b.durationMinutes === 'number' ? b.durationMinutes : undefined,
    })
    if (isAgent) {
      await logAgentAction({
        actor: 'hermes', action: 'create_calendar_event', target: event.id,
        route: req.nextUrl.pathname, method: 'POST',
        correlationId: getCorrelationId(req), idempotencyKey: getIdempotencyKey(req),
        requestMeta: extractRequestMeta(req), before: null, after: event,
      })
    }
    return NextResponse.json(event, { status: 201 })
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    return NextResponse.json({ error: message }, { status: 502 })
  }
}
