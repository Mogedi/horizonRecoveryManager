// Research queue drainer. Fires ONE agentic Hermes run per pending request (bounded concurrency).
// Each run: claim (next_research_request) → research per the playbook → submit_evidence_package.
// Hermes is the runtime; this just paces the queue. PM2: hermes-research-worker. Run: npm run research-worker
import { spawn, execSync } from 'node:child_process'
import { query } from './cases-read.js'

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
  log(`firing research run (active=${active})`)
  const child = spawn('docker', ['exec', container, HERMES, '-z', DRAIN_PROMPT], { stdio: 'ignore' })
  child.on('exit', (code) => { active--; log(`run done (code=${code}, ${Math.round((Date.now() - t0) / 1000)}s, active=${active})`); tick() })
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

container = container || findContainer()
log(`up — container=${container || '(auto)'} concurrency=${MAX} poll=${POLL_MS}ms`)
setInterval(tick, POLL_MS)
tick()
