// HorizonManager MCP server — exposes the case data layer as Model Context Protocol tools so ANY
// MCP client (Nous Hermes, Claude Code, Cursor, …) can read cases and act on them. Portable by
// design: it wraps the SAME interfaces the bot uses — read-only Neon via cases-read.js, and the
// scoped HERMES_TOKEN write API via hm-api.js (kill-switch + audit still enforced server-side).
//
// Transport: stateless Streamable HTTP (one transport per request). Auth: bearer MCP_TOKEN.
// Run: node --env-file=.env src/mcp-server.js   (env: DATABASE_URL_READONLY, HERMES_TOKEN, HM_BASE_URL)
import express from 'express'
import { z } from 'zod'
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js'

import {
  searchDeals, getCase, listQueue, getContacts, getRecentActivity,
  getRecentEmails, getSentEmails, getEmailThread, runReadOnlySql, describeSchema,
} from './cases-read.js'
import {
  getAttentionQueue, getDealDocuments, refreshCase, newWorkflow,
  emailIntake, syncJustCall, syncGmail, syncDrive, getDigest, classifyCalls,
  triggerLayer1, triggerLayer2, verifyDealDocs, activeDealsWithDocs,
} from './hm-api.js'

const PORT = Number(process.env.MCP_PORT || 8848)
// Secure by default: bind loopback unless an interface is explicitly chosen. This server exposes
// case PII + write tools, so it must never listen on the public interface unauthenticated.
const HOST = process.env.MCP_HOST || '127.0.0.1'
const TOKEN = process.env.MCP_TOKEN || ''

// Fail closed: binding a WILDCARD (all interfaces, incl. the public IP) without a token would
// expose everything to the internet. Require a token for that, or bind a specific/loopback address.
if ((HOST === '0.0.0.0' || HOST === '::') && !TOKEN) {
  console.error(`[mcp] refusing to bind all interfaces (${HOST}) without MCP_TOKEN. ` +
    `Set MCP_TOKEN, or bind a specific address (e.g. the private docker-bridge IP) instead.`)
  process.exit(1)
}

const server = new McpServer({ name: 'horizonmanager', version: '0.1.0' })

// JSON.stringify can't serialize BigInt (pg int8) — coerce to string.
const jsonReplacer = (_k, v) => (typeof v === 'bigint' ? v.toString() : v)
const ok = (data) => ({
  content: [{ type: 'text', text: typeof data === 'string' ? data : JSON.stringify(data, jsonReplacer, 2) }],
})

// registerTool wrapper: uniform error handling so a thrown query/API error becomes a tool error
// the model can read, not a crashed request.
function tool(name, config, handler) {
  server.registerTool(name, config, async (args) => {
    try {
      return ok(await handler(args ?? {}))
    } catch (e) {
      return { content: [{ type: 'text', text: `error: ${e?.message ?? e}` }], isError: true }
    }
  })
}

const readOnly = { readOnlyHint: true, destructiveHint: false, openWorldHint: false }
const writeHint = { readOnlyHint: false, idempotentHint: true, openWorldHint: false }

// ── Reads (direct read-only Neon) ──────────────────────────────────────────────
tool('search_deals',
  { title: 'Search cases', description: 'Fuzzy-search deals by name, owner, county, or address. Resolves partial/misspelled names. Returns candidates with hubspot_id, name, stage_name, amount.', inputSchema: { query: z.string().min(1).describe('partial name/owner/county/address'), limit: z.number().int().min(1).max(25).optional() }, annotations: readOnly },
  ({ query, limit }) => searchDeals(query, limit ?? 8))

tool('get_case',
  { title: 'Get full case', description: 'Everything about one case in one call: deal (with resolved stage_name), contacts, recent activity, and latest AI analysis. Use the hubspot_id from search_deals.', inputSchema: { deal_id: z.string().describe('deal hubspot_id') }, annotations: readOnly },
  ({ deal_id }) => getCase(deal_id))

tool('list_queue',
  { title: 'Active queue', description: 'Most-recently-touched deals (the active work queue), with stage, amount, last activity, and contact count.', inputSchema: { limit: z.number().int().min(1).max(150).optional() }, annotations: readOnly },
  ({ limit }) => listQueue(limit ?? 50))

tool('get_contacts',
  { title: 'Case contacts', description: 'Contacts for a deal: name, type, ownership status, phones, emails, address.', inputSchema: { deal_id: z.string() }, annotations: readOnly },
  ({ deal_id }) => getContacts(deal_id))

tool('get_recent_activity',
  { title: 'Case activity', description: 'Unified recent activity for a deal (calls + emails + HubSpot engagements), newest first.', inputSchema: { deal_id: z.string(), limit: z.number().int().min(1).max(100).optional() }, annotations: readOnly },
  ({ deal_id, limit }) => getRecentActivity(deal_id, limit ?? 40))

