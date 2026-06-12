import { NextRequest, NextResponse } from 'next/server'
import { isAuthedOrAgent, isAgentRequest, unauthorizedResponse } from '@/lib/auth/require-session'
import {
  assertAgentWritesEnabled, agentWritesDisabledResponse,
  extractRequestMeta, getCorrelationId, getIdempotencyKey,
} from '@/lib/agent/guard'
import { isGoogleConfigured } from '@/lib/integrations/google/auth'
import { createOrUpdateDraft } from '@/lib/integrations/google/drafts'
import { logAgentAction } from '@/lib/db/agent-audit'

export const maxDuration = 30

// POST /api/email/draft — create or update a Gmail DRAFT (never sends).
// Body: { draftId?, to[], cc[], bcc[], subject, body, replyToGmailId? }
export async function POST(req: NextRequest) {
  const isAgent = isAgentRequest(req)
  if (!(await isAuthedOrAgent(req))) return unauthorizedResponse()
  if (isAgent && !(await assertAgentWritesEnabled())) return agentWritesDisabledResponse()
  if (!isGoogleConfigured()) return NextResponse.json({ error: 'Google not configured' }, { status: 400 })

  const b = (await req.json().catch(() => ({}))) as Record<string, unknown>
  const arr = (v: unknown) => (Array.isArray(v) ? (v as unknown[]).filter((x) => typeof x === 'string') as string[] : [])
  try {
    const result = await createOrUpdateDraft({
      draftId: typeof b.draftId === 'string' ? b.draftId : undefined,
      to: arr(b.to), cc: arr(b.cc), bcc: arr(b.bcc),
      subject: typeof b.subject === 'string' ? b.subject : '',
      body: typeof b.body === 'string' ? b.body : '',
      replyToGmailId: typeof b.replyToGmailId === 'string' ? b.replyToGmailId : undefined,
    })
    if (isAgent) {
      await logAgentAction({
        actor: 'hermes', action: 'create_email_draft', target: result.draftId,
        route: req.nextUrl.pathname, method: 'POST',
        correlationId: getCorrelationId(req), idempotencyKey: getIdempotencyKey(req),
        requestMeta: extractRequestMeta(req), before: null,
        after: { draftId: result.draftId, to: result.to, cc: result.cc, bcc: result.bcc, subject: result.subject },
      })
    }
    return NextResponse.json(result, { status: 201 })
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    return NextResponse.json({ error: message }, { status: 502 })
  }
}
