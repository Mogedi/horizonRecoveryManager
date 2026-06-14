// Telemetry normalization: evidence-package telemetry → typed SourceAttempt rows.
//
// The contract (types.ts) is `telemetry: SourceAttempt[]`, but real agent runs have emitted
// freeform shapes — `{source, method, result}`, `{step, source, outcome}`, `{source, note}` —
// and ingest never fanned ANY of it into the `source_attempts` table, so getSourceHealth()
// (source intelligence, plan B6) read an empty table. This coerces both the typed contract
// shape AND the historical freeform shapes into SourceAttempt, tolerating partial data.
//
// Pure + unit-tested. Going forward the playbook emits typed entries; this still passes them
// through unchanged. Re-derivable from the immutable evidence package at any time.
import type { SourceAttempt, AttemptStatus, BlockReason, SourceType } from './types'

const ATTEMPT_STATUSES: AttemptStatus[] = ['success', 'blocked', 'captcha', 'empty', 'error']
const SOURCE_TYPES: SourceType[] = ['obituary', 'people_search', 'property', 'government', 'crm', 'probate', 'funeral', 'other']

// A single normalized attempt minus the fields ingest stamps on (requestId/caseId/timestamp).
export type NormalizedAttempt = Omit<SourceAttempt, 'requestId' | 'caseId' | 'timestamp'>

const str = (v: unknown): string => (typeof v === 'string' ? v : '')

// "fastpeoplesearch.com, fastbackgroundcheck.com and truepeoplesearch.com" → three hosts.
// "gismaps.fultoncountyga.gov ArcGIS REST" → "gismaps.fultoncountyga.gov" (host = first token).
function splitHosts(raw: string): string[] {
  return raw
    .split(/[,;]| and /i)
    .map((s) => s.trim().split(/\s+/)[0]) // drop descriptive suffixes; keep the host token
    .filter(Boolean)
}

// Fallback when there's no explicit source field: pull domain-like tokens out of the prose
// (e.g. "found gordonassessors.com and legacy.com"). This also filters internal MCP steps
// ("claimed requestId 2", "no prior sources") — no domain → not a source attempt → dropped.
const DOMAIN_RE = /\b((?:[a-z0-9-]+\.)+[a-z]{2,})\b/gi
function extractDomains(prose: string): string[] {
  const out = new Set<string>()
  for (const m of prose.matchAll(DOMAIN_RE)) out.add(m[1].toLowerCase())
  return [...out]
}

function inferStatus(prose: string): AttemptStatus {
  const p = prose.toLowerCase()
  if (/captcha/.test(p)) return 'captcha'
  if (/block|anti-?bot|cloudflare|\b403\b|denied|forbidden/.test(p)) return 'blocked'
  if (/error|fail|exception|timeout|\b5\d\d\b/.test(p)) return 'error'
  if (/success|found|confirmed|extracted|partial/.test(p)) return 'success'
  if (/no (result|match|data|obit|record)|not found|none|empty|unavailable/.test(p)) return 'empty'
  return 'empty' // unknown → conservative (don't inflate success rate)
}

function inferBlockReason(prose: string): BlockReason | undefined {
  const p = prose.toLowerCase()
  if (/cloudflare/.test(p)) return 'cloudflare'
  if (/captcha/.test(p)) return 'captcha'
  if (/\b403\b/.test(p)) return 'http_403'
  if (/\b429\b/.test(p)) return 'http_429'
  return undefined
}

function inferSourceType(host: string, prose: string): SourceType {
  const s = `${host} ${prose}`.toLowerCase()
  if (/funeral/.test(s)) return 'funeral'
  if (/obit|legacy\.com|findagrave|tributes|dignitymemorial/.test(s)) return 'obituary'
  if (/peoplesearch|fastpeople|truepeople|backgroundcheck|whitepages|spokeo|people_search/.test(s)) return 'people_search'
  if (/probate|estate/.test(s)) return 'probate'
  if (/gis|qpublic|assessor|parcel|property|propertyradar|beacon|schneider/.test(s)) return 'property'
  if (/\.gov|county|court|clerk|recorder|tax/.test(s)) return 'government'
  if (/crm|hubspot/.test(s)) return 'crm'
  return 'other'
}

const isValid = <T>(allowed: readonly T[], v: unknown): v is T => allowed.includes(v as T)

// Coerce one raw telemetry entry (typed or freeform) into 0..n NormalizedAttempts (n>1 when a
// single freeform entry lists multiple hosts). Entries with no identifiable source are dropped.
export function normalizeAttempt(entry: unknown): NormalizedAttempt[] {
  if (!entry || typeof entry !== 'object') return []
  const e = entry as Record<string, unknown>

  const prose = [e.result, e.outcome, e.note, e.method, e.step, isValid(ATTEMPT_STATUSES, e.status) ? '' : e.status]
    .map(str)
    .filter(Boolean)
    .join(' ')

  const sourceField = str(e.sourceId) || str(e.source)
  // Prefer an explicit source field; otherwise recover the host(s) from the prose.
  const hosts = sourceField ? splitHosts(sourceField) : extractDomains(prose)
  if (hosts.length === 0) return []

  const status: AttemptStatus = isValid(ATTEMPT_STATUSES, e.status) ? (e.status as AttemptStatus) : inferStatus(prose)
  const blockReason: BlockReason | undefined =
    isValid<BlockReason>(['cloudflare', 'captcha', 'http_403', 'http_429', 'redirect', 'empty', 'parse'], e.blockReason)
      ? (e.blockReason as BlockReason)
      : status === 'blocked' || status === 'captcha'
        ? inferBlockReason(prose)
        : undefined

  const latencyMs = typeof e.latencyMs === 'number' ? e.latencyMs : 0
  const candidateCount = typeof e.candidateCount === 'number' ? e.candidateCount : 0
  const proxyUsed = e.proxyUsed === true
  const url = str(e.url) || undefined

  return hosts.map((host) => ({
    sourceId: host,
    sourceType: isValid(SOURCE_TYPES, e.sourceType) ? (e.sourceType as SourceType) : inferSourceType(host, prose),
    status,
    blockReason,
    url,
    latencyMs,
    candidateCount,
    proxyUsed,
  }))
}

// Normalize an entire package's telemetry array.
export function normalizeTelemetry(telemetry: unknown): NormalizedAttempt[] {
  if (!Array.isArray(telemetry)) return []
  return telemetry.flatMap(normalizeAttempt)
}
