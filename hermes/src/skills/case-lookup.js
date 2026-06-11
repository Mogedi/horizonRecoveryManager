// Skill: case-lookup — find deals and read full case detail. Core, always on.
import { searchDeals, getCase, listQueue } from '../cases-read.js'

function compactCase(c) {
  return {
    deal: {
      hubspot_id: c.deal.hubspot_id, name: c.deal.name, stage: c.deal.stage_name ?? c.deal.stage,
      amount: c.deal.amount, last_activity_date: c.deal.last_activity_date,
    },
    contacts: c.contacts.map((ct) => ({ name: ct.name, type: ct.contact_type, status: ct.ownership_status })),
    recent_activity: c.activity.slice(0, 12).map((a) => ({
      ts: a.ts, source: a.source, type: a.type, outcome: a.outcome,
      note: (a.body || '').replace(/\s+/g, ' ').slice(0, 160),
    })),
    latest_analysis: c.latestAnalysis
      ? {
          health: c.latestAnalysis.health, priority: c.latestAnalysis.priority,
          status: c.latestAnalysis.status_label, blockers: c.latestAnalysis.blockers,
          next_action: c.latestAnalysis.next_action, at: c.latestAnalysis.created_at,
        }
      : null,
  }
}

export default {
  name: 'case-lookup',
  description: 'Find deals/cases by fuzzy name, owner, county, or address; read full case detail; list the active queue.',
  playbook:
    'Resolve partial or misspelled names yourself with search_deals (e.g. "alberta" → the Albertha deal); ' +
    'if several match, summarize the top candidates or ask which one. Never tell Mo to run a slash command to get data.',
  writes: false,
  defaultEnabled: true,
  alwaysOn: true, // core lookup — not subject to router exclusion
  tools: [
    {
      name: 'search_deals',
      description:
        'Find deals by a partial, fuzzy, or misspelled name/owner/county/address. Returns candidates with hubspot_id. Use first whenever Mo names a case by anything but an exact id.',
      input_schema: {
        type: 'object',
        properties: { query: { type: 'string', description: 'name, owner, county, or address fragment' } },
        required: ['query'],
      },
    },
    {
      name: 'get_case',
      description:
        'Full detail for one deal: stage, amount, contacts, recent activity, and latest AI analysis. Needs the hubspot_id from search_deals or list_active_deals.',
      input_schema: {
        type: 'object',
        properties: { deal_id: { type: 'string', description: 'the deal hubspot_id' } },
        required: ['deal_id'],
      },
    },
    {
      name: 'list_active_deals',
      description: 'List the active deal queue (most recently touched first).',
      input_schema: { type: 'object', properties: {} },
    },
  ],
  handlers: {
    search_deals: async (input) => {
      const rows = await searchDeals(String(input.query ?? ''))
      return rows.length ? rows : 'no matching deals — try a different spelling or list_active_deals'
    },
    list_active_deals: async () => {
      const rows = await listQueue(40)
      return rows.map((r) => ({ hubspot_id: r.hubspot_id, name: r.name, stage: r.stage, amount: r.amount }))
    },
    get_case: async (input) => compactCase(await getCase(String(input.deal_id ?? ''))),
  },
}
