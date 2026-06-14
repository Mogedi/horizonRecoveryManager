// De-risk: run the ingest schema against every real stored package. If any FAIL, the schema is too
// strict for what Hermes actually sends — relax it before wiring rejection into the live route.
import pg from 'pg'
import { register } from 'node:module'
const c=new pg.Client({connectionString:process.env.DATABASE_URL}); await c.connect()
const rows=(await c.query('SELECT id, request_id, query, evidence, candidates, telemetry, plan, documents, notes, budget, completed_at FROM evidence_packages ORDER BY id')).rows
await c.end()
// Reconstruct the package shape the API receives (camelCase keys).
const pkgs=rows.map(r=>({id:r.id, pkg:{requestId:r.request_id, query:r.query, evidence:r.evidence, candidates:r.candidates, telemetry:r.telemetry, plan:r.plan, documents:r.documents, notes:r.notes, budget:r.budget, completedAt:r.completed_at}}))
const { validateEvidencePackage } = await import('../src/lib/research/schema.ts')
let pass=0
for(const {id,pkg} of pkgs){
  const res=validateEvidencePackage(pkg)
  if(res.ok){pass++; console.log(`pkg ${id}: ✓`)}
  else console.log(`pkg ${id}: ✗\n   ${res.issues.join('\n   ')}`)
}
console.log(`\n${pass}/${pkgs.length} real packages pass the schema.`)
