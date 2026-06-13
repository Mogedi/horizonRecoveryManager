# Horizon Research Agent — Design Doc

Status: design (no implementation yet). Author: design review with Mo.

## 1. Purpose & principles

A **research agent** for surplus-recovery / probate / heir work. Given a person + (usually) a known
property address, it collects evidence from multiple sources, resolves which records refer to the
*same human*, scores the match with explainable evidence, and produces a reviewable dossier. **The
human makes the final decision.** No auto-outreach, no auto-CRM writes, no autonomous action.

Principles (decided):
- **Entity resolution is the product.** The browser is infrastructure.
- **Public records first** (~80% of value: property, deeds, tax, probate, obituaries, relatives).
  People-search brokers are the contact last-mile (~20%), evaluated only if telemetry justifies it.
- **Telemetry is a first-class feature.** Every source call is measured. We build *scraper
  observability*, not just scrapers.
- **Deterministic per-source adapters**, not an open-ended web agent. Workflow is structured:
  search → open result → extract fields → score. (No Browser Use in Phase 1.)
- **No ML / no model training / no learning loop** until ≥100 real cases have run and the telemetry
  has been read. Matching starts as transparent hand-tuned rules.
- **Reuse what exists:** Patchright (already a dep), the dashboard (human-review surface), the
  HorizonManager MCP (trigger + introspection), append-only storage (facts vs. interpretation).

## 2. Architecture

```
Hermes / Sonnet
  → find_person(query)                 [MCP tool on the HorizonManager MCP]
    → Research Runner                  sequential · paced · circuit-breaker
      → Source Adapters                public records first · Patchright · hybrid extract
        → Telemetry Layer              every call → SourceAttempt
      → Entity Resolution Engine       weighted signals · property = anchor · source-independence
      → Confidence                     evidence bands · conflicts explicit
      → Dossier (append-only)
  → Human Review                       the existing dashboard
```

Runtime has exactly two MCP tools: `find_person` and `source_health`. There is **no generic
"Playwright MCP" runtime layer** — adapters drive Patchright directly. A browser MCP / the
browser-harness is used only at **dev-time** to author new adapters (see §7).

## 3. Folder structure

```
src/lib/research/
  find-person.ts        # orchestrator behind the find_person MCP tool
  runner.ts             # sequential, paced runner + per-source circuit breaker
  types.ts              # the interfaces in §4
  sources/
    index.ts            # adapter registry (id, kind, coverage, enabled)
    base.ts             # shared: Patchright session, block detection, extraction helpers
    <source>.ts         # one file per source adapter
  resolution/
    engine.ts           # weighted-signal matching
    signals.ts          # signal definitions + weights (tunable, explainable)
  confidence.ts         # band derivation from evidence
  telemetry.ts          # SourceAttempt logging + health queries (source_health tool)
  dossier.ts            # build + persist the append-only dossier
```

## 4. Core interfaces (TypeScript)

