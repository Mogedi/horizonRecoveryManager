// Triage workflow: read a case → reason with Claude → produce a validated analysis.
// Pure of writes — the CLI decides whether to --apply via hm-api. Dry-run is the default.
import Anthropic from '@anthropic-ai/sdk'
import { createHash } from 'node:crypto'
import { getCase } from './cases-read.js'

const MODEL = 'claude-sonnet-4-6'
const HEALTHS = new Set(['active', 'waiting', 'blocked', 'on_track', 'unknown'])
const PRIORITIES = new Set(['urgent', 'high', 'normal', 'low'])

let client
function anthropic() {
  if (!client) {
    if (!process.env.ANTHROPIC_API_KEY) throw new Error('ANTHROPIC_API_KEY not set')
    client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY })
  }
  return client
}

// Stable hash of just the FACTS an analysis depends on. Unchanged facts → skip re-analysis.
export function computeInputHash(caseData) {
  const facts = {
    stage: caseData.deal.stage,
    lastActivity: caseData.deal.last_activity_date,
    activity: (caseData.activity ?? []).map((a) => [a.ts, a.type, a.outcome, (a.body || '').slice(0, 200)]),
    contacts: (caseData.contacts ?? []).map((c) => [c.name, c.contact_type, c.ownership_status]),
  }
  return createHash('sha256').update(JSON.stringify(facts)).digest('hex')
}

export function buildPrompt(caseData) {
  const { deal, contacts, activity } = caseData
  const act = (activity ?? [])
    .slice(0, 30)
    .map((a) => {
      const ts = a.ts?.toISOString?.() ?? a.ts
      return `- ${ts} [${a.source}/${a.type}${a.outcome ? '/' + a.outcome : ''}] ${(a.body || '').replace(/\s+/g, ' ').slice(0, 160)}`
    })
    .join('\n')
  const con = (contacts ?? []).map((c) => `- ${c.name} (${c.contact_type || '?'}, ${c.ownership_status || '?'})`).join('\n')
  return `You are triaging a surplus-funds recovery case for Horizon Recovery LLC.

Deal: ${deal.name}
Stage (ID): ${deal.stage}
Amount: ${deal.amount}
Last activity: ${deal.last_activity_date}

Contacts:
${con || '(none)'}

Recent activity (newest first):
${act || '(none)'}

Respond with a JSON object ONLY (no prose, no code fences) with exactly these fields:
{
  "health": one of ["active","waiting","blocked","on_track","unknown"],
  "priority": one of ["urgent","high","normal","low"],
  "statusLabel": short human status (e.g. "Waiting on county attorney"),
  "blockers": string[],
  "recommendations": string[],
  "risks": string[],
  "nextAction": short next step,
  "moActionRequired": boolean,
  "reasoning": one or two sentences,
  "confidence": number between 0 and 1
}`
}

// Parse + client-side enum validation (mirrors the server guard so bad output fails fast).
export function parseAnalysis(text) {
  let obj
  try {
    obj = JSON.parse(text)
  } catch {
    const m = text.match(/\{[\s\S]*\}/)
    if (!m) throw new Error('Claude response is not JSON: ' + text.slice(0, 200))
    obj = JSON.parse(m[0])
  }
  if (!HEALTHS.has(obj.health)) throw new Error(`invalid health: ${JSON.stringify(obj.health)}`)
  if (!PRIORITIES.has(obj.priority)) throw new Error(`invalid priority: ${JSON.stringify(obj.priority)}`)
  return {
    health: obj.health,
    priority: obj.priority,
    statusLabel: typeof obj.statusLabel === 'string' ? obj.statusLabel : null,
    blockers: Array.isArray(obj.blockers) ? obj.blockers.filter((x) => typeof x === 'string') : [],
    recommendations: Array.isArray(obj.recommendations) ? obj.recommendations.filter((x) => typeof x === 'string') : [],
    risks: Array.isArray(obj.risks) ? obj.risks.filter((x) => typeof x === 'string') : [],
    nextAction: typeof obj.nextAction === 'string' ? obj.nextAction : null,
    moActionRequired: !!obj.moActionRequired,
    reasoning: typeof obj.reasoning === 'string' ? obj.reasoning : null,
    confidence: typeof obj.confidence === 'number' ? obj.confidence : null,
  }
}

// Returns { skipped, reason?, inputHash, analysis?, caseData }. Never writes.
export async function triage(dealHubspotId) {
  const caseData = await getCase(dealHubspotId)
  const inputHash = computeInputHash(caseData)
  if (caseData.latestAnalysis?.input_hash && caseData.latestAnalysis.input_hash === inputHash) {
    return { skipped: true, reason: 'inputHash unchanged since last analysis', inputHash, caseData }
  }
  const res = await anthropic().messages.create({
    model: MODEL,
    max_tokens: 1024,
    messages: [{ role: 'user', content: buildPrompt(caseData) }],
  })
  const text = res.content.find((b) => b.type === 'text')?.text ?? ''
  const analysis = parseAnalysis(text)
  return { skipped: false, inputHash, analysis, provider: 'anthropic', model: MODEL, caseData }
}
