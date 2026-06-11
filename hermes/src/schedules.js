// Scheduled jobs for Hermes — runs in the bot process (PM2). All times America/New_York.
// Cheap syncs run in the work window (8a–8p); heavy jobs run off-hours (transcription nightly,
// doc-verification weekly) plus a morning digest at 7:45a.
// The work-window syncs also back the /sync-all command (run everything on demand, back-to-back).
// Posts to Discord on failure (and notable successes) if HERMES_SCHEDULE_CHANNEL is set.
import cron from 'node-cron'
import {
  syncJustCall, syncGmail, syncDrive, triggerLayer2,
  classifyCalls, activeDealsWithDocs, verifyDealDocs, getDigest,
} from './hm-api.js'
import { dealsWithoutLayer2 } from './cases-read.js'

const TZ = 'America/New_York'
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

async function jobLayer2New() {
  const todo = await dealsWithoutLayer2()
  let filled = 0
  for (const d of todo) {
    try {
      await triggerLayer2(d.hubspot_id)
      filled++
    } catch (e) {
      console.error(`[schedule] layer2 ${d.hubspot_id} failed: ${e.message}`)
    }
    await new Promise((r) => setTimeout(r, 500)) // pace HubSpot calls
  }
  return { newCasesFilled: filled }
}

// ── Heavy jobs (off-hours) ──────────────────────────────────────────────────────

// Transcribe + classify every un-transcribed answered call. Loops the chunked endpoint
// (each call stays under the Vercel 60s budget) until the queue is drained. Loop-safe:
// `remaining` strictly decreases (oversized/no-recording calls become error rows and drop out).
async function jobTranscribeCalls() {
  let processed = 0, failed = 0, iter = 0
  const cls = {}
  const MAX_ITERS = 200 // backstop; ~4 calls/iter → up to 800 calls/night
  while (iter++ < MAX_ITERS) {
    const r = await classifyCalls(4)
    processed += r.processed ?? 0
    failed += r.failed ?? 0
    for (const [k, v] of Object.entries(r.classifications ?? {})) cls[k] = (cls[k] ?? 0) + v
    if (r.done) break
    await sleep(500)
  }
  const summary = Object.entries(cls).map(([k, v]) => `${v} ${k}`).join(', ') || 'none'
  const post = processed > 0 || failed > 0
    ? `🎙️ Transcribed ${processed} call(s) (${summary})${failed ? `, ${failed} skipped` : ''}.`
    : null
  return { processed, failed, classifications: cls, post }
}

// Verify Drive docs are linked in HubSpot for every active (non-terminal) case. Playwright +
// Claude Vision, one deal per request (~25s). Weekly — docs don't change nightly.
async function jobVerifyDocs() {
  const { deals = [] } = (await activeDealsWithDocs()) ?? {}
  let checked = 0, linked = 0, missing = 0, failed = 0
  for (const d of deals) {
    try {
      const r = await verifyDealDocs(d.hubspotId)
      checked++
      if (r?.missingFiles?.length) missing++
      else if (r?.filesLinked) linked++
    } catch (e) {
      failed++
      console.error(`[schedule] doc-verify ${d.hubspotId} failed: ${e.message}`)
    }
    await sleep(1500) // pace the browser automation
  }
  const post = checked > 0 || failed > 0
    ? `📎 Doc check: ${checked} case(s) verified — ${linked} fully linked, ${missing} missing docs${failed ? `, ${failed} errored` : ''}.`
    : null
  return { checked, linked, missing, failed, post }
}

// 7:45a morning briefing → Discord.
async function jobMorningDigest() {
  const r = await getDigest()
  const text = (r?.text ?? '').trim()
  return { post: text ? `☀️ **Morning briefing**\n${text}` : null }
}

// name → cron expr + handler + human description. Shared by the scheduler and /sync-all.
const JOBS = [
  { name: 'justcall-sync', expr: '0 8-20 * * *', when: 'hourly, 8am–8pm ET', what: 'pull new JustCall logs', fn: () => syncJustCall() },
  { name: 'gmail-sync', expr: '0 8-20/2 * * *', when: 'every 2 hours, 8am–8pm ET', what: 'pull new Gmail', fn: () => syncGmail() },
  { name: 'drive-index', expr: '0 8,14 * * *', when: '8am & 2pm ET', what: 'index Drive folders', fn: () => syncDrive() },
  { name: 'layer2-new-cases', expr: '30 8 * * *', when: '8:30am ET daily', what: 'pull Layer 2 detail for new cases', fn: () => jobLayer2New() },
]

