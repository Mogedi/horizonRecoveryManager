import { describe, it, expect, vi, beforeEach } from 'vitest'
import type { EvidencePackage, SourceAttempt } from './types'

// Seam test: the telemetry-fanout bug (telemetry captured but never written to source_attempts) passed
// every unit test because each piece worked in isolation — nothing asserted the wiring at the ingest
// boundary. This guards that seam: an ingested package's telemetry MUST reach logSourceAttempt.
const db = vi.hoisted(() => ({
  saveEvidencePackage: vi.fn(async () => 1),
  saveDossier: vi.fn(async () => 2),
  completeRequest: vi.fn(async () => undefined),
  logSourceAttempt: vi.fn(async (_a: SourceAttempt) => undefined),
}))
vi.mock('@/lib/db/research', () => db)

import { ingestEvidencePackage } from './ingest'

const pkg = (telemetry: unknown[]): EvidencePackage => ({
  requestId: 7,
  query: { name: 'Jane Doe', caseId: 'deal-123' },
  plan: { goal: 'contact', steps: [] },
  candidates: [],
  evidence: [],
  documents: [],
  telemetry: telemetry as EvidencePackage['telemetry'],
  notes: [],
  budget: { stepsUsed: 0, sourcesHit: 0, capHit: false },
  completedAt: '2026-06-14T00:00:00.000Z',
})

describe('ingestEvidencePackage — telemetry reaches source_attempts (regression guard)', () => {
  beforeEach(() => Object.values(db).forEach((m) => m.mockClear()))

  it('fans freeform telemetry into logSourceAttempt with requestId + caseId stamped', async () => {
    await ingestEvidencePackage(pkg([
      { method: 'web_extract', result: 'no results', source: 'legacy.com' },
      { step: 'people_search', result: 'anti-bot blocked', source: 'fastpeoplesearch.com, truepeoplesearch.com' },
    ]))
    // 1 obituary + 2 people-search hosts = 3 attempts
    expect(db.logSourceAttempt).toHaveBeenCalledTimes(3)
    const calls = db.logSourceAttempt.mock.calls.map((c) => c[0])
    expect(calls.every((a) => a.requestId === 7 && a.caseId === 'deal-123')).toBe(true)
    expect(calls.find((a) => a.sourceId === 'legacy.com')).toMatchObject({ sourceType: 'obituary', status: 'empty' })
    expect(calls.filter((a) => a.sourceType === 'people_search' && a.status === 'blocked')).toHaveLength(2)
  })

  it('still persists evidence + dossier even when telemetry is empty', async () => {
    await ingestEvidencePackage(pkg([]))
    expect(db.saveEvidencePackage).toHaveBeenCalledOnce()
    expect(db.saveDossier).toHaveBeenCalledOnce()
    expect(db.logSourceAttempt).not.toHaveBeenCalled()
  })

  it('a telemetry write failure never fails the ingest (best-effort)', async () => {
    db.logSourceAttempt.mockRejectedValueOnce(new Error('db down'))
    await expect(
      ingestEvidencePackage(pkg([{ source: 'legacy.com', result: 'found' }])),
    ).resolves.toEqual({ evidencePackageId: 1, dossierId: 2 })
  })
})
