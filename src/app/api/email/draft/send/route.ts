import { NextRequest, NextResponse } from 'next/server'
import { isAuthedOrAgent, isAgentRequest, unauthorizedResponse } from '@/lib/auth/require-session'
import {
  assertAgentWritesEnabled, agentWritesDisabledResponse,
  extractRequestMeta, getCorrelationId, getIdempotencyKey,
} from '@/lib/agent/guard'
import { isGoogleConfigured } from '@/lib/integrations/google/auth'
import { sendDraft } from '@/lib/integrations/google/drafts'
import { logAgentAction } from '@/lib/db/agent-audit'

export const maxDuration = 30

// POST /api/email/draft/send — SEND an existing draft. The real outbound action: gated + audited.
// Body: { draftId, to?, cc?, bcc?, subject? }  (recipients/subject are for the audit record)
export async function POST(req: NextRequest) {
  const isAgent = isAgentRequest(req)
  if (!(await isAuthedOrAgent(req))) return unauthorizedResponse()
  if (isAgent && !(await assertAgentWritesEnabled())) return agentWritesDisabledResponse()
  if (!isGoogleConfigured()) return NextResponse.json({ error: 'Google not configured' }, { status: 400 })

  const b = (await req.json().catch(() => ({}))) as Record<string, unknown>
  if (!b.draftId || typeof b.draftId !== 'string') {
    return NextResponse.json({ error: 'draftId is required' }, { status: 400 })
  }
  try {
    const r = await sendDraft(b.draftId)
    if (isAgent) {
      await logAgentAction({
        actor: 'hermes', action: 'send_email', target: r.id,
        route: req.nextUrl.pathname, method: 'POST',
        correlationId: getCorrelationId(req), idempotencyKey: getIdempotencyKey(req),
        requestMeta: extractRequestMeta(req), before: { draftId: b.draftId },
        after: { sentMessageId: r.id, to: b.to ?? null, cc: b.cc ?? null, bcc: b.bcc ?? null, subject: b.subject ?? null },
      })
    }
    return NextResponse.json({ ok: true, sentMessageId: r.id, threadId: r.threadId })
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    return NextResponse.json({ error: message }, { status: 502 })
  }
}
