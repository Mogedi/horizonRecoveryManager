// Persistence for the research agent (v2). All research DB access goes through here.
import { prisma } from './client'
import { Prisma } from '@prisma/client'
import type { SourceAttempt, EvidencePackage, Dossier, ResearchRequestInput, CountySourceInput } from '@/lib/research/types'

// Safe JSON cast — surfaces non-serializable content immediately (per CLAUDE.md).
const json = (v: unknown) => JSON.parse(JSON.stringify(v)) as Prisma.InputJsonValue

// ── Queue ──────────────────────────────────────────────────────────────────────
export async function enqueueRequest(input: ResearchRequestInput) {
  return prisma.researchRequest.create({
    data: { query: json(input.query), goal: input.goal, enqueuedBy: input.enqueuedBy },
  })
}

// Claim the oldest pending request (mark it running). Hermes calls this to pull work.
export async function claimNextRequest() {
  // Self-heal: a request stuck 'running' (a crashed agentic run) goes back to pending for retry.
  await prisma.researchRequest.updateMany({
    where: { status: 'running', startedAt: { lt: new Date(Date.now() - 20 * 60 * 1000) } },
    data: { status: 'pending', startedAt: null },
  })
  const next = await prisma.researchRequest.findFirst({ where: { status: 'pending' }, orderBy: { createdAt: 'asc' } })
  if (!next) return null
  const updated = await prisma.researchRequest.updateMany({
    where: { id: next.id, status: 'pending' }, // guard against a concurrent claim
    data: { status: 'running', startedAt: new Date() },
  })
  return updated.count === 1 ? next : null
}

export async function failRequest(id: number, error: string) {
  return prisma.researchRequest.update({ where: { id }, data: { status: 'failed', error, finishedAt: new Date() } })
}

export async function listRequests(limit = 50) {
  return prisma.researchRequest.findMany({ orderBy: { createdAt: 'desc' }, take: limit })
}

// ── Live progress ────────────────────────────────────────────────────────────────
export async function logProgress(requestId: number, message: string, step?: string | null) {
  return prisma.researchProgress.create({ data: { requestId, message, step: step ?? null } })
}

export async function getProgressForRequests(requestIds: number[]) {
  const out: Record<number, { step: string | null; message: string; createdAt: Date }[]> = {}
  if (!requestIds.length) return out
  const rows = await prisma.researchProgress.findMany({
    where: { requestId: { in: requestIds } },
    orderBy: { createdAt: 'asc' },
    select: { requestId: true, step: true, message: true, createdAt: true },
  })
  for (const r of rows) (out[r.requestId] ||= []).push({ step: r.step, message: r.message, createdAt: r.createdAt })
  return out
}

// ── Per-run cost ─────────────────────────────────────────────────────────────────
export interface CostInput {
  sessionId?: string | null; requestId?: number | null; model?: string | null
  inTokens?: number; outTokens?: number; firecrawlCalls?: number; usd?: number; runSeconds?: number
}
export async function saveCost(c: CostInput) {
  // Dedupe by Hermes session id (the cost-sync re-posts recent sessions; each run = one session).
  if (c.sessionId) {
    const existing = await prisma.researchCost.findFirst({ where: { sessionId: c.sessionId }, select: { id: true, requestId: true } })
    if (existing) {
      // Backfill the request link if a later sync resolved it (request finished after the first sync).
      if (c.requestId && !existing.requestId) await prisma.researchCost.update({ where: { id: existing.id }, data: { requestId: c.requestId } })
      return existing
    }
  }
  return prisma.researchCost.create({
    data: {
      sessionId: c.sessionId ?? null, requestId: c.requestId ?? null, model: c.model ?? null,
      inTokens: c.inTokens ?? 0, outTokens: c.outTokens ?? 0, firecrawlCalls: c.firecrawlCalls ?? 0,
      usd: c.usd ?? 0, runSeconds: c.runSeconds ?? 0,
    },
  })
}

