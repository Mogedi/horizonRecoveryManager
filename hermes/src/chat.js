// Conversational Hermes — free-text chat backed by Claude with READ-ONLY skill tools.
// Skills are loaded progressively: a cheap Haiku router picks the relevant (enabled) skills for
// each message and only their tools are loaded; the model can load_skill(...) more mid-turn.
// Cost-aware: defaults to Haiku (cheap); escalates to Sonnet on request. Reports per-message cost.
import Anthropic from '@anthropic-ai/sdk'
import { appendFile } from 'node:fs/promises'
import {
  getEnabledSkills, alwaysOnSkills, assembleTools, skillMenu, getSkill,
} from './skills/registry.js'
import { routeSkills } from './skills/router.js'
import { recall } from './memory.js'

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

const SYSTEM_BASE =
  'You are Hermes, the operations assistant for Horizon Recovery LLC, a surplus-funds recovery firm. ' +
  'You help Mo (the owner) manage cases and operations.\n\n' +
  'You work through SKILLS — bundles of tools. Use the tools you have to answer directly from real data; ' +
  'NEVER tell Mo to run a slash command to get information. Be concise and practical.\n\n' +
  'If a message from Mo contains action items or things he needs to do, proactively offer to capture them ' +
  'as tasks (load the task-manager skill if it isn\'t active) — list what you\'d add and let him confirm.\n\n' +
  'If a request is ambiguous, underspecified, or could be destructive/irreversible, ask ONE brief ' +
  'clarifying question before acting rather than guessing.\n\n' +
  'You have long-term memory: when Mo states a durable preference or fact worth keeping, save it with the ' +
  'memory skill. Relevant memories are provided to you automatically below.\n\n' +
  'You read facts and AI interpretation; you never touch HubSpot or business facts directly and never ' +
  'move money. To WRITE a triage analysis, Mo uses /triage (Apply-to-confirm) — you can summarize a case ' +
  'and what you would conclude, but you do not write.'

const LOAD_SKILL_TOOL = {
  name: 'load_skill',
  description:
    'Load another skill\'s tools when the current ones can\'t answer the message. Pass a skill name from the ' +
    '"Other skills you can load" menu. After loading, its tools become available to call.',
  input_schema: {
    type: 'object',
    properties: { skill: { type: 'string', description: 'the skill name to load' } },
    required: ['skill'],
  },
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

function buildSystem(model, activeSkills, loadableSkills, memories) {
  const playbooks = activeSkills.flatMap((s) => (s.playbook ? [`[${s.name}] ${s.playbook}`] : []))
  const parts = [SYSTEM_BASE]
  if (memories?.length) {
    parts.push('What you remember about Mo (long-term memory):\n' + memories.map((m) => `- ${m.content}`).join('\n'))
  }
  if (playbooks.length) parts.push('Active skill playbooks:\n' + playbooks.join('\n'))
  if (loadableSkills.length) {
    parts.push('Other skills you can load with load_skill if needed:\n' + skillMenu(loadableSkills))
  }
  parts.push(`You are currently running on the ${model} model. If Mo asks what model you're using, tell him honestly.`)
  return parts.join('\n\n')
}

// Returns { text, model, usage, costUSD, skills }.
// images: optional array of public image URLs (e.g. Discord attachments) — Hermes sees them natively.
export async function chat(channelId, userText, images = []) {
  const model = pickModel(userText)
  // Passive recall: surface relevant long-term memories into context every turn.
  const memories = await recall(userText, 8).catch(() => [])
  const usage = { input_tokens: 0, output_tokens: 0, cache_creation_input_tokens: 0, cache_read_input_tokens: 0 }
  const addUsage = (u) => { if (u) for (const k of Object.keys(usage)) usage[k] += u[k] || 0 }

  // 1. Which skills are enabled (Mo's persisted on/off), split into always-on + routable.
  const enabled = await getEnabledSkills()
  const alwaysOn = alwaysOnSkills(enabled)
  const routable = enabled.filter((s) => !s.alwaysOn)

  // 2. Cheap router picks the relevant routable skills for this message.
  const routed = await routeSkills(userText, routable)
  addUsage(routed.usage)
  const selectedNames = new Set(routed.names)

  // 3. Active set = always-on + router-selected. The rest stay loadable via load_skill.
  const active = [...alwaysOn, ...routable.filter((s) => selectedNames.has(s.name))]
  const activeNames = new Set(active.map((s) => s.name))
  const loadable = enabled.filter((s) => !activeNames.has(s.name))

  let { tools, handlers, serverTools } = assembleTools(active)
  const loadedNames = new Set(active.map((s) => s.name))
  let searchCount = 0

  // Vision: attach image URLs (Discord attachments) so Claude sees them natively in this turn.
  const imageBlocks = (images || [])
    .filter((u) => typeof u === 'string')
    .slice(0, 6)
    .map((url) => ({ type: 'image', source: { type: 'url', url } }))
  const userContent = imageBlocks.length ? [...imageBlocks, { type: 'text', text: userText }] : userText
  const messages = [...getHistory(channelId), { role: 'user', content: userContent }]
  let finalText = '(no response)'

  for (let i = 0; i < 8; i++) {
    const loadableNow = enabled.filter((s) => !loadedNames.has(s.name))
    const allTools = [...tools, ...serverTools, ...(loadableNow.length ? [LOAD_SKILL_TOOL] : [])]
    const system = buildSystem(model, active, loadableNow, memories)

    const res = await anthropic().messages.create({ model, max_tokens: 1500, system, tools: allTools, messages })
    addUsage(res.usage)
    searchCount += res.usage?.server_tool_use?.web_search_requests || 0

    // Server tool (web_search) is mid-flight — echo the content back to let Claude continue.
    if (res.stop_reason === 'pause_turn') {
      messages.push({ role: 'assistant', content: res.content })
      continue
    }

    if (res.stop_reason === 'tool_use') {
      messages.push({ role: 'assistant', content: res.content })
      const results = []
      for (const block of res.content) {
        if (block.type !== 'tool_use') continue // skips text + server_tool_use + web_search_tool_result
        let out
        try {
          if (block.name === 'load_skill') {
            const skill = getSkill(String(block.input?.skill ?? ''))
            if (skill && enabled.includes(skill) && !loadedNames.has(skill.name)) {
              const merged = assembleTools([skill])
              tools = [...tools, ...merged.tools]
              serverTools = [...serverTools, ...merged.serverTools]
              Object.assign(handlers, merged.handlers)
              active.push(skill)
              loadedNames.add(skill.name)
              const added = [...merged.tools.map((t) => t.name), ...merged.serverTools.map((t) => t.name)]
              out = `loaded skill "${skill.name}" — now available: ${added.join(', ')}`
            } else {
              out = `cannot load skill "${block.input?.skill}" (unknown or disabled)`
            }
          } else if (handlers[block.name]) {
            out = await handlers[block.name](block.input || {})
          } else {
            out = `unknown tool: ${block.name}`
          }
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

  // Token cost + web-search server-tool cost (~$0.01/search).
  const costUSD = estimateCostUSD(model, usage) + searchCount * 0.01
  const skillsUsed = [...loadedNames]
  await logUsage({
    ts: new Date().toISOString(), channel: channelId, model, skills: skillsUsed,
    in: usage.input_tokens, out: usage.output_tokens,
    cache_read: usage.cache_read_input_tokens, searches: searchCount, cost: costUSD,
  })

  return { text: finalText, model, usage, costUSD, skills: skillsUsed, searches: searchCount }
}
