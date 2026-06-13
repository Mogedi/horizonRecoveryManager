// hermes/src/heartbeat.js — a dumb, non-LLM scheduler on the VPS. It ticks the HorizonManager
// sync APIs on a schedule so the database (and therefore the MCP, and therefore Hermes) always has
// fresh data. No Claude in the loop — just HTTP calls — so polling frequency is essentially free.
// Replaces the old Discord bot's scheduler. Run: node --env-file=.env src/heartbeat.js
//
// Config: optional override at hermes/data/heartbeat.json ({ "jobs": [{name,cron,action,enabled}] }).
// data/ persists on the VPS (not clobbered by deploy), so cadence is editable without a code change.
import cron from 'node-cron'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import {
  emailIntake, syncJustCall, syncDrive, triggerLayer1, triggerLayer2,
  classifyCalls, activeDealsWithDocs, verifyDealDocs,
} from './hm-api.js'

const TZ = 'America/New_York'
const __dirname = path.dirname(fileURLToPath(import.meta.url))
const CONFIG_PATH = path.join(__dirname, '..', 'data', 'heartbeat.json')
const MAX_LAYER2_PER_RUN = 40 // safety cap: bound the targeted Layer 2 fan-out per hour

// Activity window 8am-10pm ET for frequent jobs; heavy AI jobs run overnight / weekly.
const DEFAULT_JOBS = [
  { name: 'email',           cron: '*/15 8-22 * * *', action: 'email',          enabled: true },
  { name: 'justcall',        cron: '*/15 8-22 * * *', action: 'justcall',       enabled: true },
  // Quick Layer 1 delta check every 15 min; Layer 2 only the deals that changed in that window.
  { name: 'refresh-changed', cron: '*/15 8-22 * * *', action: 'refreshChanged', enabled: true },
  { name: 'drive-index',     cron: '0 8,14 * * *',    action: 'drive',          enabled: true },
  { name: 'transcribe',      cron: '0 2 * * *',       action: 'transcribe',     enabled: true },
  { name: 'doc-verify',      cron: '0 3 * * 0',       action: 'docVerify',      enabled: true },
]

function log(...a) { console.error(`[heartbeat ${new Date().toISOString()}]`, ...a) }
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

function loadJobs() {
  try {
    if (fs.existsSync(CONFIG_PATH)) {
      const cfg = JSON.parse(fs.readFileSync(CONFIG_PATH, 'utf8'))
      if (Array.isArray(cfg.jobs)) { log(`loaded ${cfg.jobs.length} jobs from heartbeat.json`); return cfg.jobs }
    }
  } catch (e) { log('config parse error, using defaults:', e.message) }
  return DEFAULT_JOBS
}

// ── Actions (each returns a short summary string) ──────────────────────────────
async function actEmail() {
  const r = await emailIntake()
  return `fetched=${r?.fetched ?? 0} notify=${r?.notify?.length ?? 0} digest=${r?.digest?.length ?? 0}`
}
async function actJustcall() {
  const r = await syncJustCall('full')
  const rep = r?.report ?? r ?? {}
  return `calls fetched=${rep.callsFetched ?? '?'} matched=${rep.callsMatched ?? '?'}`
}
async function actDrive() { await syncDrive(); return 'drive indexed' }

// Smart targeted refresh: smart Layer 1 returns the deals modified since last sync; Layer 2 only
// those (capped + paced). Cost scales with activity, not the 150-deal total.
async function actRefreshChanged() {
  const l1 = await triggerLayer1()
  const all = l1?.changedDealIds ?? []
  const ids = all.slice(0, MAX_LAYER2_PER_RUN)
  let pulled = 0, failed = 0
  for (const id of ids) {
    try { await triggerLayer2(id); pulled++ } catch (e) { failed++; log('layer2 fail', id, e.message) }
    await sleep(400) // pace under HubSpot 3 req/s (the dashboard client also throttles)
  }
  const deferred = all.length - ids.length
  return `changed=${all.length} layer2=${pulled} failed=${failed}${deferred > 0 ? ` (capped, ${deferred} deferred)` : ''}`
}

async function actTranscribe() {
  let total = 0
  for (let i = 0; i < 50; i++) { // hard cap so a stuck oversized call can't loop forever
    const r = await classifyCalls(4)
    total += r?.processed ?? 0
    if (r?.done || (r?.remaining ?? 0) === 0) break
    await sleep(500)
  }
  return `transcribed≈${total}`
}
async function actDocVerify() {
  const res = await activeDealsWithDocs()
  const list = Array.isArray(res) ? res : (res?.deals ?? [])
  let done = 0
  for (const d of list.slice(0, 50)) {
    const id = d.hubspotId ?? d.hubspot_id ?? d.id
    try { await verifyDealDocs(id); done++ } catch (e) { log('docverify fail', e.message) }
    await sleep(1000)
  }
  return `verified=${done}/${list.length}`
}

const ACTIONS = {
  email: actEmail, justcall: actJustcall, drive: actDrive,
  refreshChanged: actRefreshChanged, transcribe: actTranscribe, docVerify: actDocVerify,
}

// ── Scheduler with per-job in-flight guard (a long run won't pile up) ───────────
const running = new Set()
async function runJob(job) {
  if (running.has(job.name)) { log(`skip ${job.name} (previous run still going)`); return }
  const fn = ACTIONS[job.action]
  if (!fn) { log(`unknown action: ${job.action}`); return }
  running.add(job.name)
  const t0 = Date.now()
  try { log(`✓ ${job.name} (${Date.now() - t0}ms) ${await fn()}`) }
  catch (e) { log(`✗ ${job.name} (${Date.now() - t0}ms) ${e.message}`) }
  finally { running.delete(job.name) }
}

const jobs = loadJobs().filter((j) => j.enabled)
for (const job of jobs) {
  if (!cron.validate(job.cron)) { log(`invalid cron for ${job.name}: ${job.cron}`); continue }
  cron.schedule(job.cron, () => runJob(job), { timezone: TZ })
  log(`registered ${job.name}: "${job.cron}" → ${job.action}`)
}
log(`heartbeat up — ${jobs.length} job(s), tz=${TZ}`)
