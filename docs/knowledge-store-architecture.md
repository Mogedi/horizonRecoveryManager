# Recoverable Asset Intelligence Platform — knowledge architecture

> The store unifies **everything we know** — from HubSpot, research, calls, emails, validation, and whatever
> we add next — so any pull starts from what we know and only fills gaps. It is **entity-centric**: the core
> entities are **Person · Asset · Organization**, and **Case** is an *operational* construct used to recover
> an asset. The thing at the center is not property — it's a **recoverable asset** (tax surplus today;
> unclaimed funds, insurance proceeds, dormant accounts tomorrow). Designed to **grow over time** without
> redesigning the data model.
>
> Two lenses: the **software engineer** (clean, extensible, re-derivable) and the **operator** running a
> recovery business (cost, speed, compliance). Revised after design review (2026-06-15).
>
> *(Filename is legacy `person-knowledge-store`; the model is now entity-centric — rename to
> `knowledge-store-architecture` when convenient.)*

---

## 1. Scope — entity-centric, not case/person/property-centric
The Knowledge Store has **no single primary entity**. Core entities:
- **Person** — reusable identity (John Smith, Patrick Burchett): identity, contacts, deceased status,
  relationships, phone validations.
- **Asset** — the thing potentially worth money: tax-sale surplus, mortgage surplus, unclaimed property
  (state/DOR), insurance proceeds, payroll checks, brokerage/bank accounts, escrow/utility refunds.
- **Organization** — holders & parties: DOR, banks, insurers, utilities, employers, counties/courts,
  attorneys, lenders/servicers.

**Case is an operational construct**, not a core entity — created when an asset becomes *actionable* (we
decide to pursue it). **Persons and Assets exist without a Case.** The operations layer is case-centric; the
knowledge store is entity-centric.

> *Why this matters:* the common denominator across every recovery vertical is a **recoverable asset**, not
> real estate. Asset-first means the same model serves GA tax surplus, FL surplus, mortgage surplus, DOR /
> state unclaimed funds, insurance recoveries, and future verticals — **with no data-model redesign.**

## 2. Entity model
**Person** — id + identifiers (names/aliases, phones, emails, DOB/age, addresses, HubSpot contact id);
PersonFacts (identity, deceased+DOD, contacts, validations, relationships). *Case-agnostic, reusable.*

**Asset** — common fields, then subtype-specific:
```
asset_id · asset_type · state · amount_estimate · source · status · owners[] (→Person, role)
```
| `asset_type` | subtype fields |
|---|---|
| `REAL_ESTATE_SURPLUS` (tax sale) | parcel_id, address, county, tax_deed, sale_date |
| `MORTGAGE_SURPLUS` | property, foreclosure_date, lender (→Org), sale_amount |
| `UNCLAIMED_PROPERTY` (state/DOR) | claim_id, holder (→Org), reported_date |
| `INSURANCE_PROCEEDS` | carrier (→Org), policy_number, beneficiary (→Person) |
| `PAYROLL_CHECK` | employer (→Org), amount, issued_date |
| `STOCK_ACCOUNT` / `BANK_ACCOUNT` | institution (→Org), account_ref, dormancy_date |
| `ESCROW_REFUND` / `UTILITY_REFUND` / `OTHER` | holder (→Org), reference |

**Organization** — id, type (holder / county / court / law_firm / lender / carrier / institution), name,
identifiers (domain, jurisdiction). Reusable across assets/cases.

**Case** (operational) — id, the asset(s) it pursues, HubSpot deal, pipeline stage, owner, **operational
conclusions** (§10). Created when an asset is actionable.

**Edges (entity-centric graph):**
```
 Person  ──owner/heir/claimant/beneficiary──▶  Asset  ──pursued-by──▶  Case
   │                                             │                       │
   └──relationship (family graph)──┘     holder/lender/carrier      attorney/court
                                            ▼ Organization ◀──────────────┘
```

## 3. Entry points — Horizon has many, document them (they shape the APIs)
There is no single root; opportunities enter from different entities:
| Vertical | Discovery flow |
|---|---|
| Tax foreclosure | **Property → Asset (surplus) → Person (owner/heirs) → Case** |
| State / DOR unclaimed | **Asset → Person → Case** |
| Probate lead | **Person → Asset → Case** |
| Insurance proceeds | **Asset → Person (beneficiary) → Case** |
The store must support starting from a Person, an Asset, or an Organization — and assembling outward.

## 4. Four layers (per entity)
```
 Evidence            Resolved Entity        Golden Context           Operational Conclusions
 (immutable facts) → (identity-merged)    → (best value/attribute  → (interpretations that change often —
  w/ provenance)                            w/ provenance + conf.)    mostly Case-level; §10)
```
The 4th layer is derived + volatile (probate required, research completeness, recoverability) — it sits
**above** facts, re-computed on read, **never stored as a fact**.

## 5. Identity resolution (per entity)
- **Person:** normalized name **+ strong identifiers**; merge only on a shared strong identifier; name-only
  stays separate + ambiguous-flagged. **Under-merge over mis-merge.**
- **Asset:** type-specific natural key — `parcel_id + county` (real estate), `claim_id + holder` (DOR),
  `policy_number + carrier` (insurance). Dedupe the *same asset* across discoveries.