// Cost trend — avg $/run and totals, bucketed by day, for the "is it coming down?" chart.
export async function getCostTrend(days = 60) {
  const since = new Date(Date.now() - days * 86_400_000)
  const rows = await prisma.researchCost.findMany({ where: { createdAt: { gte: since } }, select: { usd: true, createdAt: true } })
  const byDay = new Map<string, { n: number; usd: number }>()
  for (const r of rows) {
    const day = r.createdAt.toISOString().slice(0, 10)
    const a = byDay.get(day) ?? { n: 0, usd: 0 }
    a.n++; a.usd += r.usd
    byDay.set(day, a)
  }
  const totalUsd = rows.reduce((s, r) => s + r.usd, 0)
  return {
    runs: rows.length,
    totalUsd: +totalUsd.toFixed(4),
    avgUsd: rows.length ? +(totalUsd / rows.length).toFixed(4) : 0,
    byDay: [...byDay.entries()].map(([day, a]) => ({ day, runs: a.n, avgUsd: +(a.usd / a.n).toFixed(4) })).sort((x, y) => x.day.localeCompare(y.day)),
  }
}

// ── Immutable evidence package + derived dossier ────────────────────────────────
export async function saveEvidencePackage(pkg: EvidencePackage, caseId?: string | null): Promise<number> {
  const row = await prisma.evidencePackage.create({
    data: {
      requestId: pkg.requestId ?? null,
      caseId: caseId ?? pkg.query.caseId ?? null,
      query: json(pkg.query), plan: json(pkg.plan), candidates: json(pkg.candidates),
      evidence: json(pkg.evidence), documents: json(pkg.documents), telemetry: json(pkg.telemetry),
      notes: json(pkg.notes), budget: json(pkg.budget),
    },
    select: { id: true },
  })
  return row.id
}

export async function saveDossier(d: Dossier, evidencePackageId: number | null, caseId?: string | null): Promise<number> {
  const row = await prisma.researchDossier.create({
    data: {
      evidencePackageId,
      caseId: caseId ?? null,
      subject: json(d.subject), heirGraph: json(d.heirGraph), candidatePeople: json(d.candidatePeople),
      contactRankings: json(d.contactRankings), confidence: json(d.confidence), reviewStatus: d.reviewStatus,
    },
    select: { id: true },
  })
  return row.id
}

// Mark a request done and link it to its package + dossier.
export async function completeRequest(id: number, evidencePackageId: number, dossierId: number) {
  return prisma.researchRequest.update({
    where: { id }, data: { status: 'done', evidencePackageId, dossierId, finishedAt: new Date() },
  })
}

export async function getDossier(id: number) {
  return prisma.researchDossier.findUnique({
    where: { id },
    include: { documents: { select: { id: true, kind: true, label: true, mimeType: true, sourceUrl: true, createdAt: true } } },
  })
}

export async function listRecentDossiers(limit = 25) {
  return prisma.researchDossier.findMany({ orderBy: { createdAt: 'desc' }, take: limit })
}

// Recent dossiers, each with its per-run cost (dossier → request → cost).
export async function listRecentDossiersWithCost(limit = 25) {
  const dossiers = await prisma.researchDossier.findMany({ orderBy: { createdAt: 'desc' }, take: limit })
  const reqs = await prisma.researchRequest.findMany({ where: { dossierId: { in: dossiers.map(d => d.id) } }, select: { id: true, dossierId: true } })
  const reqByDossier = new Map(reqs.map(r => [r.dossierId, r.id]))
  const costs = await prisma.researchCost.findMany({ where: { requestId: { in: reqs.map(r => r.id) } }, select: { requestId: true, usd: true } })
  const costByReq = new Map(costs.map(c => [c.requestId, c.usd]))
  return dossiers.map(d => ({ ...d, usd: costByReq.get(reqByDossier.get(d.id) ?? -1) ?? null }))
}

// Full dossier for the detail panel: the derived dossier + its source evidence + its cost.
export async function getDossierDetail(id: number) {
  const dossier = await prisma.researchDossier.findUnique({
    where: { id },
    include: { documents: { select: { id: true, kind: true, label: true, mimeType: true, sourceUrl: true, createdAt: true } } },
  })
  if (!dossier) return null
  const evidence = dossier.evidencePackageId
    ? await prisma.evidencePackage.findUnique({ where: { id: dossier.evidencePackageId }, select: { evidence: true, plan: true, notes: true } })
    : null
  const request = await prisma.researchRequest.findFirst({ where: { dossierId: id }, select: { id: true } })
  const cost = request
    ? await prisma.researchCost.findFirst({ where: { requestId: request.id }, select: { usd: true, model: true, inTokens: true, outTokens: true, runSeconds: true } })
    : null
  return { dossier, evidence, cost }
}

