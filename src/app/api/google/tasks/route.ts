import { NextRequest, NextResponse } from 'next/server'
import { isAuthedOrAgent, isAgentRequest, unauthorizedResponse } from '@/lib/auth/require-session'
import {
  assertAgentWritesEnabled, agentWritesDisabledResponse,
  extractRequestMeta, getCorrelationId, getIdempotencyKey,
} from '@/lib/agent/guard'
import { isGoogleConfigured } from '@/lib/integrations/google/auth'
import { getTasks, createTask } from '@/lib/integrations/google/tasks'
import { logAgentAction } from '@/lib/db/agent-audit'

// GET /api/google/tasks?completed=1 — tasks on the default Google Tasks list (read-only).
export async function GET(req: NextRequest) {
  if (!(await isAuthedOrAgent(req))) return unauthorizedResponse()
  if (!isGoogleConfigured()) {
    return NextResponse.json({ error: 'Google not configured' }, { status: 400 })
  }
  const showCompleted = new URL(req.url).searchParams.get('completed') === '1'
  try {
    const tasks = await getTasks({ showCompleted })
    return NextResponse.json({ count: tasks.length, tasks })
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    return NextResponse.json({ error: message }, { status: 502 })
  }
}

// POST /api/google/tasks — create a task. Body: { title, notes?, due? } (due = YYYY-MM-DD or ISO).
export async function POST(req: NextRequest) {
  const isAgent = isAgentRequest(req)
  if (!(await isAuthedOrAgent(req))) return unauthorizedResponse()
  if (isAgent && !(await assertAgentWritesEnabled())) return agentWritesDisabledResponse()
  if (!isGoogleConfigured()) return NextResponse.json({ error: 'Google not configured' }, { status: 400 })

  const b = (await req.json().catch(() => ({}))) as Record<string, unknown>
  if (!b.title || typeof b.title !== 'string' || !b.title.trim()) {
    return NextResponse.json({ error: 'title is required' }, { status: 400 })
  }

  try {
    const task = await createTask({
      title: b.title.trim(),
      notes: typeof b.notes === 'string' ? b.notes.trim() || null : null,
      due: typeof b.due === 'string' ? b.due : null,
    })
    if (isAgent) {
      await logAgentAction({
        actor: 'hermes', action: 'create_google_task', target: task.id,
        route: req.nextUrl.pathname, method: 'POST',
        correlationId: getCorrelationId(req), idempotencyKey: getIdempotencyKey(req),
        requestMeta: extractRequestMeta(req), before: null, after: task,
      })
    }
    return NextResponse.json(task, { status: 201 })
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    return NextResponse.json({ error: message }, { status: 502 })
  }
}
