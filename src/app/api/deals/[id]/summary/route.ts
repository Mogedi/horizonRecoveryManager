import { NextRequest, NextResponse } from 'next/server'
import { isAuthedOrAgent, isAgentRequest, unauthorizedResponse } from '@/lib/auth/require-session'
import {
  assertAgentWritesEnabled,
  agentWritesDisabledResponse,
  extractRequestMeta,
  getCorrelationId,
  getIdempotencyKey,
} from '@/lib/agent/guard'
import { runSummaryGeneration } from '@/lib/ai/generate'
import { logAgentAction } from '@/lib/db/agent-audit'
import { AIError } from '@/lib/ai/errors'
import { log } from '@/lib/logger'

// Server-side Claude regeneration of a deal summary. Also mirrors into case_analysis
// (see runSummaryGeneration). Agents may trigger a regeneration; the agent-authored path
// for direct interpretation is POST /api/deals/[id]/analysis.
export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const isAgent = isAgentRequest(req)
  if (!(await isAuthedOrAgent(req))) return unauthorizedResponse()
  if (isAgent && !(await assertAgentWritesEnabled())) return agentWritesDisabledResponse()

  const { id } = await params
  log.info('ai summary requested', { dealId: id, agent: isAgent })

  try {
    const result = await runSummaryGeneration(id)
    if (isAgent) {
      await logAgentAction({
        actor: 'hermes',
        action: 'create_analysis',
        target: id,
        route: req.nextUrl.pathname,
        method: 'POST',
        correlationId: getCorrelationId(req),
        idempotencyKey: getIdempotencyKey(req),
        requestMeta: extractRequestMeta(req),
        before: null,
        after: { generatedFrom: 'summary-endpoint', generatedAt: result.generatedAt },
      })
    }
    log.info('ai summary complete', { dealId: id })
    return NextResponse.json(result)
  } catch (err) {
    if (err instanceof AIError) {
      log.error('ai summary failed', { dealId: id, error: err.message })
      return NextResponse.json({ error: err.message }, { status: 502 })
    }
    throw err
  }
}
