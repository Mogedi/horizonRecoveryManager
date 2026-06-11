// Skill: outreach-planner — turn the attention queue into a prioritized action list.
// Sources the dashboard's real rules engine (GET /api/deals), so business-day staleness,
// calls-exhausted (7+ unique call days), agreement-stale, etc. are all computed correctly here.
import { getAttentionQueue } from '../hm-api.js'

const BUCKET_LABEL = {
  follow_up: 'Follow up (needs your response)',
  move_close: 'Move or close (blocked)',
  call_today: 'Call today (in the calling cycle)',
  ready_work: 'Ready to work (new, no blockers)',
  snoozed: 'Snoozed',
}

function compactFlagged(r, stageMap) {
  return {
    hubspot_id: r.deal.hubspotId,
    name: r.deal.name,
    stage: stageMap?.[r.deal.stage] ?? r.deal.stage,
    amount: r.deal.amount,
    flags: (r.flags || []).map((f) => f.type),
    reasons: (r.flags || []).map((f) => f.message).filter(Boolean),
  }
}

export default {
  name: 'outreach-planner',
  description: 'Plan daily outreach: who to call/follow-up today, deals stalling, and calls-exhausted cases to close or skip-trace.',
  playbook:
    'Use outreach_overview for the high-level "what should I focus on". Use calls_today for the prioritized ' +
    'action list (follow-ups + active-calling deals with the reason each is flagged). Use calls_exhausted for ' +
    'deals called 7+ days with no traction — those need a close/skip-trace decision, not another call. ' +
    'Always lead with the highest-value, most-overdue deals; be concrete (name, amount, why).',
  writes: false,
  defaultEnabled: true,
  tools: [
    {
      name: 'outreach_overview',
      description: 'High-level outreach picture: how many deals sit in each action bucket (follow-up, move/close, call-today, ready-to-work) plus key pipeline stats.',
      input_schema: { type: 'object', properties: {} },
    },
    {
      name: 'calls_today',
      description: "Today's prioritized action list — deals needing a follow-up or that are in the active calling cycle, with the reason each is flagged and the amount at stake.",
      input_schema: { type: 'object', properties: {} },
    },
    {
      name: 'calls_exhausted',
      description: 'Deals called 7+ unique days with no traction (calls_exhausted flag) — candidates to close or skip-trace rather than call again.',
      input_schema: { type: 'object', properties: {} },
    },
  ],
  handlers: {
    outreach_overview: async () => {
      const q = await getAttentionQueue()
      const counts = {}
      for (const [bucket, list] of Object.entries(q.groups || {})) {
        counts[BUCKET_LABEL[bucket] ?? bucket] = list.length
      }
      return { total_deals: q.totalDeals, buckets: counts, pipeline: q.pipelineStats ?? null }
    },
    calls_today: async () => {
      const q = await getAttentionQueue()
      const list = [...(q.groups?.follow_up ?? []), ...(q.groups?.call_today ?? [])]
      const rows = list.map((r) => compactFlagged(r, q.stageMap))
      // Highest amount first as a simple value-weighted priority.
      rows.sort((a, b) => (b.amount || 0) - (a.amount || 0))
      return rows.length ? rows : 'nothing due today — queue is clear'
    },
    calls_exhausted: async () => {
      const q = await getAttentionQueue()
      const all = Object.values(q.groups || {}).flat()
      const rows = all
        .filter((r) => (r.flags || []).some((f) => f.type === 'calls_exhausted'))
        .map((r) => compactFlagged(r, q.stageMap))
      return rows.length ? rows : 'no calls-exhausted deals right now'
    },
  },
}
