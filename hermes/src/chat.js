// Conversational Hermes — free-text chat backed by Claude, with short per-channel memory.
// Used by the bot for @mentions and DMs (structured actions stay on the slash commands).
import Anthropic from '@anthropic-ai/sdk'

const MODEL = 'claude-sonnet-4-6'

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
  'You help Mo (the owner) think through cases and day-to-day operations. Be concise, direct, and practical. ' +
  'You can read case data and write AI interpretation through the Horizon Manager app; you never touch HubSpot ' +
  'or business facts directly, and you never move money. For structured actions, point Mo to the slash commands: ' +
  '/queue (list active deals), /case deal:<id> (case summary), /triage deal:<id> (AI triage with an Apply-to-write button).'

// Per-channel rolling history so a conversation has continuity. In-memory (resets on bot restart).
const histories = new Map()
function getHistory(channelId) {
  return histories.get(channelId) ?? []
}
function pushHistory(channelId, role, content) {
  const h = getHistory(channelId)
  h.push({ role, content })
  while (h.length > 12) h.shift() // keep the last ~6 exchanges
  histories.set(channelId, h)
}

export async function chat(channelId, userText) {
  const messages = [...getHistory(channelId), { role: 'user', content: userText }]
  const res = await anthropic().messages.create({ model: MODEL, max_tokens: 1024, system: SYSTEM, messages })
  const text = res.content.find((b) => b.type === 'text')?.text ?? '(no response)'
  pushHistory(channelId, 'user', userText)
  pushHistory(channelId, 'assistant', text)
  return text
}
