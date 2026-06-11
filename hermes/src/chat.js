// Conversational Hermes — free-text chat backed by Claude with READ-ONLY tools, so it answers
// questions from real case data (resolving fuzzy names) instead of deferring to slash commands.
// Cost-aware: defaults to Haiku (cheap); escalates to Sonnet on request. Reports per-message cost.
import Anthropic from '@anthropic-ai/sdk'
import { appendFile } from 'node:fs/promises'
import { searchDeals, getCase, listQueue, getSentEmails } from './cases-read.js'

// $ per 1M tokens (input / output). Used for rough per-message cost estimates.
const PRICING = {
  'claude-haiku-4-5': { in: 1, out: 5 },
  'claude-sonnet-4-6': { in: 3, out: 15 },
}
const DEFAULT_CHAT_MODEL = process.env.HERMES_CHAT_MODEL || 'claude-haiku-4-5'

// Default to Haiku; let Mo escalate per-message ("use sonnet") or force back ("use haiku").
function pickModel(userText) {
  if (/\buse sonnet\b/i.test(userText)) return 'claude-sonnet-4-6'
  if (/\buse haiku\b/i.test(userText)) return 'claude-haiku-4-5'
  return DEFAULT_CHAT_MODEL
}

function estimateCostUSD(model, u) {
  const p = PRICING[model] || PRICING['claude-sonnet-4-6']
  const inTok =
    (u.input_tokens || 0) +
    (u.cache_creation_input_tokens || 0) * 1.25 +
    (u.cache_read_input_tokens || 0) * 0.1
  return (inTok * p.in + (u.output_tokens || 0) * p.out) / 1e6
}

let client
function anthropic() {
  if (!client) {
    if (!process.env.ANTHROPIC_API_KEY) throw new Error('ANTHROPIC_API_KEY not set')
    client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY })
  }
  return client
}

const SYSTEM =
  'You are Hermes, the operations assistant for Horizon Recovery LLC, a surplus-funds recovery firm. ' +
  'You help Mo (the owner) manage cases and operations.\n\n' +
  'You have tools to look up real data — USE them to answer directly. Resolve partial or misspelled ' +
  'names yourself with search_deals (e.g. "alberta" → the Albertha deal); if several match, summarize ' +
  'the top candidates or ask which one. NEVER tell Mo to run a slash command to get information — fetch ' +
  'it with your tools. Be concise and practical.\n\n' +
  'You CAN read the emails Mo has sent — use get_sent_emails to study his writing style/tone or to ' +
  'see how he phrases things (e.g. for drafting in his voice). Never claim you lack email access.\n\n' +
  'You read facts and AI interpretation; you never touch HubSpot or business facts directly and never ' +
  'move money. To WRITE a triage analysis, Mo uses /triage (which has an Apply-to-confirm button) — you ' +
  'can summarize a case and what you would conclude, but you do not write.'

const tools = [
  {
    name: 'search_deals',
    description:
      'Find deals by a partial, fuzzy, or misspelled name/owner/county/address. Returns candidate deals with their hubspot_id. Use this first whenever Mo names a case by anything other than an exact id.',
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
  {
    name: 'get_sent_emails',
    description:
      "Emails Mo SENT (his own outbound mail, with full text). Use this to study or infer his writing " +
      "style and tone, or to see how he phrases things. Returns date, subject, recipient, and body.",
    input_schema: {
      type: 'object',
      properties: { limit: { type: 'number', description: 'how many recent sent emails (default 20, max 40)' } },
    },
  },
]

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

async function runTool(name, input) {
  if (name === 'search_deals') {
    const rows = await searchDeals(String(input.query ?? ''))
    return rows.length ? rows : 'no matching deals — try a different spelling or list_active_deals'
  }
  if (name === 'list_active_deals') {
    const rows = await listQueue(40)
    return rows.map((r) => ({ hubspot_id: r.hubspot_id, name: r.name, stage: r.stage, amount: r.amount }))
  }
  if (name === 'get_case') {
    return compactCase(await getCase(String(input.deal_id ?? '')))
  }
  if (name === 'get_sent_emails') {
    const lim = Math.min(Math.max(Number(input.limit) || 20, 1), 40)
    const rows = await getSentEmails(lim)
    return rows.length
      ? rows.map((r) => ({
          date: r.ts, subject: r.subject, to: r.recipient,
          body: (r.body || '').replace(/\s+/g, ' ').trim(),
        }))
      : 'no sent emails with full body stored yet'
  }
  return `unknown tool: ${name}`
}

// Per-channel rolling history (final text only) for continuity. In-memory; resets on restart.
const histories = new Map()
function getHistory(channelId) {
  return histories.get(channelId) ?? []
}
function pushHistory(channelId, role, content) {
  const h = getHistory(channelId)
  h.push({ role, content })
  while (h.length > 10) h.shift()
  histories.set(channelId, h)
}

// Best-effort usage log for a future /usage command. Never fails the chat.
async function logUsage(entry) {
  try {
    await appendFile(new URL('../logs/usage.jsonl', import.meta.url), JSON.stringify(entry) + '\n')
  } catch {
    /* ignore */
  }
}

// Returns { text, model, usage, costUSD }.
export async function chat(channelId, userText) {
  const model = pickModel(userText)
  const system = `${SYSTEM}\n\nYou are currently running on the ${model} model. If Mo asks what model you're using, tell him honestly.`
  const messages = [...getHistory(channelId), { role: 'user', content: userText }]
  const usage = { input_tokens: 0, output_tokens: 0, cache_creation_input_tokens: 0, cache_read_input_tokens: 0 }
  let finalText = '(no response)'

  for (let i = 0; i < 6; i++) {
    const res = await anthropic().messages.create({ model, max_tokens: 1500, system, tools, messages })
    for (const k of Object.keys(usage)) usage[k] += res.usage?.[k] || 0

    if (res.stop_reason === 'tool_use') {
      messages.push({ role: 'assistant', content: res.content })
      const results = []
      for (const block of res.content) {
        if (block.type !== 'tool_use') continue
        let out
        try {
          out = await runTool(block.name, block.input || {})
        } catch (e) {
          out = `error: ${e.message}`
        }
        results.push({
          type: 'tool_result',
          tool_use_id: block.id,
          content: typeof out === 'string' ? out : JSON.stringify(out),
        })
      }
      messages.push({ role: 'user', content: results })
      continue
    }

    finalText = res.content.filter((b) => b.type === 'text').map((b) => b.text).join('\n').trim() || '(no response)'
    break
  }

  pushHistory(channelId, 'user', userText)
  pushHistory(channelId, 'assistant', finalText)

  const costUSD = estimateCostUSD(model, usage)
  await logUsage({
    ts: new Date().toISOString(), channel: channelId, model,
    in: usage.input_tokens, out: usage.output_tokens,
    cache_read: usage.cache_read_input_tokens, cost: costUSD,
  })

  return { text: finalText, model, usage, costUSD }
}
