# Horizon Research Agent — Design Doc (v2)

Status: **design, ready to implement.** v2 supersedes v1 after a CTO-level review.
Author: design review with Mo + Claude Code.

> v1 built deterministic per-source scrapers inside HorizonManager. The live pass proved that's the
> wrong shape: every GA county is a different, partly-defended system, and a rigid pipeline just gives
> up when blocked. v2 moves the *research* into Hermes (an agentic runtime) and keeps the *business
> logic + data + UI* in Horizon, joined by one immutable contract.

---

## 1. What this is (reframed)

Not "skip tracing." The product is **Probate Research / Claimant Discovery** for surplus recovery.
Given a name + property address, the system researches the case the way a forensic genealogist would
([probate research](https://en.wikipedia.org/wiki/Probate_research)): confirm the property/owner,
determine **alive or deceased** (~60% deceased), and when deceased build the **heir graph** —
relationships, addresses, phones, and supporting documents — with explainable confidence and a human
making the final call.

The valuable output is not `{ "phone": "..." }`. It's:

```json
{ "deceased": true, "heir_graph": {...}, "candidate_people": [...], "relationships": [...],
  "addresses": [...], "phones": [...], "documents": [...], "confidence": "high", "review_status": "pending" }
```

**Browser = commodity. Evidence = valuable. Entity resolution = the moat.**

---

## 2. Core principles (the contract that prevents drift)

1. **Hermes = behavior. Horizon = storage + business brain.**
   - Hermes searches, browses, reasons, collects **evidence**, and writes it back. Nothing else.
   - Horizon stores evidence, runs entity resolution + scoring + heir-graph, owns all schemas, runs
     the review workflow, and renders the view/reports.
2. **Evidence is immutable + provenance-tracked. Every business object is derived and re-derivable.**
   - Hermes can only write **raw evidence with provenance** (source URL, timestamp, snippet, the raw
     extract). It can NEVER write a score, a heir decision, or any business object.
   - Horizon derives dossiers/scores/heir-graphs from stored evidence. When the logic improves, Horizon
     **re-runs over stored evidence — no re-scraping.** Evidence is the permanent asset; derived objects
     are disposable.
   - This boundary *structurally* prevents the #1 risk (business logic drifting into Hermes): if Hermes
     can't write a business object, the logic can't live there.
3. **Memory is a speed cache, never a source of truth.**
   - Hermes may remember things within a run for speed, but durable learnings (e.g. "Gordon County →
     gordonassessors.com, search works like X") are **written to the `county_sources` table in Horizon**,
     verified and telemetry-backed — not trusted from model memory.
4. **Plan → Execute → Re-plan.** The mission is structured, so Hermes plans first, executes, and
   re-plans a step when it's blocked — bounded by a budget. (Resilient plan-then-execute; see §6.)
5. **Human makes the final decision.** No auto-outreach, no auto-CRM writes. Every dossier is reviewable;
   every score is explainable; every source is traceable.
6. **Contracts over runtimes.** The `EvidencePackage` schema, the DB, the MCP, and the UI are Horizon's.
   If Hermes is ever replaced (OpenAI agent, custom worker), the data and UI survive unchanged.

---

## 3. Architecture

```
HorizonManager (Vercel + Neon)  ── system of record + business brain + view
  • Research page → enqueue research_request (returns instantly; no serverless timeout)
  • Stores: research_requests (queue) · evidence_packages (IMMUTABLE) · dossiers (DERIVED)
            research_documents · source_attempts (telemetry) · county_sources (verified registry)
  • Deterministic engine: entity resolution → heir graph → claimant scoring → confidence → review_status
            (re-runnable over stored evidence)
  • Dashboard: review / approve / reports
        │ enqueue ↓                                        ↑ read for display
HorizonManager MCP (VPS)  ── the bridge / the contract surface
  • read:  next pending request, case data, county_sources, prior evidence
  • write: evidence_package, documents, telemetry, county_source upserts, mark request done
        ↑ Hermes calls these
Hermes (Nous, VPS)  ── the research runtime (plan → execute → re-plan)
  • Native tools: web_search, browser (Patchright/Browser Use), plus the MCP read/write tools
  • Research playbook (a skill): the plan-execute-replan loop, budget-bounded
  • Memory = speed only; durable learnings are written to county_sources
        ↑ brains
Claude (Sonnet/Opus, inside Hermes)
```

Triggering is **queue-based** (handles bursts of 100–300): the dashboard enqueues instantly; Hermes
drains the queue at its own pace with concurrency + per-run budgets; results appear in the view as they
land. Ad-hoc "research the X case" from Discord is a thin add-on that enqueues the same way.

---

## 4. The two contracts (the seam — design first, version it)

### 4a. EvidencePackage — Hermes → Horizon, **immutable**
Everything Hermes is allowed to produce. No scores, no business objects — only evidence + provenance.

```ts
interface Provenance {
  sourceId: string          // e.g. 'qpublic:gordon', 'fastpeoplesearch', 'legacy.com'
  url: string
  retrievedAt: string       // ISO
  snippet?: string          // the raw text the claim came from
  documentId?: number       // if backed by a captured document
}

interface EvidenceItem {
  kind: 'identity' | 'address' | 'phone' | 'email' | 'relationship' | 'deceased' | 'property' | 'note'
  value: unknown            // shape depends on kind (see below)
  provenance: Provenance
}

// value shapes by kind:
//  identity     { name, ageOrDob? }
//  address      { line1, city, state, zip, kind: 'property'|'mailing'|'current'|'prior' }
//  phone        { number, label? }
//  email        { address }
//  relationship { person, relationToSubject, otherName }   // e.g. "survived by daughter Jane Smith"
//  deceased     { isDeceased: boolean, dateOfDeath?, source: 'obituary'|'ssdi'|'probate'|'inferred' }
//  property     { parcelId?, owner, situsAddress, deedBook? }

interface CandidatePerson {
  localId: string           // stable within this package
  name: string | null
  evidenceRefs: number[]    // indices into evidence[] that describe this person
}

interface ResearchPlan {
  goal: 'locate_owner' | 'find_heirs' | 'mailing_address' | 'contact'
  steps: { n: number; intent: string; source?: string; status: 'planned'|'done'|'failed'|'replanned' }[]
}

interface EvidencePackage {
  requestId: number
  query: PersonQuery
  plan: ResearchPlan        // auditable: what Hermes intended + what happened
  candidates: CandidatePerson[]
  evidence: EvidenceItem[]  // the immutable corpus, each with provenance
  documents: { documentId: number; kind: string; sourceUrl: string }[]
  telemetry: SourceAttempt[]
  notes: string[]
  budget: { stepsUsed: number; sourcesHit: number; capHit: boolean }
  completedAt: string
}
```

### 4b. Dossier — Horizon-**derived**, re-derivable from the package
Built by Horizon's deterministic engine; recomputed whenever ER/scoring logic improves.

```ts
interface Dossier {
  evidencePackageId: number
  subject: { name: string; deceased: boolean | null; dateOfDeath?: string }
  heirGraph: HeirGraph                 // people + relationships (for deceased owners)
  candidatePeople: ScoredCandidate[]   // each with claimantScore + justification
  contactRankings: { person: string; phones: string[]; emails: string[]; rank: number }[]
  confidence: { band: 'high'|'medium'|'low'|'conflicting'; justification: EvidenceItem[]; conflicts: EvidenceItem[] }
  reviewStatus: 'pending' | 'approved' | 'rejected' | 'needs_more'
  generatedAt: string
}
```

---

## 5. The agent loop (resilient plan-then-execute)

Per the 2026 research, plan-then-execute is the reliable, low-cost, auditable pattern for structured
missions — *with a re-planner* so it isn't brittle on the open web
([Resilient Plan-then-Execute, arXiv 2509.08646](https://arxiv.org/pdf/2509.08646);
[ReAct vs Plan-and-Execute](https://dev.to/jamesli/react-vs-plan-and-execute-a-practical-comparison-of-llm-agent-patterns-4gh9)).
Evidence is a first-class state structure with a budget
([DeepEvidence, arXiv 2601.11560](https://arxiv.org/pdf/2601.11560)).

```
1. GATHER INPUTS   name + address → county (free Census geocoder)
2. PLAN            draft the research plan for the goal (locate_owner | find_heirs); record it
                   consult county_sources for a known-good method before searching blind
3. EXECUTE         per step: web_search to FIND the right source → navigate → extract evidence →
                   capture documents → append EvidenceItems with provenance
4. RE-PLAN         on block/empty (frameset, Cloudflare, no result): re-plan that step
                   (GIS REST API / cached page / alternate site / people-search), budget-bounded
5. LEARN           on a newly-confirmed working method → upsert county_sources (verified, not memory)
6. RETURN          assemble the EvidencePackage → write via MCP → mark request done
7. DERIVE (Horizon) entity resolution → heir graph → claimant scoring → confidence → dossier
8. REVIEW (human)   approve / reject / request more in the dashboard
```

Budget caps (steps, sources, wall-clock, $) bound cost during 100–300 bursts and stop runaway loops.

---

## 6. Entity resolution, heir graph, scoring (Horizon, deterministic)

Best practice = **deterministic rules + probabilistic/fuzzy scoring + a justification engine**, all
explainable and auditable ([(Almost) all of entity resolution, Science Advances](https://www.science.org/doi/10.1126/sciadv.abi8021)).
This is the moat and it lives entirely in Horizon, re-derivable from evidence.

- **Anchor on the property.** The owner-of-record address is the strongest disambiguator.
- **Signals** (tunable, transparent): property/exact/prior address, city, state, name similarity,
  relationship overlap, age, phone/email overlap. Corroboration weights by **independent** sources
  (broker echoes don't count multiple times).
- **Heir graph** (for deceased owners): nodes = people, edges = relationships extracted from obituaries
  ("survived by…"), probate filings, and people-search "associated persons." Forensic-genealogy framing.
- **Claimant score + justification**: each candidate gets a score *and* the human-readable evidence
  behind it. Output is a **band** (`high|medium|low|conflicting`) + evidence + explicit conflicts —
  never a fake probability.

---

## 7. county_sources — learned-but-verified registry (Horizon)

The durable replacement for "Hermes remembers." Telemetry-backed; decays when it starts failing.

```ts
interface CountySource {
  state: string; county: string
  sourceKind: 'property' | 'deed' | 'probate' | 'obituary'
  method: 'gis_api' | 'qpublic' | 'custom_site' | 'propertyradar'
  entryUrl: string
  searchHint: string        // how to search it (params / steps), discovered once
  lastVerifiedAt: string
  successRate: number        // from source_attempts
  status: 'active' | 'degraded' | 'broken'
}
```

Hermes reads this before searching blind; on a confirmed new method it upserts a row. If a method's
success rate drops, status → `degraded`, and the next run re-discovers (the "repair" lifecycle).

---

## 8. Sources & coverage (GA-first reality)

The live pass found there is **no unified qPublic** — every county differs:

| County | System | Approach |
|---|---|---|
| DeKalb | classic qPublic (frameset) | direct frame URL / GIS API |
| Cobb | Cloudflare-walled | **GIS REST API** bypass preferred |
| Fulton | custom (fultonassessor.org) | site search / underlying API |
| Gwinnett | qPublic landing | site search / GIS API |
| Gordon (sample) | custom (gordonassessors.com) | site search |

**Preferred order per county:** (1) **GIS/ArcGIS REST API** if one exists (structured JSON, no
scraping, no Cloudflare) → (2) the county site → (3) qPublic. Hermes discovers which works and records
it in `county_sources`. Beyond property: **obituary/death** (Legacy.com, Find a Grave, SSDI — free),
**people-search** (FastPeopleSearch/TruePeopleSearch — defended, telemetry-measured), and the paid
logins via the vault (**PropertyRadar**, **GSCCCA** for deed images). BeenVerified: excluded (quota).
Social (FB/LinkedIn): deferred (flag risk).

---

## 9. Credentials vault, documents, telemetry, review

- **Vault:** per-source creds (GSCCCA, PropertyRadar) as VPS env vars for MVP; encrypted table +
  dashboard UI later. Never in git, logs, evidence, or dossiers. Patchright persistent profile reuses
  sessions so logins are rare.
- **Documents:** capture deed/lien images → PDF (screenshot, not the site print dialog) → stored in
  `research_documents` (bytes + provenance), previewed in the dashboard; Google Drive write is a later
  upgrade (needs scope).
- **Telemetry (first-class):** every source call → `source_attempts`; a `source_health` MCP tool answers
  "which source is reliable / degrading?" in Discord. Circuit-breaker skips sources with high recent
  block rate.
- **Review:** the dashboard renders the derived dossier (band, heir graph, candidates, contacts,
  evidence + source URLs + document previews); approve / reject / request-more. Reports generated here.

---

## 10. Data model (Neon / Prisma)

```
research_requests   id, query Json, goal, status(pending|running|done|failed), enqueuedBy, createdAt, startedAt, finishedAt
evidence_packages   id, requestId, query Json, plan Json, candidates Json, evidence Json (IMMUTABLE), telemetry Json, notes Json, completedAt
research_dossiers   id, evidencePackageId, caseId?, subject Json, heirGraph Json, candidatePeople Json, confidence Json, reviewStatus, generatedAt   (DERIVED, re-creatable)
research_documents  id, caseId?, evidencePackageId?, sourceId, kind, mimeType, bytes, sourceUrl, createdAt
source_attempts     id, sourceId, requestId?, caseId?, status, blockReason?, url, latencyMs, candidateCount, proxyUsed, createdAt
county_sources      id, state, county, sourceKind, method, entryUrl, searchHint, lastVerifiedAt, successRate, status
```

`evidence_packages` are append-only/immutable. `research_dossiers` can be dropped and rebuilt from the
package at any time.

---

## 11. What changes from v1 code

- **Keep & grow:** the DB, `resolution`/`confidence` (this becomes the Horizon derivation engine, now
  fed by an EvidencePackage), telemetry, the dashboard view, `geo.ts`.
- **Replace:** the deterministic adapters + fixed runner (`qpublic.ts`, `fastpeoplesearch.ts`) and the
  Vercel-side `find-person` pipeline → the plan-execute-replan loop moves into Hermes. Their knowledge
  becomes seed rows in `county_sources`, not code.
- **Add:** `research_requests` queue, `evidence_packages` table, `county_sources` registry, the
  EvidencePackage MCP write tools, the Horizon **derivation engine** (ER → heir graph → scoring), and
  the **Hermes research playbook** (plan→execute→re-plan, budget-bounded) + Hermes browser/search tools.

---

## 12. Phasing

- **Build the seam first (no runtime depends on an unlocked contract):** the `EvidencePackage` schema,
  the queue + `evidence_packages` + `county_sources` tables, the MCP read/write tools, and the Horizon
  derivation engine with a **fixture EvidencePackage** (unit-tested end-to-end without any browser).
- **MVP runtime:** the Hermes research playbook over **one path proven to work** — start with the
  GIS-API property lookup (structured, unblocked) + an obituary/death check → real EvidencePackage →
  Horizon dossier → dashboard review. Telemetry from day one.
- **Phase 2:** more county methods (recorded in `county_sources`), people-search (measure block rate →
  decide on Oxylabs proxy), PropertyRadar + GSCCCA via the vault, document capture.
- **Phase 3:** richer heir-graph resolution; reports; revisit the proxy / additional sources by telemetry.

---

## 13. Risks & failure modes

| Risk | Mitigation |
|---|---|
| **Business logic drifting into Hermes** (the #1 risk) | Hermes can only write immutable evidence — never a score/decision. Boundary is structural. |
| Memory treated as truth | Durable learnings go to `county_sources` (verified, telemetry-backed), not model memory. |
| Cloudflare / framesets | Prefer GIS REST APIs; re-plan to alternates; proxy as a measured lever; telemetry + circuit breaker. |
| Plan brittleness | Re-planner step; budget caps stop runaway loops. |
| False match / wrong heir | Property anchor + conflict modeling + `conflicting` band + human review. |
| Cost during 100–300 bursts | Plan-execute (low LLM count) + per-run budgets + queue pacing. |
| Runtime lock-in | Contracts (EvidencePackage/DB/MCP/UI) are Horizon's; Hermes is swappable. |
| Legal / permissible-purpose | Human-final-decision gate; no auto-outreach; research output, not a consumer report. |

---

## 14. References
- Resilient plan-then-execute: [arXiv 2509.08646](https://arxiv.org/pdf/2509.08646) · pattern comparison: [ReAct vs Plan-and-Execute](https://dev.to/jamesli/react-vs-plan-and-execute-a-practical-comparison-of-llm-agent-patterns-4gh9)
- Evidence-graph deep-research agents: [DeepEvidence, arXiv 2601.11560](https://arxiv.org/pdf/2601.11560) · [Deep Research survey, arXiv 2508.12752](https://arxiv.org/html/2508.12752v1)
- Entity resolution best practice: [(Almost) all of entity resolution, Science Advances](https://www.science.org/doi/10.1126/sciadv.abi8021) · [RudderStack overview](https://www.rudderstack.com/blog/what-is-entity-resolution/)
- Probate / forensic genealogy: [Probate research (Wikipedia)](https://en.wikipedia.org/wiki/Probate_research)
