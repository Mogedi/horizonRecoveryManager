// Skill: data-sync — pull fresh data on demand. Refresh a single case from HubSpot (Layer 2) and
// read it back, or run a source sync (calls / emails / drive / deal-list) as a full or quick pull.
import { syncJustCall, syncGmail, syncDrive, triggerLayer1, refreshCase } from '../hm-api.js'
import { runAllSyncs } from '../schedules.js'

function compact(r) {
  if (!r || typeof r !== 'object') return r
  const rep = r.report ?? r
  const keep = ['mode', 'messagesFetched', 'messagesMatched', 'bodiesFetched', 'callsFetched', 'callsMatched', 'dealsUpdated', 'dealsMatched', 'newCasesFilled', 'foldersScanned']
  const out = {}
  for (const k of keep) if (rep[k] !== undefined) out[k] = rep[k]
  return Object.keys(out).length ? out : rep
}

export default {
  name: 'data-sync',
  description: 'Pull fresh data on demand: refresh one case from HubSpot (then read the latest), or run a sync of calls / emails / Drive / the deal list as a full or quick pull.',
  playbook:
    'refresh_case: pull the LATEST HubSpot detail for one deal (updates the DB), THEN read it back with ' +
    'get_case and tell Mo what\'s current/changed. Use this whenever Mo wants up-to-date info on a specific case.\n' +
    'sync_data: source = justcall | gmail | drive | deals. mode = "full" (complete/incremental pull) or ' +
    '"sample" (quick, recent only). justcall/gmail full are incremental and cheap — run them directly. ' +
    'CONFIRM before source="deals" (refreshes all ~150 deals) and before sync_all (runs everything). ' +
    'Always report what was pulled (counts) afterward. Note these hit HubSpot/Google rate limits, so don\'t ' +
    'run big pulls repeatedly.',
  writes: true,
  defaultEnabled: true,
  tools: [
    {
      name: 'refresh_case',
      description: "Pull the LATEST for one deal from all 3 sources (HubSpot Layer 2 + that deal's JustCall calls + that deal's Gmail) into the DB. Freshness-gated: skips if refreshed in the last 30 min unless force=true. Needs the deal's hubspot_id; after it returns, read with get_case.",
      input_schema: {
        type: 'object',
        properties: {
          deal_id: { type: 'string', description: 'the deal hubspot_id' },
          force: { type: 'boolean', description: 'force a re-pull even if refreshed recently' },
        },
        required: ['deal_id'],
      },
    },
    {
      name: 'sync_data',
      description: 'Run a data sync. source: justcall | gmail | drive | deals (deals = refresh the whole deal list/Layer 1). mode: full or sample (sample = quick recent pull; ignored for drive/deals).',
      input_schema: {
        type: 'object',
        properties: {
          source: { type: 'string', enum: ['justcall', 'gmail', 'drive', 'deals'] },
          mode: { type: 'string', enum: ['full', 'sample'], description: 'full or quick/sample (default full)' },
        },
        required: ['source'],
      },
    },
    {
      name: 'sync_all',
      description: 'Run all the routine syncs back-to-back (JustCall, Gmail, Drive, new-case Layer 2). Confirm with Mo first — it hits several APIs.',
      input_schema: { type: 'object', properties: {} },
    },
  ],
  handlers: {
    refresh_case: async (input) => {
      if (!input.deal_id) return 'a deal hubspot_id is required'
      const r = await refreshCase(input.deal_id, !!input.force)
      return r.skipped
        ? { refreshed: input.deal_id, skipped: true, reason: 'already fresh (refreshed <30 min ago)', next: 'read with get_case' }
        : { refreshed: input.deal_id, hubspot: compact(r.hubspot), calls: compact(r.calls), emails: compact(r.emails), next: 'now call get_case to read the latest' }
    },
    sync_data: async (input) => {
      const mode = input.mode === 'sample' ? 'sample' : 'full'
      switch (input.source) {
        case 'justcall': return { source: 'justcall', mode, result: compact(await syncJustCall(mode)) }
        case 'gmail': return { source: 'gmail', mode, result: compact(await syncGmail(mode)) }
        case 'drive': return { source: 'drive', result: compact(await syncDrive()) }
        case 'deals': return { source: 'deals', result: compact(await triggerLayer1()) }
        default: return `unknown source "${input.source}" (use justcall, gmail, drive, or deals)`
      }
    },
    sync_all: async () => {
      const results = await runAllSyncs()
      return results.map((r) => ({ job: r.name, ok: r.ok, detail: compact(r.detail) }))
    },
  },
}