tool('get_recent_emails',
  { title: 'Recent emails (full details)', description: 'Recently received emails WITH full details — time, from, to, subject, triaged importance (notify/digest/noise), and the message body. Use for "what is going on with my emails"; this returns everything in one call (no need to fetch the body separately).', inputSchema: { days: z.number().int().min(1).max(30).optional(), importance: z.enum(['notify', 'digest', 'noise']).optional(), direction: z.enum(['inbound', 'outbound']).optional(), limit: z.number().int().min(1).max(100).optional().describe('default 25; bodies are included so keep it modest') }, annotations: readOnly },
  ({ days, importance, direction, limit }) => getRecentEmails({ days: days ?? 1, importance: importance ?? null, direction: direction ?? 'inbound', limit: limit ?? 25 }))

tool('get_sent_emails',
  { title: 'Sent emails (voice corpus)', description: "Emails Mo SENT (his outbound mail, full text). Use to study his writing voice/tone.", inputSchema: { limit: z.number().int().min(1).max(40).optional() }, annotations: readOnly },
  ({ limit }) => getSentEmails(limit ?? 20))

tool('get_email_thread',
  { title: 'Email thread', description: 'All emails in the same Gmail thread as the given email id, oldest to newest.', inputSchema: { email_id: z.string() }, annotations: readOnly },
  ({ email_id }) => getEmailThread(email_id))

tool('run_sql',
  { title: 'Read-only SQL', description: 'Run ONE read-only SELECT/WITH query (Postgres) against the case database and get rows back. Writes are impossible (read-only role). Add LIMIT for lists; COUNT(*) for totals. Call describe_schema if unsure of columns.', inputSchema: { sql: z.string().describe('a single SELECT or WITH statement') }, annotations: readOnly },
  async ({ sql }) => { const { rows, rowCount, truncated } = await runReadOnlySql(sql); return { rowCount, truncated, rows } })

tool('describe_schema',
  { title: 'Describe schema', description: 'List database tables with their columns, plus enum types and allowed values. Call before writing a run_sql query when unsure.', inputSchema: {}, annotations: readOnly },
  () => describeSchema())

// ── Reads via the dashboard API ────────────────────────────────────────────────
tool('get_attention_queue',
  { title: 'Attention queue (rules engine)', description: 'The dashboard rules-engine output: action buckets (follow_up / move_close / call_today / ready_work / snoozed), per-deal flags, stageMap, pipelineStats. The source of truth for outreach planning.', inputSchema: {}, annotations: readOnly },
  () => getAttentionQueue())

tool('get_deal_documents',
  { title: 'Case documents', description: 'Drive documents linked to a deal (doc types, verification status).', inputSchema: { deal_id: z.string() }, annotations: readOnly },
  ({ deal_id }) => getDealDocuments(deal_id))

// ── Actions / writes (scoped HERMES_TOKEN API — kill-switch + audit enforced server-side) ──
tool('refresh_case',
  { title: 'Refresh case from sources', description: 'Pull the latest for ONE case from HubSpot (Layer 2) + JustCall + Gmail. Freshness-gated (skips if refreshed within 30 min unless force=true).', inputSchema: { deal_id: z.string(), force: z.boolean().optional() }, annotations: { ...writeHint, idempotentHint: false } },
  ({ deal_id, force }) => refreshCase(deal_id, !!force))

tool('create_task',
  { title: 'Create task', description: 'Create an internal task (optionally tied to a deal). Tagged source=hermes, audited.', inputSchema: { title: z.string(), deal_id: z.string().optional(), note: z.string().optional(), due_at: z.string().optional().describe('ISO date/time') }, annotations: writeHint },
  ({ title, deal_id, note, due_at }) => newWorkflow().createTask({ title, dealHubspotId: deal_id ?? null, note: note ?? null, dueAt: due_at ?? null }))

tool('snooze_deal',
  { title: 'Snooze case', description: 'Snooze a deal so it drops out of the attention queue until a date. Audited.', inputSchema: { deal_id: z.string(), until: z.string().optional().describe('ISO date'), reason: z.string().optional(), category: z.string().optional() }, annotations: writeHint },
  ({ deal_id, until, reason, category }) => newWorkflow().snooze(deal_id, { until: until ?? null, reason: reason ?? null, category: category ?? null }))

tool('unsnooze_deal',
  { title: 'Unsnooze case', description: 'Remove a snooze so the deal returns to the attention queue.', inputSchema: { deal_id: z.string() }, annotations: writeHint },
  ({ deal_id }) => newWorkflow().unsnooze(deal_id))

