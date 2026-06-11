// Scheduled jobs for Hermes — runs in the bot process (PM2). All times America/New_York,
// confined to the work window (8a–8p) for the cheap syncs; nightly heavy jobs come later.
// Posts to Discord on failure (and a couple of notable successes) if HERMES_SCHEDULE_CHANNEL is set.
import cron from 'node-cron'
import { syncJustCall, syncGmail, syncDrive, triggerLayer2 } from './hm-api.js'
import { dealsWithoutLayer2 } from './cases-read.js'

const TZ = 'America/New_York'

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
    } catch (e) {
      console.error(`[schedule] ${name} FAILED: ${e.message}`)
      await postLine(client, `⚠️ scheduled job **${name}** failed: ${e.message}`)
    }
  }
}

export function startSchedules(client) {
  const jobs = [
    // ── cheap, API-only, work-window ──────────────────────────────────────────
    ['justcall-sync', '0 8-20 * * *', () => syncJustCall()], // hourly, 8a–8p
    ['gmail-sync', '0 8-20/2 * * *', () => syncGmail()], // every 2h, 8a–8p
    ['drive-index', '0 8,14 * * *', () => syncDrive()], // 8a + 2p

    // ── auto Layer 2 for new cases (no contacts yet) ──────────────────────────
    ['layer2-new-cases', '30 8 * * *', async () => {
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
      if (filled > 0) await postLine(client, `🗂️ Layer 2 pulled for ${filled} new case(s).`)
      return { newCasesFilled: filled }
    }],
  ]

  for (const [name, expr, fn] of jobs) {
    cron.schedule(expr, wrap(name, client, fn), { timezone: TZ })
    console.log(`[schedule] registered ${name} (${expr} ${TZ})`)
  }
  console.log(`[schedule] ${jobs.length} jobs scheduled (TZ ${TZ})`)
}
