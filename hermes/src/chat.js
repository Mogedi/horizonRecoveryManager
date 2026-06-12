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
import { renderStyleSheet } from './email-style.js'
import { getStageMap } from './cases-read.js'

// $ per 1M tokens (input / output). Used for rough per-message cost estimates.
const PRICING = {
  'claude-haiku-4-5': { in: 1, out: 5 },
  'claude-sonnet-4-6': { in: 3, out: 15 },
}
const DEFAULT_CHAT_MODEL = process.env.HERMES_CHAT_MODEL || 'claude-haiku-4-5'
// Drafting/understanding email always uses a stronger model (quality + no "dumb" mistakes).
const DRAFT_MODEL = process.env.HERMES_DRAFT_MODEL || 'claude-sonnet-4-6'

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

// Per-channel/thread rolling history (final text only) for continuity. In-memory; resets on restart
// (threads rebuild from Discord on miss — see bot.js).
const histories = new Map()
export function getHistory(channelId) {
  return histories.get(channelId) ?? []
}
function pushHistory(channelId, role, content) {
  const h = getHistory(channelId)
  h.push({ role, content })
  while (h.length > 10) h.shift()
  histories.set(channelId, h)
}
// Seed a channel/thread's history (only if empty — never clobber an active conversation).
export function seedHistory(channelId, history) {
  if (!histories.has(channelId) && Array.isArray(history) && history.length) {
    histories.set(channelId, history.slice(-10))
  }
}
// Short Title-Case name (3–5 words) for a new conversation thread. Cheap Haiku call.
export async function titleFor(text) {
  try {
    const res = await anthropic().messages.create({
      model: 'claude-haiku-4-5', max_tokens: 24,
      system: 'Give a 3–5 word Title Case label (no quotes, no trailing period) for a chat that opens with this message.',
      messages: [{ role: 'user', content: String(text || '').slice(0, 300) }],
    })
    const t = res.content.filter((b) => b.type === 'text').map((b) => b.text).join('').trim().replace(/^["']|["']$/g, '')
    return t.slice(0, 90) || 'Chat'
  } catch {
    return (String(text || '').slice(0, 40).trim()) || 'Chat'
  }
}

// Best-effort usage log for a future /usage command. Never fails the chat.
async function logUsage(entry) {
  try {
    await appendFile(new URL('../logs/usage.jsonl', import.meta.url), JSON.stringify(entry) + '\n')
  } catch {
    /* ignore */
  }
}

// Your replies render in Discord, which does NOT support markdown tables (pipes show as raw text).
const DISCORD_FORMAT =
  "DISCORD FORMATTING — your output renders in Discord (NO markdown tables; pipes show as ugly raw text):\n" +
  "- For ANY columnar/tabular data (lists of cases, rows with columns), use a fenced CODE BLOCK with " +
  "space-aligned columns — monospace lines the columns up. NEVER use markdown | tables |.\n" +
  "  Example:\n```\n#  Case                         Amount  Stage\n1  UPSON 42 Edgewood (Dobrozsi)  $38.8K  Attempted Contact\n2  NEWTON 95 Keel (Nolley)       $74.8K  Attempted Contact\n```\n" +
  "- Keep columns TIGHT so they fit a phone: abbreviate (county + short address + last name), use $38.8K, " +
  "trim/align stage. Pick a sensible column order, widest-useful info first.\n" +
  "- For non-tabular answers use clean structure: ## headers, **bold** the key value, short bullets, blank " +
  "lines between groups. Never a wall of text.\n" +
  "- If there's a LOT (e.g. 40+ rows), still give the full code-block table if asked to 'list', but lead with " +
  "a one-line summary and offer to filter/group (by stage, county, amount).";

function buildSystem(model, activeSkills, loadableSkills, memories, styleSheet, stageGuide) {
  const playbooks = activeSkills.flatMap((s) => (s.playbook ? [`[${s.name}] ${s.playbook}`] : []))
  const parts = [SYSTEM_BASE, DISCORD_FORMAT]
  if (memories?.length) {
    parts.push('What you remember about Mo (long-term memory):\n' + memories.map((m) => `- ${m.content}`).join('\n'))
  }
  if (styleSheet) parts.push(styleSheet)
  if (stageGuide) parts.push(stageGuide)
  if (playbooks.length) parts.push('Active skill playbooks:\n' + playbooks.join('\n'))
  if (loadableSkills.length) {
    parts.push('Other skills you can load with load_skill if needed:\n' + skillMenu(loadableSkills))
  }
  parts.push(`You are currently running on the ${model} model. If Mo asks what model you're using, tell him honestly.`)
  return parts.join('\n\n')
}

// Returns { text, model, usage, costUSD, skills }.
// images/docs: optional public URLs (Discord attachments) — images seen via vision, PDFs read natively.
export async function chat(channelId, userText, images = [], docs = []) {
  let model = pickModel(userText)
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

  // Drafting email always runs on the stronger model (quality + judgment), regardless of default,
  // and gets Mo's live style sheet injected.
  let styleSheet = null
  if (activeNames.has('draft-email')) { model = DRAFT_MODEL; styleSheet = await renderStyleSheet().catch(() => null) }

  // Data skills query raw stage IDs — give the model the id→name map + a hard rule to use names.
  let stageGuide = null
  if (activeNames.has('data-explorer') || activeNames.has('outreach-planner') || activeNames.has('data-sync')) {
    const sm = await getStageMap().catch(() => ({}))
    if (sm && Object.keys(sm).length) {
      const lines = Object.entries(sm).map(([id, name]) => `  ${id} = ${name}`).join('\n')
      stageGuide = `STAGE NAMES (deals.stage is an opaque ID — ALWAYS show Mo the NAME below, never a raw stage ID; group/label by name):\n${lines}`
    }
  }

  let { tools, handlers, serverTools } = assembleTools(active)
  const loadedNames = new Set(active.map((s) => s.name))
  let searchCount = 0

  // Attachments: images (vision) + PDFs (read natively) from Discord, included in this turn.
  const imageBlocks = (images || [])
    .filter((u) => typeof u === 'string')
    .slice(0, 6)
    .map((url) => ({ type: 'image', source: { type: 'url', url } }))
  const docBlocks = (docs || [])
    .filter((u) => typeof u === 'string')
    .slice(0, 4)
    .map((url) => ({ type: 'document', source: { type: 'url', url } }))
  const attach = [...docBlocks, ...imageBlocks]
  const userContent = attach.length ? [...attach, { type: 'text', text: userText }] : userText
  const messages = [...getHistory(channelId), { role: 'user', content: userContent }]
  let finalText = '(no response)'
  let draftCard = null // set when a tool wants the bot to post an interactive draft card

  for (let i = 0; i < 8; i++) {
    const loadableNow = enabled.filter((s) => !loadedNames.has(s.name))
    const allTools = [...tools, ...serverTools, ...(loadableNow.length ? [LOAD_SKILL_TOOL] : [])]
    const system = buildSystem(model, active, loadableNow, memories, styleSheet, stageGuide)

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
            // A tool can ask the bot to post an interactive card (e.g. a draft review card).
            if (out && typeof out === 'object' && out._draftCard) {
              draftCard = out._draftCard
              out = out._toolText || 'done'
            }
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

  return { text: finalText, model, usage, costUSD, skills: skillsUsed, searches: searchCount, draftCard }
}

// Summarize an email thread for the draft context thread: what it's about, the latest message,
// and why Mo is replying. A single cheap call.
export async function summarizeThread(emails) {
  const transcript = (emails || []).slice(-8).map((e) => {
    const who = e.direction === 'outbound' ? 'Mo' : (e.from_addr || 'them')
    return `[${who}] ${e.subject || ''}\n${(e.body || '').replace(/\s+/g, ' ').slice(0, 800)}`
  }).join('\n---\n')
  if (!transcript) return '(no prior messages)'
  const res = await anthropic().messages.create({
    model: DRAFT_MODEL, max_tokens: 350,
    system: 'Summarize this email thread for Mo in 2–4 short lines: what it is about, what the latest message said, and why he is replying. Be concise, plain text.',
    messages: [{ role: 'user', content: transcript.slice(0, 12000) }],
  })
  return res.content.filter((b) => b.type === 'text').map((b) => b.text).join('').trim()
}

// Talk-to-edit: revise a draft body given a natural-language instruction, keeping Mo's voice.
// Used by the draft card's reply-to-edit flow (a single cheap call, not the full loop).
export async function reviseDraft({ subject, body, instruction }) {
  const sheet = await renderStyleSheet().catch(() => '')
  const system =
    "You revise an email draft for Mo at Horizon Recovery. Apply his instruction, keep it a complete email body, " +
    "and return ONLY the revised body text (no preamble, no quotes).\n\n" + sheet
  const prompt = `Current subject: ${subject || '(none)'}\nCurrent body:\n${body || ''}\n\nMo's instruction: ${instruction}\n\nRevised body:`
  const res = await anthropic().messages.create({
    model: DRAFT_MODEL, max_tokens: 1200, system,
    messages: [{ role: 'user', content: prompt }],
  })
  return res.content.filter((b) => b.type === 'text').map((b) => b.text).join('').trim()
}