tool('post_analysis',
  { title: 'Append case analysis', description: 'Append an AI interpretation (triage) row for a deal — append-only, never overwrites facts. health/priority validated server-side.', inputSchema: { deal_id: z.string(), health: z.string().optional(), priority: z.string().optional(), status_label: z.string().optional(), next_action: z.string().optional(), blockers: z.array(z.string()).optional(), recommendations: z.array(z.string()).optional(), risks: z.array(z.string()).optional(), mo_action_required: z.boolean().optional() }, annotations: writeHint },
  ({ deal_id, ...a }) => newWorkflow().postAnalysis(deal_id, {
    health: a.health, priority: a.priority, statusLabel: a.status_label, nextAction: a.next_action,
    blockers: a.blockers, recommendations: a.recommendations, risks: a.risks, moActionRequired: a.mo_action_required,
    source: 'hermes', analysisType: 'triage',
  }))

// ── Automation / sync actions (the old bot's scheduled jobs, now callable as tools) ──
// All go through the dashboard API (HERMES_TOKEN, audited). These are what the new Hermes's CRON
// jobs call to replace the old bot's scheduler.
tool('email_intake',
  { title: 'Email intake + triage', description: 'Pull new emails since last sync and triage importance. Returns { fetched, notify[], digest[], noiseCount }. Lead with the notify[] ones — they need attention.', inputSchema: {}, annotations: { ...writeHint, idempotentHint: false } },
  () => emailIntake())

tool('sync_justcall',
  { title: 'Sync JustCall', description: 'Sync call logs from JustCall. mode "full" = incremental since last sync.', inputSchema: { mode: z.enum(['full', 'sample']).optional() }, annotations: writeHint },
  ({ mode }) => syncJustCall(mode ?? 'full'))

tool('sync_gmail',
  { title: 'Sync Gmail', description: 'Sync emails from Gmail. mode "full" = incremental since last sync.', inputSchema: { mode: z.enum(['full', 'sample']).optional() }, annotations: writeHint },
  ({ mode }) => syncGmail(mode ?? 'full'))

tool('sync_drive',
  { title: 'Index Drive', description: 'Re-index the Google Drive case-document folders.', inputSchema: {}, annotations: writeHint },
  () => syncDrive())

tool('sync_layer1',
  { title: 'Sync deal list (Layer 1)', description: 'Daily deal-list sync from HubSpot (2 API calls, all ~150 deals).', inputSchema: {}, annotations: writeHint },
  () => triggerLayer1())

tool('sync_layer2',
  { title: 'Full detail pull (Layer 2)', description: 'Pull full HubSpot detail (contacts + activity) for ONE deal. 5-50+ API calls.', inputSchema: { deal_id: z.string() }, annotations: { ...writeHint, idempotentHint: false } },
  ({ deal_id }) => triggerLayer2(deal_id))

tool('get_digest',
  { title: 'Morning briefing', description: 'Generate the morning briefing as plain text (what needs attention across the portfolio).', inputSchema: {}, annotations: writeHint },
  () => getDigest())

tool('classify_calls',
  { title: 'Transcribe + classify calls', description: 'Transcribe a chunk of un-transcribed answered calls (Whisper + Claude). Returns { processed, failed, remaining, done }. Loop until done=true.', inputSchema: { limit: z.number().int().min(1).max(10).optional() }, annotations: { ...writeHint, idempotentHint: false } },
  ({ limit }) => classifyCalls(limit ?? 4))

tool('active_deals_with_docs',
  { title: 'Active deals w/ docs', description: 'Active (non-terminal) deals that have a Drive folder — the weekly doc-verify candidate set.', inputSchema: {}, annotations: readOnly },
  () => activeDealsWithDocs())

tool('verify_deal_docs',
  { title: 'Verify case documents', description: 'Run document verification for ONE deal (screenshot + Claude Vision). ~25s per deal.', inputSchema: { deal_id: z.string() }, annotations: { ...writeHint, idempotentHint: false } },
  ({ deal_id }) => verifyDealDocs(deal_id))

// ── Stateless Streamable HTTP transport ────────────────────────────────────────
const app = express()
app.use(express.json({ limit: '1mb' }))

app.get('/health', (_req, res) => res.json({ ok: true, server: 'horizonmanager-mcp' }))

function authed(req) {
  if (!TOKEN) return true // no token configured → open (set MCP_TOKEN in prod)
  const h = req.headers['authorization'] || ''
  return h === `Bearer ${TOKEN}`
}

app.post('/mcp', async (req, res) => {
  if (!authed(req)) {
    return res.status(401).json({ jsonrpc: '2.0', error: { code: -32001, message: 'unauthorized' }, id: null })
  }
  // New transport per request — stateless, avoids request-id collisions in HTTP mode.
  const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined, enableJsonResponse: true })
  res.on('close', () => transport.close())
  await server.connect(transport)
  await transport.handleRequest(req, res, req.body)
})

app.listen(PORT, HOST, () => {
  console.error(`[mcp] horizonmanager MCP on http://${HOST}:${PORT}/mcp  (auth: ${TOKEN ? 'bearer' : 'OPEN'})`)
})
