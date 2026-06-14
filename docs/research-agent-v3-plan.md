# Research Agent v3 — Dossier Rearchitecture Gameplan

> **For Claude:** Build this in order — **capture → derive → view**. The evidence schema (Phase A) is
> the gate; nothing downstream works without it. Keep each phase green (`npm test`) before the next.
> This supersedes the dossier sections of `docs/research-agent-design.md`; the evidence→derive→view
> boundary and EvidencePackage contract there still hold.

## Why this exists

The dossier should answer three questions at a glance:
1. **Who can I contact?** (living, contactable people — phones first, then mail, then email)
2. **Why are they related?** (relationship as the source stated it + the raw quote)
3. **What evidence supports it?** (provenance, corroboration count, recency)

Today the dossier shows raw scores and a flat people list. This rearchitects it into **Actionable
Contacts** (act now) vs **Family Structure** (understand the picture), with explainable confidence and
honest provenance.

## Non-negotiable principles (do not violate)

- **Facts vs interpretation.** Hermes writes ONLY immutable evidence. Scores, bands, rankings,
  heir graphs, completeness — ALL **derived** in `src/lib/research/derive.ts`, re-derivable from
  evidence. No agent ever writes a business object.
- **No false precision.** Capture relationships **as stated** (`relationshipAsStated` + raw quote).
  Computed kinship ("first cousin once removed") is allowed only LATER and only labeled `inferred`.
  Rank contacts by **transparent signals** (corroborating independent sources + recency), never an
  invented certainty number on a single datum.
- **Store everything, pick nothing.** Never collapse to one phone/address. Keep all, rank all.
- **Raw quote everywhere.** Every evidence item carries `provenance.sourceText` (the exact snippet).
  Required on relationships especially ("Survived by several cousins…").
- **`provenance.sourceId` = the data-source host** (`legacy.com`, `gordonassessors.com`), NEVER the
  tool (`firecrawl`/`browser`).
- **Browser Use is paid — scope it.** People-search / anti-bot sources ONLY. Use HTTP/Firecrawl for
  obituary, funeral-home, property, and government pages unless blocked.
- **No legal conclusions in names.** Use `closeFamilyIdentified` / "potential contacts", never
  "direct descendants" / "heirs", in derived flags and UI labels.
- Secrets never in evidence, dossiers, logs, or git. DB uses `db push` (never `migrate dev` /
  `--accept-data-loss`). PR workflow only — no direct push to main.

---

## Phase A — Capture (schema-first + idempotency)

Goal: the agent records richer, typed evidence so derivation has something real to work with.

### A1. Evidence schema (`src/lib/research/types.ts`)

Extend `Provenance` and the `EvidenceItem` discriminated union. **These named fields replace loose
JSON** — derivation and the view read them directly.

```ts
Provenance {
  sourceId: string          // DATA-SOURCE host, never the tool (e.g. "legacy.com")
  sourceType: 'obituary'|'people_search'|'property'|'government'|'crm'|'probate'|'funeral'|'other'
                            // CAPTURED FACT — what KIND of source. Powers source-category analytics
                            // and the derived evidenceStrength mapping (do NOT capture strength).
  url: string
  retrievedAt: string
  sourceText: string        // RAW QUOTE — required (the exact snippet supporting this item)
  isFromCrm?: boolean        // true if this came from our CRM, not external research
}

// EvidenceItem by kind (value shapes):
identity     { name, normalizedName, maidenName?, ageOrDob?,   // normalizedName = lowercased/trimmed
               deceasedStatus: 'living'|'deceased'|'unknown' } // identity key for person-level idempotency
relationship { person, normalizedName, relationshipAsStated,      // e.g. "step-son of her uncle Jerry"
               relationCategory: 'parent'|'sibling'|'spouse'|'child'|'grandparent'|
                                 'cousin'|'extended'|'friend'|'unknown',
               deceasedStatus, maidenName? }
phone        { number, label?, lastReportedAt?,                    // E.164; lastReportedAt = recency
               contactMethodStatus: 'unverified'|'valid'|'stale'|'invalid' }   // default 'unverified'
email        { address, lastReportedAt?, contactMethodStatus }
address      { line1, city?, state?, zip?,
               kind: 'current'|'prior'|'property'|'mailing', lastReportedAt? }
deceased     { deceasedStatus, dateOfDeath?, basis }              // subject-level
property     { owner, parcelId?, situsAddress?, deedBook? }
note         { text }
```