- **Organization:** name + domain/jurisdiction.
- All resolution is a **signal-based decision** with a confidence, re-runnable. ([Cleanlist](https://www.cleanlist.ai/glossary/golden-record))

## 6. Source-adapter framework (grow over time)
Every source implements `fetch → normalize → emit provenanced facts` tagged to an entity. Adding a source =
a new adapter; the store/resolution/serving don't change.

| Adapter | Status | Feeds | Reliability (§7) |
|---|---|---|---|
| Government / county / court records | have | Asset, Org, probate | **1.0** |
| State unclaimed / DOR | future | Asset | 1.0 |
| Obituary / death index | have | Person (deceased) | 0.9 |
| Phone validation (Trestle) | have | Person contacts | 0.9 (attribute) |
| HubSpot | have | Person, Case, Asset linkage | 0.7 |
| Calls / Gmail / Google Chat | have / future | Person comms | 0.7 |
| People-search | have | Person contacts/relatives | 0.5 |
| Insurance / institution holders | future | Asset, Org | per-source |
| Agent inference | n/a | hypotheses | 0.3 |

Contract: `interface SourceAdapter { id; reliability; mode:'batch'|'event'; fetch(key): RawRecord[]; normalize(raw): Fact[] /* tagged person|asset|org */ }`.

## 7. Provenance, confidence, source reliability, conflict
- **Provenance** on every attribute (origin + quote + timestamp) — foundation for compliance *and*
  confidence. ([MDM maturity](https://marionoioso.com/2026/01/29/master-data-management-golden-record/))
- **Two confidences:** *resolution* (same entity?) vs *attribute* (value correct?) — never merged.
- **Source reliability weight in the schema now** (gov 1.0 · obituary 0.9 · phone-val 0.9 · HubSpot 0.7 ·
  people-search 0.5 · agent inference 0.3). Every derived confidence = corroboration × reliability × recency.
- **Conflict:** keep all competing values; derive the winner. Never overwrite.

## 8. Negative evidence ("searched, not found") — first-class
Store searches that found nothing: `{ entity, searched:'GA DOR unclaimed', result:'no asset found', at, ttl }`.
So Hermes says *"DOR searched 14 days ago — none found"* and **skips the repeat** instead of re-running it.

## 9. Freshness — source-specific, not one TTL
| Fact / source | Refresh |
|---|---|
| Obituary / deceased=true | **Never** |
| Death index (living/unknown) | 6 months |
| Phone validation | 30 days · Address | 60 days |
| Property / asset ownership | 30 days · Probate / DOR search | 30 days |
| Negative search outcomes | per-search TTL (14–30 days) |
| **DNC scrub** | **Before every call** (never cache) |

## 10. Operational Conclusions (case-centric, derived on read)
Mostly per **Case**, answering *"what's missing / is this worth pursuing?"*:
- **Research Completeness** — identity / death / heirs / contacts / **asset verified** / probate %, weighted
  overall. The "what's missing?" view Kathleen actually wants.
- **Recoverability** (asset-level): claim difficulty, expected recovery amount/difficulty.
- **Contactability** (person-level), **lead quality**, **case readiness**, **heir-tree-complete confidence**.
All derived from facts × reliability — **never stored as facts**.

## 11. Compliance & legal guardrails (do NOT skip)
- **FCRA:** public-record/identity data **only**; never store credit-bureau data; mark each source's status.
  ([BatchData](https://batchdata.io/blog/best-skip-tracing-services-real-estate-investors-2026-rankings))
- **TCPA:** consent; **calling hours 8am–9pm local** → store each person's timezone, enforce in software.
- **DNC:** **scrub before every call** (~$43.8k/violation); `callable` flag + scrub adapter; log the scrub.
- **GLBA / FTC Safeguards + CCPA/state privacy:** encryption, access control, retention, deletion-on-request.
- **Audit trail:** immutable record of what we knew, from where, what we did — provenance + `agent_audit_log`.

## 12. Serving & consumption
- `getCaseContext(caseId)` → the asset(s) + linked persons (by role) + orgs + **operational conclusions**.
- `getAssetContext(assetId)` · `getPersonContext(key)` · `getOrgContext(id)` → each entity's golden profile.
- **Agent:** expanded `get_prior_evidence` returns person + asset + org facts + **negative outcomes** +
  callable flags → researches only gaps; never re-derives; never calls illegally.
- **Dashboard:** case view (completeness + "what's missing" + provenance), asset/person/org views.

## 13. Anti-patterns to avoid
- **A single hardcoded primary entity** (case/person/property) — the store is entity-centric.
- **Modeling Property instead of Asset** — boxes you into real estate.
- **Storing interpretations as facts** (`probate_required` beside facts) — use the Operational layer.
- **Stuffing case knowledge into persons/assets** — case knowledge is operational.
- **Binary matching / over-merging**; **one confidence number**; **overwriting on conflict**.
- **Graph before provenance**; **treating the cache as truth**; **bespoke integration per source**.
- **One generic TTL**; **acting on stale data**; **no negative evidence**.
- **Compliance as an afterthought**; **PII sprawl** into logs/caches.

## 14. Phased roadmap
1. **Schema: `person_facts` + `asset_facts` (typed) + `organization_facts` + `search_outcome` (negative)**,
   with provenance + **source-reliability** + **source-specific freshness** from day one. Expand
   `get_prior_evidence`. Start with the two live asset types (`REAL_ESTATE_SURPLUS`, `MORTGAGE_SURPLUS`).
2. **HubSpot adapter + identity resolution + backfill** — link cases ↔ assets ↔ persons; start populated.
3. **Operational layer — Research Completeness + recoverability** (the "what's missing / worth it?" view).
4. **Compliance layer** — timezone/calling-hours, DNC/litigator scrub, `callable`, audit.
5. **New asset types + adapters** — DOR/unclaimed, insurance; Google Chat, email/address verifiers.
6. **Dashboard** — case completeness + entity views + golden-context API for the agent.

## 15. What we already have to build on
Provenanced immutable evidence · `phone_validations` (the pattern to copy) · HubSpot db layer · call
transcripts · Gmail sync · `agent_audit_log` · the re-derivable dossier engine. The store unifies these into
an entity-centric model that scales across recovery verticals.
