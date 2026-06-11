import { NextRequest, NextResponse } from 'next/server'
import { isAuthedOrAgent, isAgentRequest, unauthorizedResponse } from '@/lib/auth/require-session'
import {
  assertAgentWritesEnabled,
  agentWritesDisabledResponse,
  extractRequestMeta,
  getCorrelationId,
  getIdempotencyKey,
} from '@/lib/agent/guard'
import { completeTask, deleteTask, getTaskById } from '@/lib/db/tasks'
import { logAgentAction } from '@/lib/db/agent-audit'

export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const isAgent = isAgentRequest(req)
  if (!(await isAuthedOrAgent(req))) return unauthorizedResponse()
  if (isAgent && !(await assertAgentWritesEnabled())) return agentWritesDisabledResponse()

  const { id } = await params
  const taskId = parseInt(id, 10)
  if (isNaN(taskId)) {
    return NextResponse.json({ error: 'Invalid id' }, { status: 400 })
  }

  const before = isAgent ? await getTaskById(taskId) : null

  try {
    const task = await completeTask(taskId)
    if (isAgent) {
      await logAgentAction({
        actor: 'hermes',
        action: 'complete_task',
        target: String(taskId),
        route: req.nextUrl.pathname,
        method: 'PATCH',
        correlationId: getCorrelationId(req),
        idempotencyKey: getIdempotencyKey(req),
        requestMeta: extractRequestMeta(req),
        before,
        after: task,
      })
    }
    return NextResponse.json(task)
  } catch {
    return NextResponse.json({ error: 'Task not found' }, { status: 404 })
  }
}

export async function DELETE(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const isAgent = isAgentRequest(req)
  if (!(await isAuthedOrAgent(req))) return unauthorizedResponse()
  if (isAgent && !(await assertAgentWritesEnabled())) return agentWritesDisabledResponse()

  const { id } = await params
  const taskId = parseInt(id, 10)
  if (isNaN(taskId)) {
    return NextResponse.json({ error: 'Invalid id' }, { status: 400 })
  }

  const before = isAgent ? await getTaskById(taskId) : null

  try {
    await deleteTask(taskId)
    if (isAgent) {
      await logAgentAction({
        actor: 'hermes',
        action: 'delete_task',
        target: String(taskId),
        route: req.nextUrl.pathname,
        method: 'DELETE',
        correlationId: getCorrelationId(req),
        idempotencyKey: getIdempotencyKey(req),
        requestMeta: extractRequestMeta(req),
        before,
        after: null,
      })
    }
    return new NextResponse(null, { status: 204 })
  } catch {
    return NextResponse.json({ error: 'Task not found' }, { status: 404 })
  }
}