Rules for the schema:
- `relationshipAsStated` is the source of truth. `relationCategory` is a best-effort bucket for
  grouping only — if derivation later computes a degree, it's a separate `inferred` field, never
  overwriting the stated relationship.
- `contactMethodStatus` defaults `'unverified'`. The future phone-validation API flips it — no rework.
- `lastReportedAt` is whatever recency signal the source shows ("last reported 2023"); omit if absent.
- Make `sourceText` **and** `sourceType` required at the type level so the agent can't skip them.
- `normalizedName` = lowercased, trimmed, punctuation-stripped name. It is the **identity key** the
  person-level idempotency lookup (A3) matches on. **Capture this fact now; defer the merge engine** —
  do NOT build a global cross-case `Person` table that fuses same-named people (see "Deferred").
- **Do NOT capture `evidenceStrength`.** Strength is interpretation and a pure function of
  `sourceType` — it is **derived** in Phase B (B7), not written by the agent.

### A2. Playbook capture rules (`hermes/research-playbook.md`)

Update the evidence section and add capture rules. The agent must:
- Capture the **full family** — both **survived-by** AND **preceded-in-death**, with `relationCategory`,
  `deceasedStatus`, and `maidenName` where stated.
- **Always pursue phones + valid emails** for living people ("we are always going to be calling
  people"). Store **all** phones/addresses/emails per person, each with its own provenance +
  `lastReportedAt`. The most recent is most important — capture the recency signal so derivation can rank.
- **Batch-extract** the obituary family in ONE pass (don't re-scrape per relative).
- Put the exact `sourceText` quote on every item, especially relationships.
- Set `provenance.sourceType` on every item (obituary / people_search / property / government / crm /
  probate / funeral / other) — it's just *which kind of page* the fact came from, not a judgment.
- Set `normalizedName` on every identity/relationship item (lowercased, trimmed, punctuation-stripped).
- Tag CRM-sourced items with `isFromCrm: true`.
- **Browser Use scope (hard rule):** use Browser Use ONLY for people-search / anti-bot sources;
  use HTTP/Firecrawl for obituary, funeral, property, government — unless blocked (then escalate per
  the JS-heavy vs anti-bot distinction already in §4).
- **Record a `reason` on each plan step** (why this search — e.g. "searched Norman Taylor: 'survived
  by several cousins' + maternal Meeks branch"). Reuses `plan.steps`; surfaces in the timeline for free.
- Give the agent the exact schema + 1–2 examples + "use `unknown`/omit when not stated — never guess."

### A3. Idempotency (here, before broad paid searches)

Two levels:
- **Case-level** (`hermes/src/research-worker.js` + `src/lib/db/research.ts`): before running a case,
  skip if it already has a recent dossier (e.g. `< 30 days`). Add a `force` override path.
- **Person/source-level** (new MCP tool): `get_prior_evidence(name)` returns any phones/addresses we
  already hold for that person (from prior evidence packages). The agent calls it **before any paid
  Browser Use search**; if recent data exists, skip the paid search. Recency-gated, force-refresh
  override. This stops duplicate paid searches when the same relative recurs across cases.
  - Add to `hermes/src/mcp-server.js` (tool) + `hermes/src/hm-api.js` (client) + a read in
    `src/lib/db/research.ts` (query recent evidence items by `normalizedName`).

**Phase A done when:** a new run produces an evidence package whose items carry the new typed fields +
raw quotes, CRM items are tagged, and a duplicate case/person is skipped (with force override working).

---

## Phase B — Derive (deterministic, `src/lib/research/derive.ts` + `confidence.ts`)

Goal: turn the richer evidence into the two-section dossier with explainable confidence. Pure,
fixture-tested, re-derivable. Update `Dossier` in `types.ts`.

### B1. Two contact sections (the core split)
- **Actionable Contacts** — people with `deceasedStatus !== 'deceased'` AND at least one contact
  method. For each: all phones/addresses/emails, **ranked**, kept (none dropped).
- **Family Structure** — EVERYONE (living + deceased), grouped by `relationCategory`, showing
  relationship-as-stated, deceased status, maiden names. This is the "understand the surnames / family
  tree" view — informational, not actionable.

### B2. Per-contact ranking (no false precision)
Rank each phone/address/email by a transparent, explainable signal:
- **# of independent corroborating sources** (distinct `sourceId`s asserting it) — primary.
- **evidenceStrength** of the asserting sources (B7) — a probate-sourced address outweighs a
  people-search one.
- **recency** (`lastReportedAt`) — tiebreaker; most-recent first.
- Surface the ranking as `HIGH/MED/LOW` **derived from those signals** (e.g. ≥2 sources = HIGH), with
  the reason shown ("3 sources, last seen 2024"). Never a bare number on one datum.
- Keep numeric internal score if useful for ordering, but the UI shows the checklist + band.

### B3. Explainable confidence (`confidence.ts`)
Per person AND per relationship: a `✓/✗ checklist` of evidence present (identity match, death
confirmed, relationship sourced, address corroborated, phone found, …) → a **band**
(`high|medium|low|conflicting`). Keep the numeric score internal; the dossier exposes the checklist +
band + a one-line `explainBand`.

### B4. Research Completeness + Conflict objects
- Derived `✓/⚠` flags: `deathConfirmed`, `closeFamilyIdentified` (NOT "direct descendants"),
  `contactsFound`, `propertyConfirmed`.
- **Formalize conflicts as typed derived objects** (not a vague note):
  ```ts
  Conflict {
    type: 'death_date' | 'living_status' | 'relationship' | 'address' | 'identity' | 'other'
    description: string          // human-readable ("two death dates: 2019-03 vs 2021-08")
    evidenceIds: number[]        // the disagreeing evidence items
  }
  ```
  Derivation detects them (two `deceased` items with different `dateOfDeath`, a `living` vs `deceased`
  disagreement, conflicting relationship/address) and emits `conflicts: Conflict[]` on the `Dossier`.
  Conflicts are interpretation → derived here, never captured by the agent. A non-empty list drives the
  `conflicting` confidence band.

### B5. CRM vs researched
Carry `isFromCrm` through derivation so the dossier can render two clearly separated groups. Never
silently merge a CRM contact with a researched one.

### B6. Timeline + source intelligence (reuse existing telemetry — don't rebuild)
- **Research Timeline / failed searches** = derive from the evidence package's `plan.steps` +
  `telemetry` at ingest (`src/lib/research/ingest.ts`). Each step's status (done/failed/replanned)
  is the timeline; failed steps are the "saved failed searches." Surface each step's `reason` (A2) so
  the timeline shows *why* each search happened.
- **Source intelligence** = the existing `source_attempts` + `getSourceHealth()`, now groupable by
  `sourceType` (B7) for category analytics ("obituaries 91%, people-search 42%"). Surface
  success/block rates. (Auto-prioritization is DEFERRED — track now, automate later.)

### B7. evidenceStrength mapping (derived, not captured)
Map `provenance.sourceType → evidenceStrength` deterministically in `derive.ts`:
`probate | government → strong`, `obituary | funeral | property → medium`, `people_search → weak`,
`crm → strong` (we trust our own record), `other → weak`. Feeds B2 ranking and B3 confidence. Because
it's derived from a captured fact, the mapping is re-tunable later without re-running research.

**Phase B done when:** `deriveDossier` on a fixture evidence package produces both sections, ranked
contacts with reasons, per-person/relationship checklists+bands, completeness flags, typed conflicts,
CRM split, a timeline (with step reasons) from `plan.steps`, and strength derived from `sourceType`.
All via `npm test` fixtures — no live calls.

---

## Phase C — View (`src/app/dashboard/research/page.tsx`)

Restructure the dossier detail panel to answer the 3 questions, top to bottom:
1. **Research Completeness** summary (✓/⚠ chips) + a **Conflicts** banner when `conflicts[]` is
   non-empty (e.g. "⚠ two death dates disagree") linking to the disagreeing evidence.
2. **Actionable Contacts** (top, most important) — per person: ranked phones (most-recent first) →
   addresses → emails, each with HIGH/MED/LOW + reason (sources, strength, recency) + `contactMethodStatus`.
3. **Family Structure** — grouped by relation, living/deceased, maiden names, relationship-as-stated.
4. **Research Timeline** — steps with status + `reason` (incl. failed searches).
5. **Evidence, grouped by person** — each item shows the **raw source quote**, source host,
   `sourceType`, retrieved date, corroboration count, derived strength.
6. **CRM vs Researched** — clearly separated.

Keep the existing master-detail layout, cost display, and live-progress panel. Reuse the existing
`react-hooks/purity` disable pattern only where a live time check is genuinely needed.

**Phase C done when:** opening a dossier shows the six sections, contacts ranked & most-recent-first,
relationships with their raw quotes, and CRM/researched visibly separated.

---

## Phase D — Easy wins + verify

- **Batch extraction** (landed in A2) — confirm one obituary pass, not per-relative scrapes.
- **Idempotency** (landed in A3) — confirm duplicate case/person is skipped, force override works.
- **Verify Browser Use engages** — run one real anti-bot people-search; confirm Browser Use (not a
  generic fallback) handled it and HTTP/Firecrawl handled the obituary/property pages.

---

## Deferred (Mo's call — build the hooks now, automate later)

- **Cost verification** via Anthropic Usage & Cost Admin API (current cost-sync stays as the estimate).
- **Source auto-prioritization** (we record `source_attempts`/`getSourceHealth` now; auto-ranking later).
  Push this furthest down — calibrate on ~100 real cases, not a heuristic today.
- **Phone-validation API** — `contactMethodStatus` is designed for it; wire the API later to flip
  `unverified → valid/stale/invalid` and prune dead numbers.
- **Global Person-merge engine.** We capture `normalizedName` now (the dedup key), but DEFER a
  cross-case `Person` table that *fuses* same-named people. Same-name ≠ same-person, and a bad
  auto-merge (two different "Norman Taylor"s) is worse than duplicate records — it needs real case
  data to calibrate, like auto-prioritization. The `normalizedName` seam means adding it later is cheap.

---

## Build order checklist

- [x] A1 evidence schema (`types.ts`): + `sourceType`, `normalizedName`, required `sourceText`; fixtures
- [x] A2 playbook capture rules (full family, always-phones, emails, batch, Browser-Use scope, quotes,
      `sourceType`, `normalizedName`, per-step `reason`)
- [x] A3 idempotency: case-level skip + `get_prior_evidence` (by `normalizedName`) + force override
      — *backend done; live end-to-end verification pending VPS deploy*
- [x] B1–B5 derivation: two sections, ranking, confidence checklists, completeness, **conflict objects**, CRM split
- [x] B6 timeline (with step reasons) + source intelligence by `sourceType`
- [x] B7 `sourceType → evidenceStrength` mapping
- [x] C view: six-section detail panel + conflicts banner
- [x] D verify (from existing-run telemetry, 0 credits): batch extraction ✓ (full family one pass);
      Firecrawl/HTTP scoped to obituary/property + GIS-API preferred ✓; idempotency wired (case-skip in
      `/api/research`, `get_prior_evidence` has real reuse data — 26 phones). **Gap found + fixed:**
      ingest never fanned `telemetry → source_attempts` (source intel read an empty table) →
      `src/lib/research/telemetry.ts` normalizer + ingest fan-out + 7-package backfill (48 attempts).
      **Open finding (Mo's call):** Browser Use is getting **blocked on anti-bot people-search**
      (fastpeoplesearch/truepeoplesearch) and falling back to search snippets — the one source it's
      scoped for. people_search = 40% success / 33% blocked. Decide whether to invest in proxy/Browser-Use
      config before relying on it. Firecrawl credit usage is NOT recorded in `research_costs.firecrawl_calls`
      (still 0 despite 138/150 real credits used) — wire Hermes cost-sync to report it.
- [ ] `npm test` green throughout (668 pass); PR (no direct push to main)