```ts
type Goal = 'locate_owner' | 'find_heirs' | 'mailing_address' | 'contact'

interface PersonQuery {
  name: string
  address?: string; city?: string; state?: string   // the property = our anchor
  ageHint?: number
  relativesHint?: string[]
  goal?: Goal
  caseId: string                                     // ties dossier + telemetry to the deal
}

interface Address { line1: string; city?: string; state?: string; zip?: string
  kind: 'current' | 'prior' | 'property' | 'mailing' }

// Common contract EVERY adapter returns — sources are swappable behind this.
interface Candidate {
  sourceId: string                 // which adapter produced it
  url: string                      // exact page (traceability)
  name: string | null
  addresses: Address[]
  phones: string[]; emails: string[]
  relatives: string[]
  ageOrDob: string | null
  deceased: boolean | null
  signals: string[]                // raw signals this source asserts
  raw: unknown                     // raw extracted blob, for audit
}

// Telemetry is not optional — every adapter call yields one of these.
interface SourceAttempt {
  sourceId: string; caseId: string
  status: 'success' | 'blocked' | 'captcha' | 'empty' | 'error'
  blockReason?: 'cloudflare' | 'captcha' | 'http_403' | 'http_429' | 'redirect' | 'empty' | 'parse'
  url: string
  latencyMs: number
  candidateCount: number
  proxyUsed: boolean               // correlate block rate with proxy on/off
  timestamp: Date
}

interface SourceResult { attempt: SourceAttempt; candidates: Candidate[] }

interface SourceAdapter {
  id: string; label: string
  kind: 'property' | 'tax' | 'deed' | 'probate' | 'obituary' | 'people_search' | 'social'
  coverage: { states?: string[]; counties?: string[] }   // when this source applies
  enabled: boolean
  search(query: PersonQuery, ctx: RunContext): Promise<SourceResult>
}

// Matching output for one resolved person.
interface EvidenceItem { signal: string; sources: string[]; weight: number; note: string } // sources[] = independence
interface Resolution {
  band: 'high' | 'medium' | 'low' | 'conflicting'
  score: number                    // sortable heuristic, NOT a probability
  best: Candidate                  // merged best-evidence record
  evidence: EvidenceItem[]         // why selected
  conflicts: EvidenceItem[]        // what disagrees
  ambiguities: string[]
}

interface Dossier {
  id: string; caseId: string; query: PersonQuery; createdAt: Date
  resolution: Resolution
  candidates: Candidate[]          // everything collected
  attempts: SourceAttempt[]        // full source trace
  reviewed: boolean; reviewedBy?: string; reviewedAt?: Date
}
```

## 5. Data flow

```
find_person(query)
  runner picks adapters whose coverage matches query.state/county, ordered: public records → people-search
  for each adapter (sequential, paced):
     search() → SourceResult        (telemetry logged regardless of outcome)
     if blocked Nx in a row → circuit-breaker pauses that source + pings Discord
  collect all candidates
  resolution.engine: cluster candidates → score vs the property anchor + signals (dedup by source independence)
  confidence: derive band + evidence + conflicts
  dossier.build → persist (append-only) → surface in dashboard for review
```

## 6. Source adapter lifecycle — "learning / skills over time"

This is how the system "figures it out" and **grows skills over time** *without* becoming an
unreliable open-ended agent. A source is a **skill** that is discovered once, codified, then run
deterministically — exactly like Hermes's skills and the browser-harness domain-skills.

```
1. DISCOVER  (dev-time, assisted)  Point Claude at a new source via the browser MCP / harness.
                                   It explores: how to search, read results, extract fields.
2. CODIFY                          It proposes a deterministic adapter (search steps + extraction
                                   map + block detection). You review/approve.
3. REGISTER                        Adapter added to sources/index.ts with coverage (states/counties).
4. RUN        (runtime)            Deterministic. Telemetry on every call. No re-figuring-it-out.
5. MONITOR                         Block rate / candidate yield / match contribution tracked.
6. REPAIR/RETIRE                   When telemetry shows decay (layout drift, new anti-bot), re-run
                                   DISCOVER to repair, or disable the source.
```

So "it learns on its own" = **the library of reviewed source-adapters grows**, and the **telemetry**
tells you which to trust. Per *run* it stays deterministic (reliable, cheap, debuggable). The only
genuine "learning" deferred to Phase 3 is a repository of human-approved matches to tune signal
weights — and only once we have volume.

## 7. Browser strategy

- **Patchright** (drop-in stealth Playwright, already a dep; `scripts/test-patchright.ts` verifies it).
- **Sequential + human pacing.** At ~30–40 cases/week, rate is not the risk — datacenter-IP
  reputation + fingerprint are. Patchright handles fingerprint; the **Oxylabs residential proxy** is
  a telemetry-triggered lever (`proxyUsed` measures whether it helps), not a default.
- **Extraction: hybrid.** Deterministic accessibility-tree / selector extraction first; an LLM
  "page → Candidate schema" extraction as the **fallback** for messy/changing pages (the
  Firecrawl/Crawl4AI pattern). Avoid screenshot→click loops. Screenshots are kept only as
  human-review artifacts and for CAPTCHA debugging.
