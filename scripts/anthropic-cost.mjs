// Pull the REAL Anthropic spend (Admin Usage + Cost API) for the Hermes Research workspace — the
// authoritative cost, broken down BY MODEL. This is the only source that shows the true Haiku-vs-Sonnet
// split; Hermes's self-report (research_costs) bills everything to the main model and can't show it.
//
// Needs an ADMIN key (sk-ant-admin01-...). A workspace/regular key CANNOT call these endpoints.
// Create one: Console → Settings → Admin keys. Then add ANTHROPIC_ADMIN_KEY to .env.local and run:
//   npx dotenv -e .env.local -- npx vite-node scripts/anthropic-cost.mjs
// Optional: WORKSPACE="Hermes Research" (default) to filter to that workspace.

const KEY = process.env.ANTHROPIC_ADMIN_KEY
if (!KEY) {
  console.log('✗ Need ANTHROPIC_ADMIN_KEY (an Admin key, sk-ant-admin01-...). A workspace/regular key cannot read cost.')
  console.log('  Create at Console → Settings → Admin keys → add to .env.local → re-run.')
  process.exit(0)
}
const WS_NAME = (process.env.WORKSPACE || 'Hermes Research').toLowerCase()
const H = { 'anthropic-version': '2023-06-01', 'x-api-key': KEY, 'User-Agent': 'HorizonRecovery/1.0' }
const DAY = 86_400_000
const startISO = new Date(Date.now() - 7 * DAY).toISOString().slice(0, 19) + 'Z'
const endISO = new Date(Date.now() + DAY).toISOString().slice(0, 19) + 'Z'

async function api(path) {
  const r = await fetch(`https://api.anthropic.com${path}`, { headers: H })
  const t = await r.text()
  let j; try { j = JSON.parse(t) } catch { j = t }
  if (!r.ok) { console.log(`✗ HTTP ${r.status} ${path.split('?')[0]}:`, typeof j === 'string' ? j.slice(0, 200) : JSON.stringify(j).slice(0, 300)); return null }
  return j
}

// 1) Resolve the Hermes Research workspace id
const ws = await api('/v1/organizations/workspaces?limit=100')
let wsId = null
if (ws?.data) {
  const m = ws.data.find(w => (w.name || '').toLowerCase() === WS_NAME)
  wsId = m?.id ?? null
  console.log(`Workspaces: ${ws.data.map(w => `${w.name}`).join(', ')}`)
  console.log(`Target "${process.env.WORKSPACE || 'Hermes Research'}" → ${wsId || 'NOT FOUND (showing all)'}\n`)
}

// 2) COST report (USD, in CENTS) — last 7d, grouped by workspace + description (carries model).
// cost_report rejects a workspace_ids[] FILTER, so we group by workspace_id and split client-side.
const cost = await api(`/v1/organizations/cost_report?starting_at=${startISO}&ending_at=${endISO}&bucket_width=1d&group_by[]=workspace_id&group_by[]=description`)
if (cost) {
  const byWs = {} // workspace -> model -> cents
  for (const bucket of cost.data ?? []) {
    for (const r of bucket.results ?? []) {
      const cents = Number(r.amount ?? r.cost ?? r.value ?? 0)
      const w = r.workspace_id ?? 'default'
      const model = r.model ?? r.description?.model ?? (typeof r.description === 'string' ? r.description : 'unknown')
      byWs[w] ??= {}
      byWs[w][model] = (byWs[w][model] || 0) + cents
    }
  }
  console.log('═══ REAL COST (last 7d, USD, by workspace → model) ═══')
  if (Object.keys(byWs).length) {
    for (const [w, models] of Object.entries(byWs)) {
      const label = w === wsId ? `${w}  ← Hermes Research` : w
      const wTotal = Object.values(models).reduce((a, b) => a + b, 0)
      console.log(`  ${label}   $${(wTotal / 100).toFixed(4)}`)
      for (const [m, cents] of Object.entries(models).sort((a, b) => b[1] - a[1])) console.log(`      ${m.padEnd(26)} $${(cents / 100).toFixed(4)}`)
    }
  } else {
    console.log('  (no rows parsed — raw below to refine field names)')
    console.log(JSON.stringify(cost.data?.slice(0, 2) ?? cost, null, 1).slice(0, 1500))
  }
}

// 3) USAGE report (tokens) — last 7d, by model across all workspaces (the real Haiku/Sonnet token split)
const usage = await api(`/v1/organizations/usage_report/messages?starting_at=${startISO}&ending_at=${endISO}&bucket_width=1d&group_by[]=model`)
if (usage) {
  const tok = {}
  for (const bucket of usage.data ?? []) {
    for (const r of bucket.results ?? []) {
      const model = r.model ?? 'unknown'
      const inT = Number(r.uncached_input_tokens ?? 0) + Number(r.cached_input_tokens ?? 0) + Number(r.cache_creation_tokens ?? 0)
      const outT = Number(r.output_tokens ?? 0)
      tok[model] ??= { in: 0, out: 0 }
      tok[model].in += inT; tok[model].out += outT
    }
  }
  console.log('\n═══ TOKEN USAGE (last 7d, by model) ═══')
  if (Object.keys(tok).length) {
    for (const [m, t] of Object.entries(tok)) console.log(`  ${m.padEnd(28)} in ${t.in.toLocaleString()}  out ${t.out.toLocaleString()}`)
  } else {
    console.log('  (no rows parsed — raw first bucket below)')
    console.log(JSON.stringify(usage.data?.[0] ?? usage, null, 1).slice(0, 1500))
  }
}
console.log('\nIf any section shows raw JSON, the field names differ slightly — I refine the parser from that shape.')
