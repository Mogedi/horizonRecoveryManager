// Persistence for the research agent. All research DB access goes through here (service boundary).
import { prisma } from './client'
import { Prisma } from '@prisma/client'
import type { SourceAttempt, Dossier } from '@/lib/research/types'

// Safe JSON cast — surfaces non-serializable content immediately (per CLAUDE.md).
const json = (v: unknown) => JSON.parse(JSON.stringify(v)) as Prisma.InputJsonValue

export async function logSourceAttempt(a: SourceAttempt) {
  return prisma.sourceAttempt.create({
    data: {
      sourceId: a.sourceId,
      caseId: a.caseId ?? null,
      status: a.status,
      blockReason: a.blockReason ?? null,
      url: a.url ?? null,
      latencyMs: Math.round(a.latencyMs),
      candidateCount: a.candidateCount,
      proxyUsed: a.proxyUsed,
    },
  })
}

export interface SourceHealth {
  sourceId: string
  attempts: number
  successRate: number
  blockRate: number
  avgCandidates: number
  avgLatencyMs: number
}

// Per-source health over a window — the "is source X reliable / degrading?" answer.
export async function getSourceHealth(days = 30): Promise<SourceHealth[]> {
  const since = new Date(Date.now() - days * 86_400_000)
  const rows = await prisma.sourceAttempt.findMany({
    where: { createdAt: { gte: since } },
    select: { sourceId: true, status: true, candidateCount: true, latencyMs: true },
  })
  const agg = new Map<string, { n: number; ok: number; blocked: number; cand: number; lat: number }>()
  for (const r of rows) {
    const a = agg.get(r.sourceId) ?? { n: 0, ok: 0, blocked: 0, cand: 0, lat: 0 }
    a.n++
    if (r.status === 'success') a.ok++
    if (r.status === 'blocked' || r.status === 'captcha') a.blocked++
    a.cand += r.candidateCount
    a.lat += r.latencyMs
    agg.set(r.sourceId, a)
  }
  return [...agg.entries()].map(([sourceId, a]) => ({
    sourceId,
    attempts: a.n,
    successRate: a.n ? +(a.ok / a.n).toFixed(3) : 0,
    blockRate: a.n ? +(a.blocked / a.n).toFixed(3) : 0,
    avgCandidates: a.n ? +(a.cand / a.n).toFixed(1) : 0,
    avgLatencyMs: a.n ? Math.round(a.lat / a.n) : 0,
  }))
}

// Dossiers are append-only — every run is a new row (mirrors case_analyses).
export async function saveDossier(d: Dossier): Promise<number> {
  const row = await prisma.researchDossier.create({
    data: {
      caseId: d.caseId ?? null,
      query: json(d.query),
      resolution: json(d.resolution),
      candidates: json(d.candidates),
      attempts: json(d.attempts),
    },
    select: { id: true },
  })
  return row.id
}

export async function getDossier(id: number) {
  return prisma.researchDossier.findUnique({
    where: { id },
    include: { documents: { select: { id: true, kind: true, label: true, mimeType: true, sourceUrl: true, createdAt: true } } },
  })
}

export async function listDossiers(caseId: string, limit = 20) {
  return prisma.researchDossier.findMany({
    where: { caseId },
    orderBy: { createdAt: 'desc' },
    take: limit,
  })
}

export async function markDossierReviewed(id: number, reviewedBy: string) {
  return prisma.researchDossier.update({
    where: { id },
    data: { reviewed: true, reviewedBy, reviewedAt: new Date() },
  })
}

export interface CapturedDoc {
  caseId?: string | null
  dossierId?: number | null
  sourceId: string
  kind: string
  label?: string | null
  mimeType: string
  bytes: Uint8Array
  sourceUrl?: string | null
}

export async function saveDocument(doc: CapturedDoc): Promise<number> {
  const row = await prisma.researchDocument.create({
    data: {
      caseId: doc.caseId ?? null,
      dossierId: doc.dossierId ?? null,
      sourceId: doc.sourceId,
      kind: doc.kind,
      label: doc.label ?? null,
      mimeType: doc.mimeType,
      bytes: new Uint8Array(doc.bytes),
      sourceUrl: doc.sourceUrl ?? null,
    },
    select: { id: true },
  })
  return row.id
}

export async function getDocumentBytes(id: number) {
  return prisma.researchDocument.findUnique({ where: { id }, select: { mimeType: true, bytes: true, label: true } })
}

// Soft learning: log a useful site we don't have an adapter for, for human approval.
export async function recordSuggestedSource(host: string, url: string, note?: string) {
  return prisma.suggestedSource.upsert({
    where: { host },
    create: { host, url, note: note ?? null },
    update: { seenCount: { increment: 1 } },
  })
}
