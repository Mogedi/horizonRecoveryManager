// Scheduled jobs for Hermes — runs in the bot process (PM2). All times America/New_York,
// confined to the work window (8a–8p) for the cheap syncs; nightly heavy jobs come later.
// The same handlers back the /sync-all command (run everything on demand, back-to-back).
// Posts to Discord on failure (and notable successes) if HERMES_SCHEDULE_CHANNEL is set.
import cron from 'node-cron'
import { syncJustCall, syncGmail, syncDrive, triggerLayer2 } from './hm-api.js'
import { dealsWithoutLayer2 } from './cases-read.js'

const TZ = 'America/New_York'

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

// name → cron expr + handler. Shared by the scheduler and /sync-all.
const JOBS = [
  { name: 'justcall-sync', expr: '0 8-20 * * *', fn: () => syncJustCall() }, // hourly, 8a–8p
  { name: 'gmail-sync', expr: '0 8-20/2 * * *', fn: () => syncGmail() }, // every 2h, 8a–8p
  { name: 'drive-index', expr: '0 8,14 * * *', fn: () => syncDrive() }, // 8a + 2p
  { name: 'layer2-new-cases', expr: '30 8 * * *', fn: () => jobLayer2New() }, // 8:30a
]

async function postLine(client, text) {
  const channelId = process.env.HERMES_SCHEDULE_CHANNEL
  if (!channelId) return
  try {
    const ch = await client.channels.fetch(channelId)
    if (ch?.isTextBased?.()) await ch.send(text)
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
      if (name === 'layer2-new-cases' && r?.newCasesFilled > 0) {
        await postLine(client, `🗂️ Layer 2 pulled for ${r.newCasesFilled} new case(s).`)
      }
    } catch (e) {
      console.error(`[schedule] ${name} FAILED: ${e.message}`)
      await postLine(client, `⚠️ scheduled job **${name}** failed: ${e.message}`)
    }
  }
}

export function startSchedules(client) {
  for (const j of JOBS) {
    cron.schedule(j.expr, wrap(j.name, client, j.fn), { timezone: TZ })
    console.log(`[schedule] registered ${j.name} (${j.expr} ${TZ})`)
  }
  console.log(`[schedule] ${JOBS.length} jobs scheduled (TZ ${TZ})`)
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
