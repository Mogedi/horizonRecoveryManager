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
  insertAnalysis,
  getAnalysisHistory,
  getAnalysisByIdempotencyKey,
  isAnalysisType,
  isCaseHealth,
  isCasePriority,
  AnalysisSource,
} from '@/lib/db/case-analysis'
import { logAgentAction } from '@/lib/db/agent-audit'
import { log } from '@/lib/logger'

// GET: analysis history for a deal (latest first). ?type=triage|priority|legal_review|...
export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  if (!(await isAuthedOrAgent(req))) return unauthorizedResponse()

  const { id } = await params
  const typeParam = new URL(req.url).searchParams.get('type')
  const type = typeParam && isAnalysisType(typeParam) ? typeParam : undefined
  const analyses = await getAnalysisHistory(id, type)
  return NextResponse.json({ analyses })
}

// POST: append a new analysis (AI-interpretation layer). Append-only — never overwrites.
// Hermes uses this to drive CurrentState without touching business facts.
export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const isAgent = isAgentRequest(req)
  if (!(await isAuthedOrAgent(req))) return unauthorizedResponse()
  if (isAgent && !(await assertAgentWritesEnabled())) return agentWritesDisabledResponse()

  const { id } = await params

  let body: Record<string, unknown>
  try {
    body = (await req.json()) as Record<string, unknown>
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 })
  }

  // Enum validation — categorical fields are constrained to stop AI drift over time.
  const analysisType = body.analysisType
  if (
    analysisType !== undefined &&
    (typeof analysisType !== 'string' || !isAnalysisType(analysisType))
  ) {
    return NextResponse.json({ error: 'Invalid analysisType' }, { status: 400 })
  }
  const health = body.health
  if (typeof health !== 'string' || !isCaseHealth(health)) {
    return NextResponse.json({ error: 'Invalid or missing health' }, { status: 400 })
  }
  const priority = body.priority
  if (typeof priority !== 'string' || !isCasePriority(priority)) {
    return NextResponse.json({ error: 'Invalid or missing priority' }, { status: 400 })
  }

  const asStringArray = (v: unknown): string[] =>
    Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string') : []
  const asString = (v: unknown): string | null => (typeof v === 'string' ? v : null)

  // Idempotency — a repeat with the same key returns the existing row, never a duplicate.
  const idempotencyKey = getIdempotencyKey(req)
  if (idempotencyKey) {
    const existing = await getAnalysisByIdempotencyKey(idempotencyKey)
    if (existing) return NextResponse.json(existing, { status: 200 })
  }

  const correlationId = getCorrelationId(req)
  const created = await insertAnalysis({
    dealHubspotId: id,
    analysisType,
    source: isAgent ? AnalysisSource.agent : AnalysisSource.human,
    actor: isAgent ? 'hermes' : 'mo',
    provider: asString(body.provider) ?? (isAgent ? 'anthropic' : null),
    model: asString(body.model),
    health,
    priority,
    statusLabel: asString(body.statusLabel),
    blockers: asStringArray(body.blockers),
    recommendations: asStringArray(body.recommendations),
    risks: asStringArray(body.risks),
    nextAction: asString(body.nextAction),
    lastMeaningfulActivity: asString(body.lastMeaningfulActivity),
    moActionRequired: typeof body.moActionRequired === 'boolean' ? body.moActionRequired : false,
    confidence: typeof body.confidence === 'number' ? body.confidence : null,
    reasoning: asString(body.reasoning),
    generatedFrom: asString(body.generatedFrom),
    inputHash: asString(body.inputHash),
    supersedesAnalysisId:
      typeof body.supersedesAnalysisId === 'number' ? body.supersedesAnalysisId : null,
    correlationId,
    idempotencyKey,
    raw: body.raw ?? body,
  })

  if (isAgent) {
    await logAgentAction({
      actor: 'hermes',
      action: 'create_analysis',
      target: id,
      route: req.nextUrl.pathname,
      method: 'POST',
      correlationId,
      idempotencyKey,
      requestMeta: extractRequestMeta(req),
      before: null,
      after: created,
    })
  }

  log.info('case analysis inserted', { dealId: id, agent: isAgent, type: created.analysisType })
  return NextResponse.json(created, { status: 201 })
}
