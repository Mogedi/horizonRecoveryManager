# Research Agent — Property Verification & Corroboration Gameplan

> **For Claude:** This plans how property research data is *captured richly, corroborated smartly, and
> surfaced for verification*. It builds on `research-agent-property-plan.md` (P-A/P-B already shipped:
> `caseType` profiles, the `property`/`lien`/`tax_event` schema, the derived property section). Build in
> phases; keep `npm test` green; PR only. **This is a plan — no code until Mo approves.**

## North star (Mo's framing — read first)

- **Right now: get as MUCH property data out as possible, with dead-clear provenance** — every fact shows
  *value + the exact quote + a link to the page it came from*, so Mo (or an employee) can click through
  and verify. "This is coming from here, this from here."
- The system should be **"kinda smart"** about confirming it found the right property/person —
  **guidelined, not hard-ruled.** Trust its judgment; give it guardrails, not a rigid checklist.
- **Future:** the agent uses the data it pulls *mid-research* to make better decisions; the whole loop
  proves to be a good, not-too-expensive automation that **learns to be faster/cheaper over time.**
- **Defer (explicitly, Mo's call):** wrong-match correction, opening lien/deed PDFs by default, the
  surplus math, auto-download to Drive, and all UI polish / hide-vs-surface tuning. Don't build these yet.

## Principles (carry forward + new)

- **Facts vs interpretation.** The agent captures raw facts + provenance. Horizon DERIVES corroboration,
  the subject↔property linkage, and confidence. No business objects from the agent.
- **Source-agnostic.** Corroboration must work across ANY source — qPublic, PropertyRadar, Zillow,
  GSCCCA, county sites. `sourceId` = the host. It is NOT hardcoded to GSCCCA. Working sources are learned
  via the existing `county_sources` registry.
- **Provenance on everything** — value + exact `sourceText` quote + `url` + `sourceId` + `sourceType`.
- **No false precision / no hard minimum.** There is **no fixed number of matches** required. The agent
  makes the **best judgment call**; sometimes a tax deed has only address + parcel and no name — gather
  what's available. Ambiguous → keep **all candidate matches ranked by transparent corroboration signals**
  (NEVER an invented confidence %), flag for Mo, mark the best, **never stop** the run. Seeing the *other*
  candidates is what saves you on common names.
- **Coverage ≠ confidence.** "Did we search enough places?" is a separate question from "is this the right
  property?" — track both, never conflate them (see Core concept 4).
- **Case-dependent depth.** Title-of-property cases (tax sale, mortgage foreclosure) need strong property
  corroboration; `state_funds` / `estate_sale` need little or none. The existing `caseType` research
  profile already gates this — reuse it.
- **Cost-conscious + learning.** Index entries first (no PDF fetch). On-demand deep-dives later. Reuse
  `county_sources` so the system gets faster/cheaper as it learns where to look.

## Core concept 1 — Subject ↔ property linkage (the real "right person?" answer)

The blunt "owner ≠ claimant" flag from P-B is **wrong for this business.** The subject is usually a
**PRIOR owner** — they lost the property at the sale and are owed the surplus, so the *current* owner
will differ. That's expected, not a conflict. The real questions are: **is the subject tied to this
property, and HOW?**

- **Capture:** owner-of-record (current) + the **transaction / deed history** (chain of owners with
  dates + book/page) + the match signals (book/page, partial APN, owner name, situs address).
- **Derive `PropertyLinkage`:** the subject's relationship to the parcel —
  `current_owner | prior_owner | related_party | possible | unlinked` — with the supporting evidence
  ("subject appears as grantor in the 2019 deed, Book 123 Pg 45") and a confidence band.
  - **`related_party`** is essential and common: spouse / heir / executor / administrator / trustee /
    LLC manager / beneficiary of the owner. Mary Smith (heir of owner John Smith) is *clearly tied* but is
    neither current nor prior owner. When linkage is `related_party`, capture **`linkedThrough`** — the
    owner-of-record they connect through + the relationship — and **lean on the existing `relationship`
    evidence + heir graph** (don't re-capture the person relationship).
  - **`relationshipBasis: string[]`** (DERIVED, not captured): how the linkage was established —
    `deed_history | tax_record | probate_record | court_record | marriage_record | trust_record |
    corporate_record | manual_inference`. Derived from the evidence kinds backing the linkage (a
    `transaction` → `deed_history`; a probate evidence item → `probate_record`). Free, and it IS the
    verification story ("tied via probate + marriage record"). Enables later analytics.
  - **`alternatives`:** other candidate parcels the agent considered, each with its corroboration signals
    (NOT a %): "Property A — book/page + owner-name on 2 sources; Property B — address-only on 1." Surfaced
    so Mo (and future staff) can catch a wrong match on a common name.
- **Corroboration:** count independent sources agreeing on the linkage key (book/page seen on qPublic
  AND GSCCCA = strong) — same transparent ranking idea already used for contacts. **No hard threshold**;
  surface the corroboration so Mo judges.
- This **replaces** the P-B ownership-conflict with a richer "how are they tied" view.

## Core concept 2 — Capture more property facts (schema additions)

Extend the `EvidenceItem` union (all "as stated," provenance required):
- `property`: **+ `deedBook`, `deedPage`** (already has owner/parcelId/situs/assessedValue/taxStatus/sale).
- **new `transaction`** `{ date?, type?: 'sale'|'deed'|'foreclosure'|'tax_sale'|'other', grantor?, grantee?, price?, deedBook?, deedPage? }` — the chain that proves the subject was a prior owner. **Transaction history is high value to Mo.**
- `lien`: **+ `released?` (status), `deedBook?`/`deedPage?`** (holder, amount, recordedDate, instrumentType all already present and all important — "most of it is in GSCCCA, just pull it out").
- `tax_event`: optionally **+ `deedBook`/`deedPage`**.

## Core concept 3 — Source-grouped verification view

Lead the dossier's property area with the decision-relevant facts, then "here's where each came from":
- **Subject ↔ property linkage** up top (current/prior owner, with the evidence + corroboration).
- **Verify — by source** cards (started rough already): per source → host + type + **Open source ↗** link
  + the facts it gave, each with its **raw quote**. Source-agnostic.
- **Transaction history** timeline (owner chain → shows the prior-owner tie).
- **Liens** — list **all** of them at **index level** (holder, amount, recorded date, instrument type,
  released?). "Put all the information in front of me." No PDF opening yet (see V2).
- **Tax sale / surplus** (as stated).
- Everything clickable to its source so Mo verifies and downloads the PDF himself for now.
- **Liens** carry a reserved (NOT populated in V1) derived `relevance` bucket for later
  (`tax | judgment | mortgage | hoa | released | unknown`) — we already capture `instrumentType` (as
  stated) + `released`; the normalized bucket is derived in V2 so the schema isn't reworked then.

## Core concept 4 — Research coverage (how hard did we look?)

Distinct from confidence (right property?) — coverage answers **did we search enough places?** It is
**DERIVED, not captured**, from the `telemetry`/`source_attempts` + `plan.steps` we already record:
- A **checklist**, not a score (no false precision): `✓ county records · ✓ deed records · ⚠ tax records not
  searched · ✓ property source (PropertyRadar) · 2 transactions found`.
- Distinguish **searched-but-empty** (telemetry `status: empty`) from **never-attempted** — that's the real
  "how hard did we look." Extends the existing `Completeness` pattern.
- Lets Mo trust a thin result for the right reason ("nothing there" vs "we didn't look").

## Phasing

### Phase V1 — capture + corroborate + surface (now)
- **Schema:** `property` +book/page; new `transaction` kind; `lien` +released/book-page. Update `schema.ts`.
- **Playbook:** capture book/page across sources, transaction history, the subject-as-prior-owner tie,
  source-agnostic corroboration, "no minimum — best judgment, flag ambiguous, never stop."
- **Derive:** `PropertyLinkage` (current/prior/**related_party**/possible/unlinked + `linkedThrough` +
  derived `relationshipBasis[]` + `alternatives` + corroboration); transaction history; **research
  coverage checklist** (from telemetry + plan.steps); reframe the ownership flag as linkage. Pure +
  fixture-tested + snapshot.
- **View:** linkage banner (incl. related-party "heir of owner X" + basis) + source-grouped verify cards +
  transaction history + full lien index + coverage checklist + candidate `alternatives`, leading with
  decision fields. Index-level only.
- `caseType` gates depth (foreclosure/tax = full; state/estate = minimal).

### Phase V2 — on-demand document confirm (later)
- Mark liens/deeds "I'm interested — go read these." Agent opens the PDF, reads, and returns a per-document
  **"matches this case? ✓/✗ + why."** Needs the document-capture/upload path (separate build).

### Phase V3 — automation & polish (later)
- Wrong-match rejection + memory (so re-runs don't repeat a bad match).
- **Surplus math:** corroborate the GA monthly foreclosure list × Auction.com sales × tax sales to compute
  which cases actually have a surplus (currently manual).
- Auto-download documents to Google Drive (trust-earned).
- UI polish: decide what to hide vs surface.

## Files touched (V1)

- `src/lib/research/types.ts` — schema additions (`transaction` kind, `property`/`lien` fields) +
  `PropertyRecord` gains `linkage` (w/ `linkedThrough`, `relationshipBasis[]`, `alternatives`),
  `transactions`, `coverage`.
- `src/lib/research/derive.ts` — linkage (incl. related_party + derived basis) + transactions +
  corroboration + coverage; reframe ownership flag.
- `src/lib/research/schema.ts` — accept the new kind/fields.
- `hermes/research-playbook.md` — property capture additions (book/page, transactions, corroboration,
  prior-owner tie, related-party via existing relationship evidence).
- `src/app/dashboard/research/page.tsx` — linkage banner + source-grouped verify view + transaction
  history + lien index + coverage checklist + alternatives.
- Tests + snapshot.

## Open / to-calibrate later (not blocking V1)
- Per-lien relevance filtering (a parcel can have 30 liens) — for now show ALL; calibrate which matter over time.
- Decision fields to lead with — start with: name match, linkage (prior/current owner), # of contacts,
  lien total (stated), surplus-relevant. Tune later.
- PropertyRadar may get blocked → keep the source swappable; cross-check with free sources (Zillow, county).
