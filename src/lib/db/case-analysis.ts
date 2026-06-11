import { prisma } from './client'
import { AnalysisType, AnalysisSource, CaseHealth, CasePriority } from '@prisma/client'

export { AnalysisType, AnalysisSource, CaseHealth, CasePriority }

// ── enum guards (mirror isValidSnoozeCategory in snoozes.ts) ───────────────────
const ANALYSIS_TYPES = new Set<string>(Object.values(AnalysisType))
const CASE_HEALTHS = new Set<string>(Object.values(CaseHealth))
const CASE_PRIORITIES = new Set<string>(Object.values(CasePriority))

export function isAnalysisType(s: string): s is AnalysisType {
  return ANALYSIS_TYPES.has(s)
}
export function isCaseHealth(s: string): s is CaseHealth {
  return CASE_HEALTHS.has(s)
}
export function isCasePriority(s: string): s is CasePriority {
  return CASE_PRIORITIES.has(s)
}

export type InsertAnalysisInput = {
  dealHubspotId: string
  analysisType?: AnalysisType
  source: AnalysisSource
  actor: string
  provider?: string | null
  model?: string | null
  health?: CaseHealth
  priority?: CasePriority
  statusLabel?: string | null
  blockers?: string[]
  recommendations?: string[]
  risks?: string[]
  nextAction?: string | null
  lastMeaningfulActivity?: string | null
  moActionRequired?: boolean
  confidence?: number | null
  reasoning?: string | null
  generatedFrom?: string | null
  inputHash?: string | null
  supersedesAnalysisId?: number | null
  correlationId?: string | null
  idempotencyKey?: string | null
  raw?: unknown
}

// Safe-cast per CLAUDE.md JSON rule — surfaces non-serializable content immediately.
function toJsonArray(v: string[] | undefined) {
  return JSON.parse(JSON.stringify(v ?? []))
}

// Append-only. Every call INSERTs a new row; nothing is ever updated or overwritten.
export async function insertAnalysis(input: InsertAnalysisInput) {
  return prisma.caseAnalysis.create({
    data: {
      dealHubspotId: input.dealHubspotId,
      analysisType: input.analysisType ?? AnalysisType.triage,
      source: input.source,
      actor: input.actor,
      provider: input.provider ?? null,
      model: input.model ?? null,
      health: input.health ?? CaseHealth.unknown,
      priority: input.priority ?? CasePriority.normal,
      statusLabel: input.statusLabel ?? null,
      blockers: toJsonArray(input.blockers),
      recommendations: toJsonArray(input.recommendations),
      risks: toJsonArray(input.risks),
      nextAction: input.nextAction ?? null,
      lastMeaningfulActivity: input.lastMeaningfulActivity ?? null,
      moActionRequired: input.moActionRequired ?? false,
      confidence: input.confidence ?? null,
      reasoning: input.reasoning ?? null,
      generatedFrom: input.generatedFrom ?? null,
      inputHash: input.inputHash ?? null,
      supersedesAnalysisId: input.supersedesAnalysisId ?? null,
      correlationId: input.correlationId ?? null,
      idempotencyKey: input.idempotencyKey ?? null,
      rawPayload: input.raw === undefined ? undefined : JSON.parse(JSON.stringify(input.raw)),
    },
  })
}

export async function getLatestAnalysis(
  dealHubspotId: string,
  type: AnalysisType = AnalysisType.triage
) {
  return prisma.caseAnalysis.findFirst({
    where: { dealHubspotId, analysisType: type },
    orderBy: { createdAt: 'desc' },
  })
}

export async function getAnalysisHistory(
  dealHubspotId: string,
  type?: AnalysisType,
  limit = 20
) {
  return prisma.caseAnalysis.findMany({
    where: { dealHubspotId, ...(type ? { analysisType: type } : {}) },
    orderBy: { createdAt: 'desc' },
    take: limit,
  })
}

export async function getAnalysisByIdempotencyKey(idempotencyKey: string) {
  return prisma.caseAnalysis.findUnique({ where: { idempotencyKey } })
}

// Latest `triage` analysis's moActionRequired per deal — the AI-interpretation layer's signal
// for the queue's follow_up bucket. Deals with no analysis fall back to ai_summaries upstream.
export async function getMoActionMapFromAnalysis(): Promise<Map<string, boolean>> {
  const rows = await prisma.caseAnalysis.findMany({
    where: { analysisType: AnalysisType.triage },
    orderBy: { createdAt: 'desc' },
    select: { dealHubspotId: true, moActionRequired: true },
  })
  const map = new Map<string, boolean>()
  for (const row of rows) {
    if (!map.has(row.dealHubspotId)) map.set(row.dealHubspotId, row.moActionRequired)
  }
  return map
}
