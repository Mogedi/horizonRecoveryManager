// Direct READ-ONLY access to the HorizonManager Neon DB for Hermes.
// Uses DATABASE_URL_READONLY (a SELECT-only role) — the role itself enforces no-writes.
// Future: migrate these reads to HorizonManager read APIs so Hermes never couples to the schema.
import pg from 'pg'

let pool
function getPool() {
  if (!pool) {
    const connectionString = process.env.DATABASE_URL_READONLY
    if (!connectionString) throw new Error('DATABASE_URL_READONLY not set')
    pool = new pg.Pool({ connectionString, max: 3 })
  }
  return pool
}

export async function query(text, params) {
  const res = await getPool().query(text, params)
  return res.rows
}

// ── General read-only query surface (for the data-explorer skill) ──────────────
// The DATABASE_URL_READONLY role already forbids writes at the DB level; this adds a
// single-statement SELECT guard (clean errors), a statement timeout, and a row cap.
export async function runReadOnlySql(sql, { maxRows = 200, timeoutMs = 8000 } = {}) {
  const cleaned = String(sql || '').trim().replace(/;\s*$/, '')
  if (!cleaned) throw new Error('empty query')
  if (cleaned.includes(';')) throw new Error('only a single statement is allowed (no semicolons)')
  if (!/^(select|with)\b/i.test(cleaned)) throw new Error('only SELECT / WITH queries are allowed')

  const client = await getPool().connect()
  try {
    await client.query(`SET statement_timeout = ${Number(timeoutMs) || 8000}`)
    const res = await client.query(cleaned)
    const rows = res.rows.slice(0, maxRows)
    return { rows, rowCount: res.rowCount, truncated: res.rowCount > maxRows }
  } finally {
    client.release()
  }
}

// Live schema for the data-explorer: domain tables → columns, plus enum types → values.
export async function describeSchema() {
  const cols = await query(
    `SELECT table_name, column_name, data_type, udt_name
       FROM information_schema.columns
      WHERE table_schema = 'public'
        AND table_name NOT IN ('_prisma_migrations')
      ORDER BY table_name, ordinal_position`
  )
  const tables = {}
  for (const c of cols) {
    const type = c.data_type === 'USER-DEFINED' ? `enum:${c.udt_name}` : c.data_type
    ;(tables[c.table_name] ||= []).push(`${c.column_name} ${type}`)
  }
  const enumRows = await query(
    `SELECT t.typname AS enum, e.enumlabel AS value
       FROM pg_type t JOIN pg_enum e ON e.enumtypid = t.oid
       JOIN pg_namespace n ON n.oid = t.typnamespace
      WHERE n.nspname = 'public'
      ORDER BY t.typname, e.enumsortorder`
  )
  const enums = {}
  for (const r of enumRows) (enums[r.enum] ||= []).push(r.value)
  return { tables, enums }
}

// Stage ID → human name (from app_settings.stage_map). Cached for the process.
let stageMapCache
async function getStageMap() {
  if (stageMapCache) return stageMapCache
  const rows = await query(`SELECT value FROM app_settings WHERE key = 'stage_map'`)
  try {
    stageMapCache = rows[0] ? JSON.parse(rows[0].value) : {}
  } catch {
    stageMapCache = {}
  }
  return stageMapCache
}

// ── Fuzzy deal search (no dependency) — resolves partial/misspelled names ────────
function levenshtein(a, b) {
  const m = a.length
  const n = b.length
  if (!m) return n
  if (!n) return m
  const d = Array.from({ length: n + 1 }, (_, j) => j)
  for (let i = 1; i <= m; i++) {
    let prev = d[0]
    d[0] = i
    for (let j = 1; j <= n; j++) {
      const tmp = d[j]
      d[j] = Math.min(d[j] + 1, d[j - 1] + 1, prev + (a[i - 1] === b[j - 1] ? 0 : 1))
      prev = tmp
    }
  }
  return d[n]
}

// 0..1 similarity of a query against a deal name. Substring → 1; otherwise best
// per-token word similarity (handles "alberta" → "Albertha", edit distance 1).
export function fuzzyScore(name, queryStr) {
  const n = (name || '').toLowerCase()
  const q = (queryStr || '').toLowerCase().trim()
  if (!q) return 0
  if (n.includes(q)) return 1
  const words = n.split(/[^a-z0-9]+/).filter(Boolean)
  const qTokens = q.split(/\s+/).filter(Boolean)
  if (!qTokens.length || !words.length) return 0
  let total = 0
  for (const qt of qTokens) {
    let best = 0
    for (const w of words) {
      if (w.includes(qt) || qt.includes(w)) { best = Math.max(best, 0.85); continue }
      const sim = 1 - levenshtein(w, qt) / Math.max(w.length, qt.length)
      if (sim > best) best = sim
    }
    total += best
  }
  return total / qTokens.length
}

