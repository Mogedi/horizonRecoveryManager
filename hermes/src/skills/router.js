// Skill router — a cheap Haiku pre-pass that picks which (enabled, non-always-on) skills are
// relevant to the current message, so the main chat loop only loads those tools. The model can
// still load_skill(...) more mid-turn if the router under-picks (hybrid loading).
import Anthropic from '@anthropic-ai/sdk'

let client
function anthropic() {
  if (!client) {
    if (!process.env.ANTHROPIC_API_KEY) throw new Error('ANTHROPIC_API_KEY not set')
    client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY })
  }
  return client
}

const ROUTER_MODEL = 'claude-haiku-4-5'

// Returns { names: string[], usage }. Picks at most `max` skill names from the candidates.
export async function routeSkills(userText, candidateSkills, max = 3) {
  if (candidateSkills.length === 0) return { names: [], usage: null }

  const menu = candidateSkills.map((s) => `- ${s.name}: ${s.description}`).join('\n')
  const prompt =
    `Skills available:\n${menu}\n\n` +
    `Message: ${JSON.stringify(userText)}\n\n` +
    `Which skills are needed to answer this message? Reply with ONLY a JSON array of skill names ` +
    `(at most ${max}); use [] if none apply. No prose.`

  const res = await anthropic().messages.create({
    model: ROUTER_MODEL,
    max_tokens: 80,
    system: 'You route a message to the right skills. Output a JSON array of skill names and nothing else.',
    messages: [{ role: 'user', content: prompt }],
  })

  const text = res.content.filter((b) => b.type === 'text').map((b) => b.text).join('')
  const m = text.match(/\[[\s\S]*\]/)
  let names = []
  try {
    names = m ? JSON.parse(m[0]) : []
  } catch {
    names = []
  }
  const valid = new Set(candidateSkills.map((s) => s.name))
  return {
    names: (Array.isArray(names) ? names : []).filter((n) => valid.has(n)).slice(0, max),
    usage: res.usage ?? null,
  }
}
