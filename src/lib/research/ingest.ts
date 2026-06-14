// Ingest: Hermes posts an EvidencePackage → Horizon stores it (immutable), derives the Dossier, and
// links the originating request. The ONLY path that turns evidence into a business object.
import type { EvidencePackage } from './types'
import { deriveDossier } from './derive'
import { normalizeTelemetry } from './telemetry'
import { saveEvidencePackage, saveDossier, completeRequest, logSourceAttempt } from '@/lib/db/research'
import { log } from '@/lib/logger'

export async function ingestEvidencePackage(pkg: EvidencePackage): Promise<{ evidencePackageId: number; dossierId: number }> {
  const caseId = pkg.query.caseId ?? null
  const evidencePackageId = await saveEvidencePackage(pkg, caseId)
  const dossier = deriveDossier(pkg) // deterministic; re-runnable over the stored package later
  const dossierId = await saveDossier(dossier, evidencePackageId, caseId)

  // Fan the package telemetry into source_attempts so source intelligence (getSourceHealth) has
  // data — derived from the immutable package, re-runnable, best-effort (never fails the ingest).
  for (const a of normalizeTelemetry(pkg.telemetry)) {
    await logSourceAttempt({ ...a, requestId: pkg.requestId ?? null, caseId, timestamp: new Date() }).catch((err) =>
      log.warn('logSourceAttempt failed during ingest', {
        sourceId: a.sourceId,
        error: err instanceof Error ? err.message : String(err),
      }),
    )
  }
  if (pkg.requestId) {
    // Best-effort: evidence + dossier are already persisted, so a failure here only leaves the
    // originating request row un-finalized. Log it rather than swallowing silently.
    await completeRequest(pkg.requestId, evidencePackageId, dossierId).catch((err) =>
      log.warn('completeRequest failed after ingest', {
        requestId: pkg.requestId,
        error: err instanceof Error ? err.message : String(err),
      }),
    )
  }
  return { evidencePackageId, dossierId }
}