// Fuzzy search across all ~150 deals (cheap), ranked in JS. Returns top candidates.
export async function searchDeals(queryStr, limit = 8) {
  const [rows, smap] = await Promise.all([
    query(`SELECT hubspot_id, name, stage, amount FROM deals`),
    getStageMap(),
  ])
  return rows
    .map((r) => ({ r, score: fuzzyScore(r.name, queryStr) }))
    .filter((x) => x.score >= 0.55)
    .sort((a, b) => b.score - a.score)
    .slice(0, limit)
    .map((x) => ({ ...x.r, stage_name: smap[x.r.stage] ?? x.r.stage }))
}

// Active queue — most-recently-touched deals first. Hermes decides what to triage.
export async function listQueue(limit = 50) {
  return query(
    `SELECT hubspot_id, name, stage, amount, last_activity_date, stage_entered_at, contact_count
     FROM deals
     ORDER BY last_activity_date DESC NULLS LAST
     LIMIT $1`,
    [limit]
  )
}

export async function getDeal(dealHubspotId) {
  const rows = await query(`SELECT * FROM deals WHERE hubspot_id = $1`, [dealHubspotId])
  return rows[0] ?? null
}

export async function getContacts(dealHubspotId) {
  return query(
    `SELECT name, contact_type, ownership_status, phone_numbers, email_list, address, city, state, zip
     FROM deal_contacts WHERE deal_hubspot_id = $1`,
    [dealHubspotId]
  )
}

// Unified recent activity: JustCall/Google events + HubSpot Layer 2 engagements, newest first.
export async function getRecentActivity(dealHubspotId, limit = 40) {
  return query(
    `SELECT ts, source, type, direction, outcome, body FROM (
       SELECT happened_at AS ts, source::text AS source, type, direction, outcome, body
         FROM activity_events WHERE deal_hubspot_id = $1
       UNION ALL
       SELECT timestamp AS ts, 'hubspot' AS source, type, direction, NULL AS outcome, body
         FROM deal_activities WHERE deal_hubspot_id = $1
     ) merged
     ORDER BY ts DESC NULLS LAST
     LIMIT $2`,
    [dealHubspotId, limit]
  )
}

export async function getLatestAnalysis(dealHubspotId, type = 'triage') {
  const rows = await query(
    `SELECT id, analysis_type, source, actor, health, priority, status_label, blockers,
            recommendations, risks, next_action, input_hash, created_at
     FROM case_analyses
     WHERE deal_hubspot_id = $1 AND analysis_type = $2
     ORDER BY created_at DESC LIMIT 1`,
    [dealHubspotId, type]
  )
  return rows[0] ?? null
}

// Everything triage needs about one case, in one call.
export async function getCase(dealHubspotId) {
  const [deal, contacts, activity, latestAnalysis, smap] = await Promise.all([
    getDeal(dealHubspotId),
    getContacts(dealHubspotId),
    getRecentActivity(dealHubspotId),
    getLatestAnalysis(dealHubspotId),
    getStageMap(),
  ])
  if (!deal) throw new Error(`deal not found: ${dealHubspotId}`)
  deal.stage_name = smap[deal.stage] ?? deal.stage
  return { deal, contacts, activity, latestAnalysis }
}

// Emails Mo SENT (outbound Gmail with a full body stored) — the tone-of-voice corpus.
// Body is truncated so a batch fits comfortably in the chat context window.
export async function getSentEmails(limit = 20) {
  return query(
    `SELECT happened_at AS ts,
            metadata->>'subject' AS subject,
            metadata->>'to'      AS recipient,
            LEFT(body, 1500)     AS body
     FROM activity_events
     WHERE source::text = 'GOOGLE' AND type = 'email' AND direction = 'outbound'
       AND (metadata->>'hasFullBody') = 'true' AND body IS NOT NULL
     ORDER BY happened_at DESC
     LIMIT $1`,
    [limit]
  )
}

// Recent emails (received by default) with their triaged importance — for the end-of-day digest
// and on-demand "what's going on with my emails" queries.
export async function getRecentEmails({ days = 1, importance = null, direction = 'inbound', limit = 200 } = {}) {
  const params = [days]
  let where = `source::text='GOOGLE' AND type='email' AND happened_at > now() - make_interval(days => $1::int)`
  if (direction) { params.push(direction); where += ` AND direction = $${params.length}` }
  if (importance) { params.push(importance); where += ` AND metadata->>'importance' = $${params.length}` }
  params.push(limit)
  return query(
    `SELECT happened_at AS ts,
            metadata->>'from'    AS from_addr,
            metadata->>'subject' AS subject,
            metadata->>'importance' AS importance,
            (metadata->>'hasFullBody')='true' AS has_body,
            deal_hubspot_id
     FROM activity_events
     WHERE ${where}
     ORDER BY happened_at DESC
     LIMIT $${params.length}`,
    params
  )
}

// Deals with no Layer 2 data yet (no contacts) — i.e. new cases needing a Layer 2 pull.
export async function dealsWithoutLayer2() {
  return query(
    `SELECT hubspot_id, name FROM deals
     WHERE hubspot_id NOT IN (SELECT DISTINCT deal_hubspot_id FROM deal_contacts WHERE deal_hubspot_id IS NOT NULL)`
  )
}

export async function close() {
  if (pool) {
    await pool.end()
    pool = undefined
  }
}