- **CAPTCHA = human-in-the-loop.** When one appears, pause + ping Discord to solve once. No
  auto-solving (not worth it at this volume).

## 8. Entity resolution

- **Anchor on the property.** For surplus recovery you usually know the owner-of-record's address;
  that's far stronger than name+city. Cluster candidates and score against the anchor first.
- **Transparent weighted signals** (in `signals.ts`, tunable): exact/partial/prior address match,
  city, state, relative overlap, age overlap, phone/email overlap, name similarity.
- **Source independence.** Brokers resell the same data — N agreeing sources may be one source
  echoed. Each `EvidenceItem` tracks `sources[]`; corroboration weight scales with *independent*
  sources, not raw count.
- **Deceased fork.** If the owner is deceased (obituary/probate hit), the goal flips to `find_heirs`
  — a relationship-graph search, scored differently from locating one living person.

## 9. Confidence

- Output is **evidence + a band** (`high | medium | low | conflicting`), with `score` as a sortable
  heuristic only — never presented as a probability (we won't have calibration).
- **Conflicts are explicit.** Two people matching different signals → `conflicting`, surfaced for review.
- Every band is explainable: the reviewer sees the supporting and conflicting evidence and the source URLs.

## 10. Telemetry & health

- Every `SourceAttempt` persisted. `source_health` MCP tool answers, per source over a window:
  success rate, block rate (by reason), avg candidates, avg latency, contribution to confirmed
  matches, and degradation trend. Hermes can report this in Discord on demand.
- Circuit breaker + Discord alert when a source's block rate crosses a threshold.

## 11. Human review

- Dossier surfaces in the **existing dashboard**: resolution band, merged best record, evidence,
  conflicts, every candidate, every source URL + screenshot. Approve / reject / pick-different-candidate.
- Approvals are stored (Phase 3 weight-tuning input). No outreach is ever triggered by this system.

## 12. Database (Prisma, append-only where it's interpretation)

```
model SourceAttempt {
  id, sourceId, caseId, status, blockReason?, url, latencyMs, candidateCount, proxyUsed, createdAt
  @@index([sourceId, createdAt])   // health queries
}
model ResearchDossier {            // append-only — never overwritten (mirrors case_analyses)
  id, caseId, query Json, resolution Json, candidates Json, attempts Json,
  reviewed, reviewedBy?, reviewedAt?, createdAt
  @@index([caseId, createdAt])
}
```

## 13. Risks & failure modes

| Risk | Mitigation |
|---|---|
| Datacenter-IP block on request #1 | Patchright by default; Oxylabs residential proxy as a measured lever |
| Layout drift breaks an adapter | Telemetry flags decay → re-run DISCOVER to repair; LLM-extract fallback absorbs minor drift |
| CAPTCHA | Human-in-the-loop pause + ping; circuit breaker |
| False match (two different people) | Property anchor + conflict modeling + `conflicting` band + human review |
| Source echo (resold data) | Independence-weighted corroboration |
| Stale data (old phones/addresses) | Show source date; prefer recent; mark `prior` addresses |
| Cost runaway | Cache dossiers by (query hash); per-case source budget; sequential, not parallel |
| Legal / permissible-purpose | Human-final-decision gate; no auto-outreach; dossier is research, not a consumer report |

## 14. Phasing

- **MVP** — Research Runner + telemetry + **one** public-records adapter, end-to-end. `find_person`
  MCP tool → append-only dossier → dashboard review. Transparent weighted matching. Goal: real
  block-rate + yield numbers within days.
- **Phase 2** — add 2–4 more public-records / obituary adapters; the discover→codify authoring flow;
  source-independence dedup; proxy decision driven by telemetry; one people-search source if justified.
- **Phase 3** — heir-graph for deceased owners; approved-match repository → tune signal weights
  (only after ≥100 cases); revisit Browser Use only if a source genuinely needs dynamic navigation.

## 15. Horizon-specific: sources, credentials, documents, entry page

### Geography & goals
~90–95% **Georgia** (some Florida). Default state = GA, overridable. Per case we want ALL of:
confirm land owned · alive-or-deceased (**≈60% deceased → heir-hunt**) · current mailing address ·
multiple phone numbers · relatives list · (optional, low priority) a matched Facebook/LinkedIn URL.

### Source plan (priority order)
1. **qPublic** (qpublic.schneidergeospatial.com / qpublic.net) — FREE, no login. Property directory:
   owner, parcel, property address, assessments, often deed-book references. **START HERE** — it makes
   GSCCCA searches targeted. [property/tax adapter]
2. **GSCCCA** (gsccca.org) — GA Superior Court Clerks' Cooperative Authority. **LOGIN REQUIRED.** Tax
   deeds, liens, real-estate index. Flow: pick county / use parcel → name search (Last, First) → open
   the deed/lien → **capture the document image** (not the site's print dialog). [deed adapter + vault]
3. **PropertyRadar** — paid account (Mo has). LOGIN REQUIRED. Owner/property/contact enrichment.
4. **People-search** (FastPeopleSearch, TruePeopleSearch) — FREE, no login, but anti-bot defended.
   Phones / relatives / prior addresses. Telemetry decides if they're worth it. **BeenVerified: do
   NOT use** — limited search quota Mo doesn't want burned.
5. **Death / obituary** (≈60% of cases): Legacy.com (mostly free/public), Find a Grave (free), SSDI
   (free). newspapers.com & some obit sites are paywalled → optional account via the vault.
6. **Social** (Facebook/LinkedIn) — **DEFERRED.** Logged-in scraping flags accounts and blocks fast.
   At most a Phase-2 *passive* public-URL capture from search results; never logged-in scraping.

### Soft learning / source discovery
When research surfaces a useful records site we don't have an adapter for (a county portal, zoning
site, etc.), log it to a **suggested_sources** list for Mo to approve → it enters the discover→codify
lifecycle (§6) and becomes a new skill. This is how coverage grows to sites Mo didn't know about
(the way qPublic once was).

### Credentials (vault)
- **MVP:** per-source env vars on the VPS (e.g. `GSCCCA_USER` / `GSCCCA_PASS`) — never in git, never
  logged. The adapter's `login()` reads them; the Patchright **persistent profile reuses the session**
  so we log in rarely (also more human-like).
- **Later:** an encrypted `source_credentials` table + a dashboard screen so Mo adds/updates creds
  himself. Credentials never appear in logs, telemetry, dossiers, or git.

### Document capture & storage
Navigate to the deed/lien image → capture (screenshot / page→PDF), **not** the site print dialog.
- **MVP:** a `research_documents` table (bytes + metadata), served to the dashboard via an API route.
  Guaranteed to work, no extra OAuth scopes.
- **Preferred later:** write the PDF into the deal's **Google Drive** folder (matching the existing
  deal-case folder style) — needs Drive *write* scope (a Google re-consent); falls back to DB/VPS.

### Entry + review page (dashboard)
New page `/dashboard/research`: a form (name, address, city, **state defaulted to GA**, + optional
parcelId, county, ageHint, relatives) → runs `find_person` → renders the dossier inline: resolution
band, merged best record, phones, addresses, relatives, deceased status, evidence + source URLs, and
inline previews of captured documents. Mo verifies/approves here — no retyping. This is both the
human-review surface and the everyday entry point.

## 16. Updated DB additions

```
model ResearchDocument {     // captured deeds/liens/screenshots, tied to a case
  id, caseId, dossierId?, sourceId, kind, label, mimeType, bytes Bytes, sourceUrl?, createdAt
  @@index([caseId, createdAt])
}
model SuggestedSource {      // soft-learning: sites worth turning into adapters
  id, url, host, note, seenCount, status('new'|'approved'|'rejected'), createdAt
}
// Credentials: MVP = VPS env vars (no table). Later: encrypted source_credentials + dashboard UI.
```
