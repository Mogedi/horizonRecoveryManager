import { NextRequest, NextResponse } from 'next/server'
import { isAuthedOrAgent, isAgentRequest, unauthorizedResponse } from '@/lib/auth/require-session'
import {
  assertAgentWritesEnabled, agentWritesDisabledResponse,
  extractRequestMeta, getCorrelationId,
} from '@/lib/agent/guard'
import { isGoogleConfigured } from '@/lib/integrations/google/auth'
import { discardDraft } from '@/lib/integrations/google/drafts'
import { logAgentAction } from '@/lib/db/agent-audit'

// DELETE /api/email/draft/[id] — discard a draft.
export async function DELETE(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const isAgent = isAgentRequest(req)
  if (!(await isAuthedOrAgent(req))) return unauthorizedResponse()
  if (isAgent && !(await assertAgentWritesEnabled())) return agentWritesDisabledResponse()
  if (!isGoogleConfigured()) return NextResponse.json({ error: 'Google not configured' }, { status: 400 })
  const { id } = await params
  try {
    await discardDraft(id)
    if (isAgent) {
      await logAgentAction({
        actor: 'hermes', action: 'discard_email_draft', target: id,
        route: req.nextUrl.pathname, method: 'DELETE',
        correlationId: getCorrelationId(req), idempotencyKey: null,
        requestMeta: extractRequestMeta(req), before: { draftId: id }, after: null,
      })
    }
    return NextResponse.json({ ok: true, discarded: id })
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : String(err) }, { status: 502 })
  }
}
