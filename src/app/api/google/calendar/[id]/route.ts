import { NextRequest, NextResponse } from 'next/server'
import { isAuthedOrAgent, isAgentRequest, unauthorizedResponse } from '@/lib/auth/require-session'
import {
  assertAgentWritesEnabled, agentWritesDisabledResponse,
  extractRequestMeta, getCorrelationId, getIdempotencyKey,
} from '@/lib/agent/guard'
import { isGoogleConfigured } from '@/lib/integrations/google/auth'
import { getEvent, updateEvent, deleteEvent } from '@/lib/integrations/google/calendar'
import { logAgentAction } from '@/lib/db/agent-audit'

type Params = { params: Promise<{ id: string }> }

// GET /api/google/calendar/[id] — full detail for one event.
export async function GET(req: NextRequest, { params }: Params) {
  if (!(await isAuthedOrAgent(req))) return unauthorizedResponse()
  if (!isGoogleConfigured()) return NextResponse.json({ error: 'Google not configured' }, { status: 400 })
  const { id } = await params
  try {
    return NextResponse.json(await getEvent(id))
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : String(err) }, { status: 502 })
  }
}

// PATCH /api/google/calendar/[id] — update fields. Body: any of { title, start, end, description, location, attendees, allDay }.
export async function PATCH(req: NextRequest, { params }: Params) {
  const isAgent = isAgentRequest(req)
  if (!(await isAuthedOrAgent(req))) return unauthorizedResponse()
  if (isAgent && !(await assertAgentWritesEnabled())) return agentWritesDisabledResponse()
  if (!isGoogleConfigured()) return NextResponse.json({ error: 'Google not configured' }, { status: 400 })

  const { id } = await params
  const b = (await req.json().catch(() => ({}))) as Record<string, unknown>
  try {
    const before = await getEvent(id).catch(() => null)
    const event = await updateEvent(id, {
      title: typeof b.title === 'string' ? b.title : undefined,
      start: typeof b.start === 'string' ? b.start : undefined,
      end: typeof b.end === 'string' ? b.end : undefined,
      description: typeof b.description === 'string' ? b.description : undefined,
      location: typeof b.location === 'string' ? b.location : undefined,
      attendees: Array.isArray(b.attendees) ? (b.attendees as string[]).filter((x) => typeof x === 'string') : undefined,
      allDay: b.allDay === true,
    })
    if (isAgent) {
      await logAgentAction({
        actor: 'hermes', action: 'update_calendar_event', target: id,
        route: req.nextUrl.pathname, method: 'PATCH',
        correlationId: getCorrelationId(req), idempotencyKey: getIdempotencyKey(req),
        requestMeta: extractRequestMeta(req), before, after: event,
      })
    }
    return NextResponse.json(event)
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : String(err) }, { status: 502 })
  }
}

// DELETE /api/google/calendar/[id] — remove the event (cancels guest invites).
export async function DELETE(req: NextRequest, { params }: Params) {
  const isAgent = isAgentRequest(req)
  if (!(await isAuthedOrAgent(req))) return unauthorizedResponse()
  if (isAgent && !(await assertAgentWritesEnabled())) return agentWritesDisabledResponse()
  if (!isGoogleConfigured()) return NextResponse.json({ error: 'Google not configured' }, { status: 400 })

  const { id } = await params
  try {
    const before = await getEvent(id).catch(() => null)
    await deleteEvent(id)
    if (isAgent) {
      await logAgentAction({
        actor: 'hermes', action: 'delete_calendar_event', target: id,
        route: req.nextUrl.pathname, method: 'DELETE',
        correlationId: getCorrelationId(req), idempotencyKey: getIdempotencyKey(req),
        requestMeta: extractRequestMeta(req), before, after: null,
      })
    }
    return NextResponse.json({ ok: true, removed: id })
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : String(err) }, { status: 502 })
  }
}
