// Ingest: Hermes posts an EvidencePackage → Horizon stores it (immutable), derives the Dossier, and
// links the originating request. The ONLY path that turns evidence into a business object.
import type { EvidencePackage } from './types'
import { deriveDossier } from './derive'
import { saveEvidencePackage, saveDossier, completeRequest } from '@/lib/db/research'

export async function ingestEvidencePackage(pkg: EvidencePackage): Promise<{ evidencePackageId: number; dossierId: number }> {
  const caseId = pkg.query.caseId ?? null
  const evidencePackageId = await saveEvidencePackage(pkg, caseId)
  const dossier = deriveDossier(pkg) // deterministic; re-runnable over the stored package later
  const dossierId = await saveDossier(dossier, evidencePackageId, caseId)
  if (pkg.requestId) await completeRequest(pkg.requestId, evidencePackageId, dossierId).catch(() => {})
  return { evidencePackageId, dossierId }
}