export async function markDossierReviewed(id: number, reviewStatus: string, reviewedBy: string) {
  return prisma.researchDossier.update({ where: { id }, data: { reviewStatus, reviewedBy, reviewedAt: new Date() } })
}

// ── Telemetry ───────────────────────────────────────────────────────────────────
export async function logSourceAttempt(a: SourceAttempt) {
  return prisma.sourceAttempt.create({
    data: {
      sourceId: a.sourceId, requestId: a.requestId ?? null, caseId: a.caseId ?? null, status: a.status,
      blockReason: a.blockReason ?? null, url: a.url ?? null, latencyMs: Math.round(a.latencyMs),
      candidateCount: a.candidateCount, proxyUsed: a.proxyUsed,
    },
  })
}

export interface SourceHealth { sourceId: string; attempts: number; successRate: number; blockRate: number; avgCandidates: number; avgLatencyMs: number }

export async function getSourceHealth(days = 30): Promise<SourceHealth[]> {
  const since = new Date(Date.now() - days * 86_400_000)
  const rows = await prisma.sourceAttempt.findMany({
    where: { createdAt: { gte: since } },
    select: { sourceId: true, status: true, candidateCount: true, latencyMs: true },
  })
  const agg = new Map<string, { n: number; ok: number; blocked: number; cand: number; lat: number }>()
  for (const r of rows) {
    const a = agg.get(r.sourceId) ?? { n: 0, ok: 0, blocked: 0, cand: 0, lat: 0 }
    a.n++; if (r.status === 'success') a.ok++; if (r.status === 'blocked' || r.status === 'captcha') a.blocked++
    a.cand += r.candidateCount; a.lat += r.latencyMs
    agg.set(r.sourceId, a)
  }
  return [...agg.entries()].map(([sourceId, a]) => ({
    sourceId, attempts: a.n,
    successRate: a.n ? +(a.ok / a.n).toFixed(3) : 0,
    blockRate: a.n ? +(a.blocked / a.n).toFixed(3) : 0,
    avgCandidates: a.n ? +(a.cand / a.n).toFixed(1) : 0,
    avgLatencyMs: a.n ? Math.round(a.lat / a.n) : 0,
  }))
}

// ── County registry (learned-but-verified) ──────────────────────────────────────
export async function upsertCountySource(input: CountySourceInput) {
  return prisma.countySource.upsert({
    where: { state_county_sourceKind: { state: input.state, county: input.county, sourceKind: input.sourceKind } },
    create: { ...input, lastVerifiedAt: new Date() },
    update: { method: input.method, entryUrl: input.entryUrl, searchHint: input.searchHint, lastVerifiedAt: new Date(), status: 'active' },
  })
}

export async function getCountySources(state: string, county?: string) {
  return prisma.countySource.findMany({ where: { state, ...(county ? { county } : {}) } })
}

// ── Documents ────────────────────────────────────────────────────────────────────
export interface CapturedDoc {
  caseId?: string | null; dossierId?: number | null; evidencePackageId?: number | null
  sourceId: string; kind: string; label?: string | null; mimeType: string; bytes: Uint8Array; sourceUrl?: string | null
}

export async function saveDocument(doc: CapturedDoc): Promise<number> {
  const row = await prisma.researchDocument.create({
    data: {
      caseId: doc.caseId ?? null, dossierId: doc.dossierId ?? null, evidencePackageId: doc.evidencePackageId ?? null,
      sourceId: doc.sourceId, kind: doc.kind, label: doc.label ?? null, mimeType: doc.mimeType,
      bytes: new Uint8Array(doc.bytes), sourceUrl: doc.sourceUrl ?? null,
    },
    select: { id: true },
  })
  return row.id
}

export async function getDocumentBytes(id: number) {
  return prisma.researchDocument.findUnique({ where: { id }, select: { mimeType: true, bytes: true, label: true } })
}
