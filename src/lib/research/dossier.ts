import type { PersonQuery, Candidate, SourceAttempt, Dossier } from './types'
import { resolve } from './resolution'

// Assemble the reviewable dossier: resolve candidates → resolution, keep the full source trace.
export function buildDossier(query: PersonQuery, candidates: Candidate[], attempts: SourceAttempt[]): Dossier {
  return {
    caseId: query.caseId ?? null,
    query,
    resolution: resolve(query, candidates),
    candidates,
    attempts,
    createdAt: new Date(),
  }
}
