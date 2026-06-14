// Runtime validation for the ingest seam — the boundary where untrusted agent data enters Horizon.
//
// The EvidencePackage is typed in TS, but types vanish at runtime: the ingest API used to accept
// whatever Hermes POSTed. That's exactly how the telemetry-shape drift slipped in unnoticed. This Zod
// schema validates the *contract* at the boundary so malformed evidence fails fast with a clear 400
// instead of a confusing 500 or a silently-wrong dossier.
//
// Design: strict on the STRUCTURE ingest+derive depend on (discriminated union by `kind`, provenance
// with a host + known sourceType). Lenient where we intentionally tolerate variation: `telemetry` is
// `unknown[]` (the normalizer in telemetry.ts copes with freeform shapes) and unknown keys are allowed
// so we never reject — and never strip — fields. Validation NEVER mutates the stored package: the route
// validates the parsed copy but persists the original raw body, honoring "store everything."
import { z } from 'zod'

const SOURCE_TYPES = ['obituary', 'people_search', 'property', 'government', 'crm', 'probate', 'funeral', 'other'] as const
const DECEASED = ['living', 'deceased', 'unknown'] as const

const provenance = z.object({
  sourceId: z.string().min(1),
  sourceType: z.enum(SOURCE_TYPES),
  url: z.string(),
  retrievedAt: z.string(),
  sourceText: z.string(),
}).loose() // allow isFromCrm / documentId / future fields without rejecting

// Evidence value shapes are kept loose on their inner fields (derive uses ?? / optional chaining) but
// each item MUST declare a known kind + carry provenance. That's the contract ingest relies on.
const item = (kind: string, value: z.ZodType) =>
  z.object({ kind: z.literal(kind), value, provenance: provenance }).loose()

const evidenceItem = z.discriminatedUnion('kind', [
  item('identity', z.object({ name: z.string(), normalizedName: z.string() }).loose()),
  item('address', z.object({ line1: z.string() }).loose()),
  item('phone', z.object({ number: z.string() }).loose()),
  item('email', z.object({ address: z.string() }).loose()),
  item('relationship', z.object({ person: z.string(), normalizedName: z.string(), relationshipAsStated: z.string() }).loose()),
  item('deceased', z.object({ deceasedStatus: z.enum(DECEASED), basis: z.string() }).loose()),
  item('property', z.object({ owner: z.string() }).loose()),
  item('lien', z.object({ holder: z.string() }).loose()),
  item('tax_event', z.object({ kind: z.enum(['tax_sale', 'tax_deed', 'redemption', 'delinquency']) }).loose()),
  item('transaction', z.object({}).loose()), // all fields optional (date/type/grantor/grantee/book/page)
  item('note', z.object({ text: z.string() }).loose()),
])

export const evidencePackageSchema = z.object({
  query: z.object({ name: z.string().min(1) }).loose(),
  evidence: z.array(evidenceItem),
  candidates: z.array(z.object({ localId: z.string(), evidenceRefs: z.array(z.number()) }).loose()),
  telemetry: z.array(z.unknown()), // intentionally lenient — normalizeTelemetry() copes with freeform
}).loose() // requestId / plan / documents / notes / budget / completedAt pass through untouched

export type ValidationResult = { ok: true } | { ok: false; issues: string[] }

// Validate WITHOUT mutating — callers store the original raw body, not the parsed copy.
export function validateEvidencePackage(raw: unknown): ValidationResult {
  const r = evidencePackageSchema.safeParse(raw)
  if (r.success) return { ok: true }
  return { ok: false, issues: r.error.issues.slice(0, 10).map((i) => `${i.path.join('.') || '(root)'}: ${i.message}`) }
}
