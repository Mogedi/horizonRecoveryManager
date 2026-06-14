# Research Agent — Property Pipeline Gameplan

> **For Claude:** Build in order — **capture → derive → view → export**. This is the next vertical
> after the v3 person dossier (`docs/research-agent-v3-plan.md`, Phases A–D complete). It reuses the
> same locked seam: Hermes writes immutable evidence → Horizon derives → dashboard renders. Keep each
> phase green (`npm test`) before the next. PR only — no direct push to main.

## Why this exists

The person dossier answers "who can I contact?" The property pipeline answers the other half of a
surplus-funds case: **"what is the property, who really owns it on record, what's owed against it, and
is there a tax-deed/surplus event?"** Today the agent captures a little property data incidentally
(the `property` evidence kind exists); this turns it into a first-class, on-demand stage.

## Case type → research profile (BUILT 2026-06-14)

Not every case wants property research. The business runs **tax sale** + **mortgage foreclosure**
(property matters) and **state funds** + **estate sale** (contacts matter, property is a waste of
Browser Use / Firecrawl / time). Case type is **managed in the Horizon dashboard** (our DB, NOT
HubSpot — all 156 deals are one HubSpot pipeline with case type only implied by stage "F" = mortgage).
- `Deal.caseType` column (survives HubSpot syncs — `upsertDeals` never touches it). Selector in the
  deal panel; `PATCH /api/deals/[id]/case-type`.
- Policy lives in `src/lib/research/case-type.ts` (`RESEARCH_PROFILES`, `caseTypeWantsProperty`) — pure,
  tested, extensible (new type → declare a profile). `unknown` is permissive (don't block before tagging).
- Gating: the "Run property search now" button hides for state_funds/estate_sale; `POST /api/research`
  refuses `property_records` for those types (reason `case_type_no_property`; `force` overrides).

## Scope decision (locked)

- **Subject property only.** "Run property search now" pulls records for the *case's known property
  address / parcel* — NOT every contact's address. (Contact-address property lookups are deferred —
  cheaper to add later once subject-property is proven; see Deferred.) This keeps Firecrawl spend
  bounded: one property = a handful of GIS/qPublic/GCSS fetches, not N×contacts.

## Non-negotiable principles (inherit from v3 — do not violate)

- **Facts vs interpretation.** Hermes writes ONLY immutable property *evidence* (parcel, owner-of-record,
  assessed value, tax status, lien/deed documents, raw quotes). Owner-vs-subject match, surplus
  relevance, lien totals, confidence — ALL **derived** in `derive.ts`, re-derivable from evidence.
- **County registry first.** Before any blind search the agent calls `get_county_sources(state, county)`
  and, after confirming a method works, records it via `upsert_county_source` (`sourceKind`
  `property|deed`, `method` `gis_api|qpublic|custom_site|propertyradar`). Durable learning, not memory.
- **Structured GIS REST APIs over scraping.** Confirmed working in real runs (Fulton ArcGIS = 100%
  success). Prefer the county GIS/assessor API; fall back to qPublic/Beacon; PropertyRadar last.
- **Firecrawl/HTTP for property + government pages. Browser Use is NOT for property** — it's scoped to
  anti-bot people-search only (and is currently underperforming there — see v3 Phase D finding).
- **Raw quote + typed telemetry on every item** (`provenance.sourceText`; `sourceType` =
  `property|government`; one typed `SourceAttempt` per source — see the v3 playbook telemetry rules).
- Secrets never in evidence/logs/git. DB uses `db push` (never `migrate dev`). PR workflow only.

---

## Phase P-A — Capture (goal + schema + on-demand enqueue)

### A1. New goal + request seam
- Add `Goal` value `'property_records'` in `src/lib/research/types.ts`.
- `PersonQuery` already carries `parcelId`, `county`, `address`, `state`, `caseId` — reuse them as the
  property query anchors. No new query type needed.
- **"Run property search now" enqueue:** POST `/api/research` with `goal: 'property_records'` seeded
  from the existing dossier/case — the subject **property address** (deal address, or the dossier's
  `address` evidence of `kind:'property'`) + county. So it runs on data you ALREADY have — no re-paying
  for the people search.
- **Idempotency:** skip if the case already has recent `property`-kind evidence (reuse the
  `findRecentDossierForCase` pattern, scoped to property goal) unless `force`. Person-level
  `get_prior_evidence` is people-only; property reuse is case+parcel-keyed.

### A2. Evidence schema — extend `property`, add lien/tax
The `property` EvidenceItem today is `{ owner, parcelId?, situsAddress?, deedBook? }`. Extend the value
and add captured fields the surplus case needs (all optional, captured-as-stated, never derived):
```ts
property { owner, normalizedOwner, parcelId?, situsAddress?, deedBook?,
           assessedValue?, landUse?, lastSaleDate?, lastSalePrice?, taxStatus? }  // taxStatus AS STATED
```
For liens / tax-deed events, prefer **document captures** (the existing `documents[]` + `research_documents`
table) for the actual PDF, plus a typed item for the structured fact. Add two evidence kinds:
```ts
lien     { holder, amount?, recordedDate?, instrumentType? }       // from GCSS / clerk records
tax_event{ kind: 'tax_sale'|'tax_deed'|'redemption'|'delinquency', date?, amount?, surplusStated? }
```
- `tax_event.surplusStated` is the **as-stated** surplus figure from the source — never compute it here.
- Capture deed/lien/tax PDFs via `submit_evidence_package.documents` (already wired to
  `research_documents`); link each typed item to its `provenance.documentId`.
