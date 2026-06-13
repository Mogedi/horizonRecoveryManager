// Research runner — sequential (human pace), telemetry on every call, with an injectable
// circuit-breaker predicate so the orchestrator can skip sources that are currently blocked.
import type { SourceAdapter, PersonQuery, SourceResult, SourceAttempt, Candidate } from './types'
import { logSourceAttempt } from '@/lib/db/research'

export interface RunnerOptions {
  proxyUsed?: boolean
  paceMs?: number
  persist?: boolean // default true; false in tests
  shouldSkip?: (adapter: SourceAdapter) => boolean | Promise<boolean> // circuit breaker
}

const errorAttempt = (id: string, caseId: string | null | undefined, proxyUsed: boolean): SourceAttempt => ({
  sourceId: id, caseId: caseId ?? null, status: 'error', latencyMs: 0, candidateCount: 0, proxyUsed, timestamp: new Date(),
})

export async function runResearch(
  adapters: SourceAdapter[], query: PersonQuery, opts: RunnerOptions = {},
): Promise<{ candidates: Candidate[]; attempts: SourceAttempt[]; skipped: string[] }> {
  const proxyUsed = !!opts.proxyUsed
  const paceMs = opts.paceMs ?? 1500
  const persist = opts.persist !== false
  const candidates: Candidate[] = []
  const attempts: SourceAttempt[] = []
  const skipped: string[] = []

  const active: SourceAdapter[] = []
  for (const a of adapters) {
    if (opts.shouldSkip && (await opts.shouldSkip(a))) skipped.push(a.id)
    else active.push(a)
  }

  for (let i = 0; i < active.length; i++) {
    const a = active[i]
    let result: SourceResult
    try {
      result = await a.search(query, { proxyUsed })
    } catch {
      result = { attempt: errorAttempt(a.id, query.caseId, proxyUsed), candidates: [] }
    }
    attempts.push(result.attempt)
    candidates.push(...result.candidates)
    if (persist) await logSourceAttempt(result.attempt).catch(() => {})
    if (i < active.length - 1 && paceMs > 0) await new Promise(r => setTimeout(r, paceMs))
  }

  return { candidates, attempts, skipped }
}
