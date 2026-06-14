// One-off, READ-ONLY Phase D verification from existing run telemetry (no credits spent).
import pg from 'pg'
const { Client } = pg
const c = new Client({ connectionString: process.env.DATABASE_URL })
await c.connect()
const q = async (label, sql) => { try { const r = await c.query(sql); console.log(`\n### ${label}`); console.table(r.rows) } catch (e) { console.log(`\n### ${label}\n  (error: ${e.message})`) } }

await q('Evidence packages (total + recent 30d)',
  `SELECT count(*)::int AS total, count(*) FILTER (WHERE completed_at > now() - interval '30 days')::int AS last_30d FROM evidence_packages`)

await q('Source attempts by source + status (60d)',
  `SELECT source_id, source_type, status, count(*)::int AS n, round(avg(candidate_count),1) AS avg_cand
   FROM source_attempts WHERE created_at > now() - interval '60 days'
   GROUP BY source_id, source_type, status ORDER BY n DESC LIMIT 40`)

await q('Research cost runs: firecrawl usage (60d)',
  `SELECT count(*)::int AS runs, coalesce(sum(firecrawl_calls),0)::int AS firecrawl_calls_total,
          round(avg(firecrawl_calls),1) AS avg_firecrawl_per_run, round(sum(usd)::numeric,2) AS total_usd
   FROM research_costs WHERE created_at > now() - interval '60 days'`)

await q('Dossiers per case (case-level idempotency signal: >1 = re-runs happened)',
  `SELECT case_id, count(*)::int AS dossiers FROM research_dossiers WHERE case_id IS NOT NULL
   GROUP BY case_id HAVING count(*) > 1 ORDER BY 2 DESC LIMIT 20`)

await q('Evidence items by kind (do we hold reusable phones/addresses for get_prior_evidence?)',
  `SELECT it->>'kind' AS kind, count(*)::int AS n
   FROM evidence_packages, jsonb_array_elements(evidence) AS it
   GROUP BY 1 ORDER BY 2 DESC`)

await c.end()
