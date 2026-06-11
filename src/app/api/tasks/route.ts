import { NextRequest, NextResponse } from 'next/server'
import { isAuthenticated, isAuthedOrAgent, isAgentRequest, unauthorizedResponse } from '@/lib/auth/require-session'
import {
  assertAgentWritesEnabled,
  agentWritesDisabledResponse,
  extractRequestMeta,
  getCorrelationId,
  getIdempotencyKey,
} from '@/lib/agent/guard'
import { getOpenTasks, getRecentCompletedTasks, createTask, getTaskByIdempotencyKey } from '@/lib/db/tasks'
import { logAgentAction } from '@/lib/db/agent-audit'
import { TaskCategory } from '@prisma/client'

export async function GET() {
  if (!(await isAuthenticated())) return unauthorizedResponse()

  const [open, completed] = await Promise.all([getOpenTasks(), getRecentCompletedTasks(30)])
  return NextResponse.json({ open, completed })
}

export async function POST(req: NextRequest) {
  const isAgent = isAgentRequest(req)
  if (!(await isAuthedOrAgent(req))) return unauthorizedResponse()
  if (isAgent && !(await assertAgentWritesEnabled())) return agentWritesDisabledResponse()

  let body: unknown
  try {
    body = await req.json()
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 })
  }

  const b = body as Record<string, unknown>

  if (!b.title || typeof b.title !== 'string' || b.title.trim() === '') {
    return NextResponse.json({ error: 'title is required' }, { status: 400 })
  }
  if (!b.category || !Object.values(TaskCategory).includes(b.category as TaskCategory)) {
    return NextResponse.json({ error: 'valid category is required' }, { status: 400 })
  }

  // Idempotency — a repeat with the same key returns the existing task instead of duplicating.
  const idempotencyKey = getIdempotencyKey(req)
  if (idempotencyKey) {
    const existing = await getTaskByIdempotencyKey(idempotencyKey)
    if (existing) return NextResponse.json(existing, { status: 200 })
  }

  const task = await createTask({
    dealHubspotId: typeof b.dealHubspotId === 'string' ? b.dealHubspotId : null,
    title: (b.title as string).trim(),
    notes: typeof b.notes === 'string' ? b.notes.trim() || null : null,
    dueDate: typeof b.dueDate === 'string' ? new Date(b.dueDate) : null,
    category: b.category as TaskCategory,
    source: isAgent ? 'hermes' : 'manual',
    idempotencyKey,
  })

  if (isAgent) {
    await logAgentAction({
      actor: 'hermes',
      action: 'create_task',
      target: task.dealHubspotId ?? String(task.id),
      route: req.nextUrl.pathname,
      method: 'POST',
      correlationId: getCorrelationId(req),
      idempotencyKey,
      requestMeta: extractRequestMeta(req),
      before: null,
      after: task,
    })
  }

  return NextResponse.json(task, { status: 201 })
}
