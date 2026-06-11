import { NextRequest, NextResponse } from 'next/server'
import { isAuthedOrAgent, isAgentRequest, unauthorizedResponse } from '@/lib/auth/require-session'
import {
  assertAgentWritesEnabled, agentWritesDisabledResponse,
  extractRequestMeta, getCorrelationId, getIdempotencyKey,
} from '@/lib/agent/guard'
import { isGoogleConfigured } from '@/lib/integrations/google/auth'
import { getTask, completeTask, updateTask, removeTask } from '@/lib/integrations/google/tasks'
import { logAgentAction } from '@/lib/db/agent-audit'

type Params = { params: Promise<{ id: string }> }

// PATCH /api/google/tasks/[id] — complete or edit a task.
//   { complete: true }                  → mark complete
//   { reopen: true }                    → reopen (status needsAction)
//   { title?, notes?, due? }            → edit fields
export async function PATCH(req: NextRequest, { params }: Params) {
  const isAgent = isAgentRequest(req)
  if (!(await isAuthedOrAgent(req))) return unauthorizedResponse()
  if (isAgent && !(await assertAgentWritesEnabled())) return agentWritesDisabledResponse()
  if (!isGoogleConfigured()) return NextResponse.json({ error: 'Google not configured' }, { status: 400 })

  const { id } = await params
  const b = (await req.json().catch(() => ({}))) as Record<string, unknown>
  const hasEdits = ['title', 'notes', 'due'].some((k) => typeof b[k] === 'string') || b.reopen === true

  try {
    const before = await getTask(id).catch(() => null)
    let task
    let action: 'complete_google_task' | 'update_google_task'
    if (hasEdits) {
      task = await updateTask(id, {
        title: typeof b.title === 'string' ? b.title : undefined,
        notes: typeof b.notes === 'string' ? b.notes : undefined,
        due: typeof b.due === 'string' ? b.due : undefined,
        status: b.reopen === true ? 'needsAction' : undefined,
      })
      action = 'update_google_task'
    } else {
      task = await completeTask(id)
      action = 'complete_google_task'
    }
    if (isAgent) {
      await logAgentAction({
        actor: 'hermes', action, target: id,
        route: req.nextUrl.pathname, method: 'PATCH',
        correlationId: getCorrelationId(req), idempotencyKey: getIdempotencyKey(req),
        requestMeta: extractRequestMeta(req), before, after: task,
      })
    }
    return NextResponse.json(task)
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    return NextResponse.json({ error: message }, { status: 502 })
  }
}

// DELETE /api/google/tasks/[id] — remove a task.
export async function DELETE(req: NextRequest, { params }: Params) {
  const isAgent = isAgentRequest(req)
  if (!(await isAuthedOrAgent(req))) return unauthorizedResponse()
  if (isAgent && !(await assertAgentWritesEnabled())) return agentWritesDisabledResponse()
  if (!isGoogleConfigured()) return NextResponse.json({ error: 'Google not configured' }, { status: 400 })

  const { id } = await params
  try {
    const before = await getTask(id).catch(() => null)
    await removeTask(id)
    if (isAgent) {
      await logAgentAction({
        actor: 'hermes', action: 'delete_google_task', target: id,
        route: req.nextUrl.pathname, method: 'DELETE',
        correlationId: getCorrelationId(req), idempotencyKey: getIdempotencyKey(req),
        requestMeta: extractRequestMeta(req), before, after: null,
      })
    }
    return NextResponse.json({ ok: true, removed: id })
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    return NextResponse.json({ error: message }, { status: 502 })
  }
}