- **Do NOT capture** owner-match, surplus relevance, or lien totals — those are derived (Phase P-B).

### A3. Playbook — property capture section (`hermes/research-playbook.md`)
Add a "Property" section: (1) `get_county_sources` first; (2) county GIS REST API → parcel, owner,
assessed value, situs; (3) qPublic/Beacon fallback; (4) GCSS / clerk for liens + deeds (capture PDFs);
(5) tax commissioner / tax-deed list for tax-sale + stated surplus; (6) PropertyRadar last.
Typed telemetry + raw quotes + `sourceType`. One obituary-style batch pass per parcel.

**Phase P-A done when:** a `property_records` run on an existing case produces property/lien/tax_event
evidence + captured deed PDFs, all typed with raw quotes, and a duplicate property run is skipped
(force override works).

---

## Phase P-B — Derive (deterministic, `derive.ts`)

Add a derived **Property** section to `Dossier` (additive — older dossiers stay valid):
```ts
propertyRecord {
  parcelId?, situsAddress?, ownerOfRecord?, assessedValue?,
  ownerMatchesSubject: boolean | null,   // DERIVED: normalizedOwner vs subject/heirs
  liens: { holder, amount? }[], lienTotalStated?,   // sum of AS-STATED amounts, labeled "stated"
  taxEvents: TaxEvent[], surplusRelevant: boolean,  // DERIVED flag, not a dollar guarantee
  documents: { kind, sourceUrl }[],
}
```
- **Owner-mismatch is a real conflict** already seen in live data (parcel owner `SHOFFNER ZEMIA` ≠
  subject `Cecil Sumpter`, pkg 6). Reuse the existing `Conflict` object (`type: 'identity'` or a new
  `'ownership'`) so the dossier surfaces "record owner ≠ claimant" prominently.
- Feed `propertyConfirmed` completeness flag (already exists) from presence of a parcel.
- `lienTotalStated` / `surplusRelevant` are derived + labeled clearly — **no false precision** (these
  are "as stated by source," not legal/financial conclusions).
- Strength: `government → strong`, `property → medium` (existing B7 mapping — no change).

**Phase P-B done when:** `deriveDossier` on a property-evidence fixture yields the property section,
owner-match flag, lien total (stated), tax events, surplus-relevant flag, and an ownership conflict
when owner ≠ subject. All via `npm test` fixtures.

---

## Phase P-C — View (`src/app/dashboard/research/page.tsx`)

Same page (your call). Restructure the detail panel:
- **Collapsible people sections** — Actionable Contacts + Family Structure collapse so the panel isn't
  overwhelming once property is added.
- **"Run property search now" button** — enqueues the `property_records` goal for this case; shows the
  live-progress panel (reuse existing). Disabled while a property run is in flight.
- **Property section** (new) — parcel, owner-of-record with a ⚠ **"record owner ≠ claimant"** banner
  when `ownerMatchesSubject === false`, assessed value, liens (with stated total), tax events / stated
  surplus, and links to captured deed/lien PDFs.

**Phase P-C done when:** a case with property evidence shows the property section, people sections
collapse, and the button triggers a property-only run.

---

## Phase P-D — Export to Google Drive (NEW write capability)

Today `src/lib/integrations/google/` is **read-only** (Drive *indexing*/listing). Export needs:
- **A new OAuth scope** (`drive.file` — create files the app owns) — Mo authorizes. Flag before building.
- A `createFile`/upload method on `google/client.ts` (additive; keep the existing read path intact).
- **Manual button only** — "Save dossier to Drive" (NOT automatic — matches the AI/Layer-2 manual rule).
  Render the dossier (person + property) to PDF/HTML, write into the case's existing Drive folder
  (reuse the deal→folder match from `drive-index.ts`).

**Phase P-D done when:** clicking "Save to Drive" writes a dossier file into the case's Drive folder;
no auto-export; read paths unaffected.

---

## Deferred (build the hooks now, automate later)

- **Contact-address property lookups** (property for each heir's address) — combinatorial cost; prove
  subject-property first. Gated on idempotency working live (same reason as the v3 relatives layer).
- **Property photos** — capture as `documents` later (Street View / GIS imagery); schema already allows.
- **PropertyRadar paid API** — registry `method: 'propertyradar'` exists; wire the paid client later,
  use free GIS/qPublic first.
- **Auto-export to Drive** — keep manual until the dossier format is stable.

---

## Build order checklist

- [ ] P-A1 `property_records` goal + "Run property search now" enqueue (seeded from existing case) + idempotency
- [ ] P-A2 schema: extend `property`, add `lien` + `tax_event` kinds; deed/lien PDFs via documents; fixtures
- [ ] P-A3 playbook property section (registry-first, GIS→qPublic→GCSS→tax-deed, typed telemetry)
- [ ] P-B derive: property section, owner-match flag, ownership conflict, lien total (stated), surplus-relevant
- [ ] P-C view: collapsible people sections + button + property section + owner-mismatch banner
- [ ] P-D Drive export (new `drive.file` scope + createFile + manual "Save to Drive" button)
- [ ] `npm test` green throughout; PR (no direct push to main)