// Heavy jobs — off-hours, separate cadence. NOT part of /sync-all (which is the work-window syncs).
const HEAVY_JOBS = [
  { name: 'morning-digest', expr: '45 7 * * *', when: '7:45am ET daily', what: 'post the morning briefing', fn: () => jobMorningDigest() },
  { name: 'transcribe-calls', expr: '0 2 * * *', when: '2am ET daily', what: 'transcribe + classify new calls', fn: () => jobTranscribeCalls() },
  { name: 'verify-docs', expr: '0 3 * * 0', when: 'Sundays 3am ET (weekly)', what: 'verify case docs are linked in HubSpot', fn: () => jobVerifyDocs() },
]

// In-memory record of the most recent run per job (for "did the digest run?" questions).
// Resets on restart — durable history lives in the PM2 logs.
const lastRuns = {}
export function getSchedules() {
  return [...JOBS, ...HEAVY_JOBS].map((j) => ({ name: j.name, when: j.when, what: j.what, expr: j.expr }))
}
export function getLastRuns() {
  return lastRuns
}

// Resolve HERMES_SCHEDULE_CHANNEL as a channel ID OR a channel name (e.g. "hermes_schedule_channel").
// Returns the channel or null. Name resolution avoids the "hunt the snowflake ID" trap.
async function resolveScheduleChannel(client) {
  const ref = process.env.HERMES_SCHEDULE_CHANNEL
  if (!ref) return null
  try {
    const byId = await client.channels.fetch(ref)
    if (byId?.isTextBased?.()) return byId
  } catch {
    /* not an id — try by name */
  }
  for (const guild of client.guilds.cache.values()) {
    const ch = guild.channels.cache.find((c) => c.name === ref && c.isTextBased?.())
    if (ch) return ch
  }
  return null
}

async function postLine(client, text) {
  const ch = await resolveScheduleChannel(client)
  if (!ch) {
    console.warn(`[schedule] no schedule channel — dropping message: ${String(text).slice(0, 80)}`)
    return
  }
  try {
    await ch.send(text)
  } catch (e) {
    console.error(`[schedule] could not post to Discord: ${e.message}`)
  }
}

function wrap(name, client, fn) {
  return async () => {
    const t0 = Date.now()
    try {
      const r = await fn()
      console.log(`[schedule] ${name} ok (${Date.now() - t0}ms)`, r ? JSON.stringify(r).slice(0, 200) : '')
      lastRuns[name] = { at: new Date().toISOString(), ok: true, ms: Date.now() - t0, summary: r?.post ?? JSON.stringify(r ?? {}).slice(0, 160) }
      // Jobs that want to announce a result return a `post` string; post it if present.
      if (r?.post) await postLine(client, r.post)
      else if (name === 'layer2-new-cases' && r?.newCasesFilled > 0) {
        await postLine(client, `🗂️ Layer 2 pulled for ${r.newCasesFilled} new case(s).`)
      }
    } catch (e) {
      console.error(`[schedule] ${name} FAILED: ${e.message}`)
      lastRuns[name] = { at: new Date().toISOString(), ok: false, ms: Date.now() - t0, summary: `FAILED: ${e.message}` }
      await postLine(client, `⚠️ scheduled job **${name}** failed: ${e.message}`)
    }
  }
}

export function startSchedules(client) {
  for (const j of [...JOBS, ...HEAVY_JOBS]) {
    cron.schedule(j.expr, wrap(j.name, client, j.fn), { timezone: TZ })
    console.log(`[schedule] registered ${j.name} (${j.expr} ${TZ})`)
  }
  console.log(`[schedule] ${JOBS.length + HEAVY_JOBS.length} jobs scheduled (TZ ${TZ})`)

  // Startup diagnostic: confirm posts will actually land, so a missing channel can't fail silently.
  resolveScheduleChannel(client).then((ch) => {
    if (ch) console.log(`[schedule] posting notifications to #${ch.name} (${ch.id})`)
    else {
      const ref = process.env.HERMES_SCHEDULE_CHANNEL
      console.warn(
        `[schedule] HERMES_SCHEDULE_CHANNEL ${ref ? `"${ref}" did not resolve to a channel` : 'is NOT set'} — ` +
        `jobs will run but notifications won't post to Discord.`
      )
    }
  })
}

// Expose heavy-job handlers for manual triggering (e.g. a Discord command or /sync-all variant).
export const heavyJobs = HEAVY_JOBS

// Run the morning digest on demand and post it to the schedule channel. Returns the text (or null).
// Backs the /digest command — also serves as a live check that channel posting works.
export async function postDigestNow(client) {
  const r = await jobMorningDigest()
  if (r?.post) await postLine(client, r.post)
  return r?.post ?? null
}

// Run every sync job back-to-back, in order. Returns [{name, ok, detail}].
export async function runAllSyncs() {
  const results = []
  for (const j of JOBS) {
    try {
      results.push({ name: j.name, ok: true, detail: await j.fn() })
    } catch (e) {
      results.push({ name: j.name, ok: false, detail: e.message })
    }
  }
  return results
}
