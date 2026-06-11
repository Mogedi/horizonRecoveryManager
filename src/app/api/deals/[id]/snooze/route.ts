import { NextRequest, NextResponse } from 'next/server'
import { isAuthedOrAgent, isAgentRequest, unauthorizedResponse } from '@/lib/auth/require-session'
import {
  assertAgentWritesEnabled,
  agentWritesDisabledResponse,
  extractRequestMeta,
  getCorrelationId,
  getIdempotencyKey,
} from '@/lib/agent/guard'
import {
  createSnooze,
  removeActiveSnooze,
  getActiveSnooze,
  getSnoozeByIdempotencyKey,
  isValidSnoozeCategory,
} from '@/lib/db/snoozes'
import { logAgentAction } from '@/lib/db/agent-audit'
import { SnoozeCategory } from '@prisma/client'

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const isAgent = isAgentRequest(req)
  if (!(await isAuthedOrAgent(req))) return unauthorizedResponse()
  if (isAgent && !(await assertAgentWritesEnabled())) return agentWritesDisabledResponse()

  const { id } = await params
  let body: { category?: unknown; snoozeUntil?: unknown; freeformNote?: unknown }
  try {
    body = await req.json()
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 })
  }

  const { category, snoozeUntil, freeformNote } = body

  if (typeof category !== 'string' || !isValidSnoozeCategory(category)) {
    return NextResponse.json({ error: 'Invalid category' }, { status: 400 })
  }

  if (typeof snoozeUntil !== 'string') {
    return NextResponse.json({ error: 'snoozeUntil is required' }, { status: 400 })
  }
  const snoozeDate = new Date(snoozeUntil)
  if (isNaN(snoozeDate.getTime())) {
    return NextResponse.json({ error: 'Invalid date' }, { status: 400 })
  }
  if (snoozeDate <= new Date()) {
    return NextResponse.json({ error: 'Snooze date must be in the future' }, { status: 400 })
  }

  // Idempotency — a repeat with the same key returns the existing snooze instead of duplicating.
  const idempotencyKey = getIdempotencyKey(req)
  if (idempotencyKey) {
    const existing = await getSnoozeByIdempotencyKey(idempotencyKey)
    if (existing) return NextResponse.json({ ok: true, snooze: existing }, { status: 200 })
  }

  const snooze = await createSnooze(
    id,
    category as SnoozeCategory,
    snoozeDate,
    typeof freeformNote === 'string' ? freeformNote : undefined,
    idempotencyKey
  )

  if (isAgent) {
    await logAgentAction({
      actor: 'hermes',
      action: 'snooze',
      target: id,
      route: req.nextUrl.pathname,
      method: 'POST',
      correlationId: getCorrelationId(req),
      idempotencyKey,
      requestMeta: extractRequestMeta(req),
      before: null,
      after: snooze,
    })
  }

  return NextResponse.json({ ok: true })
}

export async function DELETE(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const isAgent = isAgentRequest(req)
  if (!(await isAuthedOrAgent(req))) return unauthorizedResponse()
  if (isAgent && !(await assertAgentWritesEnabled())) return agentWritesDisabledResponse()

  const { id } = await params
  const before = isAgent ? await getActiveSnooze(id) : null
  await removeActiveSnooze(id)

  if (isAgent) {
    await logAgentAction({
      actor: 'hermes',
      action: 'unsnooze',
      target: id,
      route: req.nextUrl.pathname,
      method: 'DELETE',
      correlationId: getCorrelationId(req),
      idempotencyKey: getIdempotencyKey(req),
      requestMeta: extractRequestMeta(req),
      before,
      after: null,
    })
  }

  return NextResponse.json({ ok: true })
}
