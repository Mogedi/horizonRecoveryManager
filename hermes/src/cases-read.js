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
  const [deal, contacts, activity, latestAnalysis] = await Promise.all([
    getDeal(dealHubspotId),
    getContacts(dealHubspotId),
    getRecentActivity(dealHubspotId),
    getLatestAnalysis(dealHubspotId),
  ])
  if (!deal) throw new Error(`deal not found: ${dealHubspotId}`)
  return { deal, contacts, activity, latestAnalysis }
}

export async function close() {
  if (pool) {
    await pool.end()
    pool = undefined
  }
}
