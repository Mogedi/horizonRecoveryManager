// Shared adapter helpers: block detection + LLM extraction. Adapters NEVER throw for an expected
// block — they return a SourceResult whose attempt.status says what happened.
import { callClaude } from '@/lib/ai/client'
import type {
  BlockReason, Candidate, Address, AddressKind, AttemptStatus, SourceAttempt, PersonQuery, RunContext,
} from '../types'

// Build a telemetry record with the common fields filled in.
export function makeAttempt(
  sourceId: string, status: AttemptStatus, q: PersonQuery, startedAt: number, ctx: RunContext,
  extra: Partial<SourceAttempt> = {},
): SourceAttempt {
  return {
    sourceId, caseId: q.caseId ?? null, status, latencyMs: Date.now() - startedAt,
    candidateCount: 0, proxyUsed: ctx.proxyUsed, timestamp: new Date(), ...extra,
  }
}

// Classify a page as a block from HTTP status + visible text. Pure + unit-tested.
export function detectBlock(status: number | null, bodyText: string): BlockReason | null {
  if (status === 403) return 'http_403'
  if (status === 429) return 'http_429'
  const t = (bodyText || '').toLowerCase()
  if (/just a moment|checking your browser|cf-browser-verification|cloudflare|attention required/.test(t)) return 'cloudflare'
  if (/captcha|recaptcha|hcaptcha|are you a (human|robot)|verify you are human/.test(t)) return 'captcha'
  if (/access denied|request blocked|unusual traffic|you have been blocked/.test(t)) return 'http_403'
  return null
}

const ADDRESS_KINDS: AddressKind[] = ['current', 'prior', 'property', 'mailing']

function toAddress(a: unknown): Address | null {
  if (!a || typeof a !== 'object') return null
  const o = a as Record<string, unknown>
  const line1 = typeof o.line1 === 'string' ? o.line1.trim() : ''
  if (!line1) return null
  const kind = ADDRESS_KINDS.includes(o.kind as AddressKind) ? (o.kind as AddressKind) : 'current'
  return {
    line1,
    city: typeof o.city === 'string' ? o.city : undefined,
    state: typeof o.state === 'string' ? o.state : undefined,
    zip: typeof o.zip === 'string' ? o.zip : undefined,
    kind,
  }
}

const strArr = (v: unknown): string[] => (Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string') : [])

export function normalizeCandidate(sourceId: string, url: string, raw: unknown): Candidate | null {
  if (!raw || typeof raw !== 'object') return null
  const o = raw as Record<string, unknown>
  const cand: Candidate = {
    sourceId,
    url,
    name: typeof o.name === 'string' ? o.name : null,
    addresses: (Array.isArray(o.addresses) ? o.addresses : []).map(toAddress).filter((a): a is Address => !!a),
    phones: strArr(o.phones),
    emails: strArr(o.emails),
    relatives: strArr(o.relatives),
    ageOrDob: typeof o.ageOrDob === 'string' ? o.ageOrDob : typeof o.ageOrDob === 'number' ? String(o.ageOrDob) : null,
    deceased: typeof o.deceased === 'boolean' ? o.deceased : null,
    signals: strArr(o.signals),
    raw,
  }
  // Drop empty shells (no name and no contact/address signal).
  if (!cand.name && !cand.addresses.length && !cand.phones.length && !cand.relatives.length) return null
  return cand
}

// Turn an unstructured page into Candidates via the LLM. Resilient to per-jurisdiction layout
// variance (qPublic differs by county), where deterministic selectors don't generalize.
export async function extractCandidates(sourceId: string, url: string, pageText: string, hint: string): Promise<Candidate[]> {
  if (!pageText.trim()) return []
  const prompt =
    `${hint}\n\nFrom the PAGE TEXT below, extract any matching people/property records. ` +
    `Return ONLY a JSON array (no prose, no code fences). Each item: ` +
    `{"name":string|null,"addresses":[{"line1":string,"city":string,"state":string,"zip":string,"kind":"current|prior|property|mailing"}],` +
    `"phones":[string],"emails":[string],"relatives":[string],"ageOrDob":string|null,"deceased":boolean|null,"signals":[string]}. ` +
    `If nothing relevant, return []. \n\nPAGE TEXT:\n${pageText.slice(0, 12000)}`
  let out: string
  try {
    out = await callClaude(prompt, 'You extract structured records from web pages. Respond with a strict JSON array only.', 1800, 'claude-sonnet-4-6')
  } catch {
    return []
  }
  let parsed: unknown
  try {
    parsed = JSON.parse(out.trim().replace(/^```(?:json)?/i, '').replace(/```$/, '').trim())
  } catch {
    return []
  }
  if (!Array.isArray(parsed)) return []
  return parsed.map(p => normalizeCandidate(sourceId, url, p)).filter((c): c is Candidate => !!c)
}
