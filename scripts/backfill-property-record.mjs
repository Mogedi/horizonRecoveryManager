// Re-derive ONLY the property_record column for existing dossiers from their immutable evidence
// packages (re-derivable by design). Surfaces P-B on existing real data without re-running research.
import pg from 'pg'
const { deriveDossier } = await import('../src/lib/research/derive.ts')
const c = new pg.Client({ connectionString: process.env.DATABASE_URL }); await c.connect()
const dossiers = (await c.query('SELECT id, evidence_package_id FROM research_dossiers WHERE evidence_package_id IS NOT NULL')).rows
let updated = 0
for (const d of dossiers) {
  const pkgRow = (await c.query('SELECT request_id, query, plan, candidates, evidence, documents, telemetry, notes, budget, completed_at FROM evidence_packages WHERE id=$1', [d.evidence_package_id])).rows[0]
  if (!pkgRow) continue
  const pkg = { requestId: pkgRow.request_id, query: pkgRow.query, plan: pkgRow.plan, candidates: pkgRow.candidates, evidence: pkgRow.evidence, documents: pkgRow.documents, telemetry: pkgRow.telemetry, notes: pkgRow.notes, budget: pkgRow.budget, completedAt: pkgRow.completed_at }
  let pr = null
  try { pr = deriveDossier(pkg).propertyRecord } catch (e) { console.log(`dossier ${d.id}: derive error ${e.message}`); continue }
  await c.query('UPDATE research_dossiers SET property_record=$1 WHERE id=$2', [pr ? JSON.stringify(pr) : null, d.id])
  if (pr) { updated++; console.log(`dossier ${d.id}: owner=${pr.ownerOfRecord ?? '—'} match=${pr.ownerMatchesSubject} liens=${pr.liens.length} surplus=${pr.surplusRelevant}`) }
}
console.log(`\nUpdated ${updated} dossiers with a property record (of ${dossiers.length} checked).`)
await c.end()
