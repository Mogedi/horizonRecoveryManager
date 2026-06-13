// Research queue drainer. Fires ONE agentic Hermes run per pending request (bounded concurrency).
// Each run: claim (next_research_request) → research per the playbook → submit_evidence_package.
// Hermes is the runtime; this just paces the queue. PM2: hermes-research-worker. Run: npm run research-worker
import { spawn, execSync } from 'node:child_process'
import { createWriteStream, mkdirSync } from 'node:fs'
import { query } from './cases-read.js'
import { submitCost } from './hm-api.js'

// Fallback price table ($/1M tokens) if Hermes didn't compute estimated_cost_usd for a session.
const PRICES = {
  'claude-opus': { in: 5, out: 25 }, 'claude-sonnet': { in: 3, out: 15 }, 'claude-haiku': { in: 1, out: 5 },
}
function estimateUsd(s) {
  const m = String(s.model || '').toLowerCase()
  const p = m.includes('opus') ? PRICES['claude-opus'] : m.includes('haiku') ? PRICES['claude-haiku'] : PRICES['claude-sonnet']
  const inTok = (s.input_tokens || 0) + (s.cache_read_tokens || 0) * 0.1 + (s.cache_write_tokens || 0) * 1.25
  return (inTok * p.in + (s.output_tokens || 0) * p.out) / 1e6
}

const LOG_DIR = process.env.RESEARCH_LOG_DIR || `${process.env.HOME || '/home/mo'}/hermes/logs/research`
try { mkdirSync(LOG_DIR, { recursive: true }) } catch { /* exists */ }

const MAX = Number(process.env.RESEARCH_CONCURRENCY || 2) // concurrent agentic runs (cost/load cap)
const POLL_MS = Number(process.env.RESEARCH_POLL_MS || 20000)
const HERMES = '/opt/hermes/bin/hermes'
const DRAIN_PROMPT =
  'Read /opt/data/research-playbook.md and follow it for exactly ONE request: call ' +
  'next_research_request to claim the next pending request; if it returns null, stop immediately; ' +
  'otherwise research it fully and call submit_evidence_package. Do not loop or claim more than one.'

let container = process.env.RESEARCH_CONTAINER || ''
let active = 0
let ticking = false

const log = (...a) => console.error(`[research-worker ${new Date().toISOString()}]`, ...a)

function findContainer() {
  try {
    return execSync("docker ps --filter name=hermes-agent --filter status=running --format '{{.Names}}'")
      .toString().trim().split('\n')[0] || ''
  } catch { return '' }
}

async function pendingCount() {
  try {
    const r = await query("SELECT count(*)::int AS n FROM research_requests WHERE status='pending'")
    return r[0]?.n ?? 0
  } catch (e) { log('pending query error:', e.message); return 0 }
}

function fireRun() {
  if (!container) container = findContainer()
  if (!container) { log('no running hermes-agent container found'); return }
  active++
  const t0 = Date.now()
  // Raw run output → a per-run host log (deep debug; the user-facing live view is report_progress).
  const logFile = `${LOG_DIR}/run-${t0}.log`
  const out = createWriteStream(logFile, { flags: 'a' })
  log(`firing research run (active=${active}, log=${logFile})`)
  const child = spawn('docker', ['exec', container, HERMES, '-z', DRAIN_PROMPT], { stdio: ['ignore', 'pipe', 'pipe'] })
  child.stdout.pipe(out); child.stderr.pipe(out)
  child.on('exit', (code) => { active--; out.end(); log(`run done (code=${code}, ${Math.round((Date.now() - t0) / 1000)}s, active=${active})`); tick() })
  child.on('error', (e) => { active--; log('spawn error:', e.message) })
}

async function tick() {
  if (ticking) return
  ticking = true
  try {
    while (active < MAX) {
      const n = await pendingCount()
      if (n <= 0 || n <= active) break // runs in flight will claim the rest
      fireRun()
    }
  } finally { ticking = false }
}

// Cost sync — read Hermes's per-session cost (estimated_cost_usd) and record recent CLI runs.
// Deduped server-side by sessionId, so re-posting recent sessions is harmless.
async function costSync() {
  if (!container) { container = findContainer(); if (!container) return }
  try {
    // Recent requests, to link each run's session → request → dossier (so cost shows per dossier).
    let reqs = []
    try {
      reqs = await query("SELECT id, extract(epoch from started_at)*1000 AS started_ms, extract(epoch from finished_at)*1000 AS finished_ms FROM research_requests WHERE started_at > now() - interval '6 hours'")
    } catch { /* ignore — requestId stays null */ }

    execSync(`docker exec ${container} ${HERMES} sessions export /opt/data/_costsync.jsonl`, { stdio: 'ignore' })
    const raw = execSync(`docker exec ${container} cat /opt/data/_costsync.jsonl`).toString()
    const cutoff = Date.now() - 6 * 3600 * 1000
    let synced = 0
    for (const line of raw.split('\n')) {
      if (!line.trim()) continue
      let s
      try { s = JSON.parse(line) } catch { continue }
      if (s.source !== 'cli') continue
      // started_at is a numeric epoch (seconds); ended_at is often null, so filter on started_at.
      const started = s.started_at ? Number(s.started_at) * 1000 : 0
      if (!started || started < cutoff) continue
      if (!s.output_tokens && !s.estimated_cost_usd) continue
      const usd = s.estimated_cost_usd ?? s.actual_cost_usd ?? estimateUsd(s)
      const endMs = s.ended_at ? Date.parse(s.ended_at) : (s.last_active ? Number(s.last_active) * 1000 : 0)
      const runSeconds = endMs > started ? Math.round((endMs - started) / 1000) : 0
      // Match the request whose claim→submit window contains this session's start.
      const m = reqs.find(r => started >= Number(r.started_ms) - 30000 && (r.finished_ms ? started <= Number(r.finished_ms) + 60000 : started <= Date.now()))
      const requestId = m ? Number(m.id) : null
      submitCost({ sessionId: s.id, requestId, model: s.model, inTokens: s.input_tokens || 0, outTokens: s.output_tokens || 0, usd: Number(usd) || 0, runSeconds }).catch(() => {})
      synced++
    }
    if (synced) log(`cost sync: posted ${synced} recent session(s)`)
  } catch (e) { log('costSync error:', e.message) }
}

container = container || findContainer()
log(`up — container=${container || '(auto)'} concurrency=${MAX} poll=${POLL_MS}ms`)
setInterval(tick, POLL_MS)
setInterval(costSync, 120_000) // every 2 min
tick()
costSync()
