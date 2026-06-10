# Horizon Recovery — Agent Automation Opportunity Audit

*Prepared from a code-level audit of HorizonManager (Next.js 16 / Prisma 7). Grounded in what is actually built, not the roadmap's aspirations.*

*Date: 2026-06-09*

---

## Executive Summary

Horizon Manager is already a rich **read** layer: 150 deals cached, full JustCall call history with Whisper transcripts and Claude classifications, Gmail matched to deals, Google Drive document verification, a pure-function attention rules engine, and per-deal AI summaries. The **write** surface, by deliberate design, is tiny: internal tasks and snoozes only. HubSpot is permanently read-only (`src/lib/hubspot/actions.ts` does not exist and is forbidden).

That asymmetry is the single most important fact for automation strategy:

- **The highest-value, lowest-risk agent actions are those that read the rich pipeline and write to the internal task/snooze tables.** Almost all the data for these already exists.
- **The actions that require new APIs are exactly the ones that touch the outside world** — sending email, sending SMS, running a skip trace, delivering notifications. These are blocked not by data but by integration scope (and, per system rules, by the human-approval gate).

Of the 10 actions below, **7 have enough data today**, **3 require a new API**, and the two single best bets (auto-task generation and a weighted deal-priority score) are both low-effort and high-value because the rules engine and outreach data already compute everything they need.

---

## What the Agent Can Touch Today (Capability Inventory)

| Capability | Status in code | Read / Write |
|---|---|---|
| Deal pipeline (150 deals, stage, amount, staleness dates, county, parcel) | `db/deals.ts`, Layer 1 sync 4×/day | Read |
| Layer 2 detail (notes, emails, calls, tasks per deal) | `db/activities.ts`, on-demand only | Read |
| Call history + transcripts + classification | JustCall sync + `call_transcripts`, outreach matrix | Read |
| Outreach matrix incl. **dead-line / voicemail detection** | `db/outreach.ts` (`deriveDetailedOutcome`) | Read (already computed) |
| Contact quality + **recommended action per deal** | `db/contact-quality.ts` (`skip_trace`/`add_contacts`/`keep_calling`) | Read (already computed) |
| Gmail emails matched to deals | `integrations/google` — list/get only | Read |
| Google Drive docs + **AI doc verification** (deed/PropertyRadar/notice, owner-tracking) | `ai/doc-verify.ts` | Read |
| Per-deal AI summary (`mo_action_required`, blockers, next step) | `ai/generate.ts`, `ai/prompts.ts` | Read/generate |
| Morning briefing (streamed text) | `ai/briefing.ts` | Generate |
| Attention rules engine (staleness, agreement, signed, contacts, calls-exhausted, snooze) | `lib/rules/*` pure functions | Read/compute |
| **Internal tasks** | `db/tasks.ts` — `createTask`, `closeTask` | **Write** |
| **Snoozes** | `db/snoozes.ts` — `createSnooze`, `removeActiveSnooze` | **Write** |
| HubSpot write-back | Does not exist, forbidden | — |
| Email send (Gmail) | Not built — client is read-only | — |
| SMS / A2P texting (JustCall) | Not built — client only `getCallLogs` | — |
| Skip-trace lookup | Scaffold only, throws `not yet implemented`, no provider chosen | — |
| Notification delivery (email/push) | Not built | — |

**Hermes guardrails (from SYSTEM_OVERVIEW.md):** may research, draft, recommend, review, create internal tasks, update internal records. May **not** write HubSpot, send anything without Mo's approval, move money, or change case status.

---

## 1. The 10 Most Valuable Agent Actions to Automate Today

Ordered roughly by value. Each notes the concrete data/code it would build on.

**A1 — Auto-generate follow-up tasks from attention flags.**
When the rules engine flags a deal (Agreement Sent + no activity 2 days, Signed/In Progress stalled, contacts missing, calls exhausted), automatically create a linked `internal_task` with a specific next action. Builds on `evaluateAll()` + `createTask()`. This is the P1 "Auto-follow-up task creation" item and the highest-leverage write the agent can safely make.

**A2 — Weighted deal-priority scoring.**
Compute a priority score = f(amount, business-days stale, pipeline group, mo_action_required) so a $45K deal stuck 14 days outranks a $3K deal stuck 14 days. Pure computation over data already in `NormalizedDeal` + AI summaries. Feeds the attention queue ordering and the briefing.

**A3 — AI Case Manager: cross-source reconciliation.**
Compare HubSpot deal fields against deed/PropertyRadar extractions and produce a discrepancy table + "untracked parties" alert (e.g. a tax-lien debtor named in the deed who is not a HubSpot contact). `ai/doc-verify.ts` already extracts `consolidatedData` and runs `ownerTrackingCheck`; the missing piece is a comparison pass surfaced as a structured report + a task when a party is untracked.

**A4 — Dead-number detection → status update + skip-trace task.**
The outreach matrix already classifies calls as `dead_line`. Automate: when a number repeatedly classifies dead, set `phone_numbers.status = disconnected` and create a "needs new number" task. Pure read of existing classification + two internal writes.

**A5 — Skip-trace queue generation.**
`contact-quality.ts` already labels each deal `skip_trace` / `add_contacts` / `keep_calling`. Automate creation of a prioritized skip-trace worklist (tasks) for `phone_exhausted`, `no_phones`, and `thin` deals — weighted by surplus amount. (Generating the queue needs no new API; *executing* the trace does — see §3.)

**A6 — Stalled-case next-action recommendations.**
For every active, non-snoozed deal, batch-generate the AI summary's `suggested_next_step` and `blockers`, then attach the recommendation as a task or briefing line. Logic exists in `ai/generate.ts`; today it is manual, one deal at a time.

**A7 — Untracked heir / party detection from deeds.**
A focused slice of A3: run doc verification, read `ownerTrackingCheck`, and for any `tracked: false` debtor, create a research task ("Add Isaac S Monroe — named on deed, not in HubSpot"). High legal value (missing an heir can sink a claim); data already produced.

**A8 — Attorney-outreach email drafting.**
Generate county-aware attorney outreach drafts from deal context (county, parcel, surplus, stage, deed facts). `callClaude` + deal data make the *draft* trivial; the draft lands in a task/clipboard for Mo. (Sending is a separate, gated step — see §3.)

**A9 — Daily briefing auto-delivery.**
The briefing is fully built but only renders when Mo opens the dashboard. Automate a scheduled 8am generation and deliver it (or a "Mo Action Required" digest). Generation is done; *delivery* needs a notification/email channel (see §3).

**A10 — Inbound email/call triage.**
When a new attorney or client email (Gmail) or a live-classified call comes in, classify "who needs something from whom" and raise a task/flag. `who_needs_something` already exists in the AI summary schema and call transcripts are already classified `live`. Needs full Gmail sync running continuously (sample is done) and ideally a webhook for real-time.

---

## 2. Which Already Have Enough Data (Buildable Now, No New API)

These rely only on data already in the DB and the existing internal-write surface (`tasks`, `snoozes`, denorm columns):

| # | Action | Data source already present |
|---|---|---|
| A1 | Auto-generate follow-up tasks | Rules engine output + `createTask()` |
| A2 | Weighted deal-priority scoring | `NormalizedDeal.amount` + staleness dates + AI `mo_action_required` |
| A3 | Cross-source reconciliation (AI Case Manager) | `doc-verify` `consolidatedData` + deal fields + `ownerTrackingCheck` |
| A4 | Dead-number detection | Outreach matrix `dead_line` classification + `phone_numbers` table |
| A5 | Skip-trace **queue generation** | `contact-quality` action labels (queue only, not execution) |
| A6 | Stalled-case next-action recs | `ai/generate.ts` summary fields |
| A7 | Untracked heir/party detection | `ownerTrackingCheck` from doc verification |

**7 of 10 are data-complete today.** The only thing standing between these and production is orchestration logic + the human-approval pattern — not integration work.

Note one operational caveat: A3, A6, A7 depend on **Layer 2 / doc-verification data**, which is pulled on-demand, and **AI summaries**, which are never auto-generated (hard product rule). So "enough data exists" means *for any deal that has been hydrated*; a fleet-wide run requires first triggering those on-demand pulls (a deliberate cost/noise control, not a missing capability).

---

## 3. Which Require a New API

Three actions are blocked on outbound integrations that are not built. In every case the blocker is the *external write*, and each also sits behind the "no send without Mo's approval" rule:

| # | Action | New API / scope required | Current state |
|---|---|---|---|
| A5 | Skip-trace **execution** (not just the queue) | A skip-tracing provider (BeenVerified / TLO / IDI / DataTree): pick provider, add `SKIP_TRACING_API_KEY`, real rate limits, mapper | Scaffold throws `not yet implemented`; no provider chosen |
| A8 | **Sending** attorney emails | Gmail **send** scope (`gmail.send`) — current Google client is read-only | Not built |
| A9 | Briefing/notification **delivery** | Outbound email or push channel (Gmail send, or a transactional email/Resend/SES integration) | Not built |
| A10 | Real-time inbound triage | Full continuous Gmail sync + ideally JustCall/Gmail **webhook** (currently polling) | Sample sync only; no webhook |
| — | A2P texting (related, roadmap P2) | JustCall **SMS send** endpoint — client only implements `getCallLogs` | Not built |

Pattern worth noting: the codebase is explicitly architected for these additions — `skip-tracing/client.ts` is a ready scaffold, the integration boundary (one `request()` per service, per-service `TokenBucket`, service error class) is documented in CLAUDE.md. So "requires a new API" here means *wiring + credentials + a provider decision*, not architectural work.

---

## 4. Ranked by Business Value vs. Implementation Effort

Effort is relative (S = hours, M = a day or two, L = multi-day incl. new integration + approval UX). Value reflects revenue protection and Mo's time saved in a ~18–30 active-deal pipeline where individual surpluses can be five figures.

| Rank | Action | Business value | Effort | Data ready? | Why this rank |
|---|---|---|---|---|---|
| 1 | **A1 — Auto follow-up tasks** | High | **S** | ✅ | Rules + `createTask` already exist; directly stops deals slipping. Best value/effort ratio. |
| 2 | **A2 — Weighted priority score** | High | **S** | ✅ | Pure compute; makes the whole attention queue smarter. Touches every other feature. |
| 3 | **A4 — Dead-number detection** | High | **S–M** | ✅ | Classification already computed; prevents wasted calls + routes to skip-trace. |
| 4 | **A7 — Untracked heir detection** | High (legal risk) | **S–M** | ✅ | `ownerTrackingCheck` exists; missing an heir can void a claim. Cheap, high downside protection. |
| 5 | **A3 — AI Case Manager reconciliation** | High | **M** | ✅ | ~4h per roadmap est.; flagship "source of truth" feature. Slightly more than a comparison pass. |
| 6 | **A5 — Skip-trace queue (generation)** | High | **S** | ✅ | Queue is free today; pairs with #3. (Execution is a separate L item — see #9.) |
| 7 | **A6 — Stalled-case next-action recs** | Medium–High | **M** | ✅* | Logic exists; cost/noise of fleet-wide AI runs is the real constraint, not code. |
| 8 | **A9 — Briefing auto-delivery** | Medium | **M–L** | Partial | Generation done; value is real but needs a delivery channel (new API) + scheduling. |
| 9 | **A8 — Attorney email drafting** | Medium–High | **M** draft / **L** send | ✅ draft | Drafting is cheap and useful now; sending needs Gmail send scope + approval UX. |
| 10 | **A10 — Inbound email/call triage** | Medium–High | **L** | Partial | Most valuable long-term, but needs continuous sync + webhook + classification loop. |
| — | A5-exec / A2P texting | Medium | **L** | ❌ | Provider decision + outbound write + approval gate; do after the read-only wins land. |

\* "Data ready" with an asterisk = depends on on-demand Layer 2 / AI generation being triggered first.

### Recommended sequencing

1. **Quick wins this week (all S, all data-ready, internal writes only):** A1, A2, A4, A5-queue, A7. These are pure value with no new integration and no external-send risk. They turn the existing read intelligence into action.
2. **Flagship next (M):** A3 (AI Case Manager) and A6 (batch next-actions) — the differentiated "AI case operating system" capability.
3. **Outbound, gated, needs new APIs (M–L):** A8 send, A9 delivery, A10 triage, then skip-trace execution and A2P texting. Each must respect the "no send without Mo's approval" rule, so budget effort for an approval/confirmation step, not just the API.

---

## Appendix — Audit Method

Read: `SYSTEM_OVERVIEW.md`, `CURRENT_STATE.md`, `docs/DOMAIN_MODEL.md`, `CLAUDE.md`, `docs/product-roadmap.md`, `prisma/schema.prisma`. Inspected source: rules engine (`src/lib/rules/*`), `db/outreach.ts`, `db/contact-quality.ts`, `ai/prompts.ts`, `ai/briefing.ts`, `ai/doc-verify.ts`, `integrations/google/client.ts`, `integrations/justcall/client.ts`, `integrations/skip-tracing/client.ts`, `db/tasks.ts`, `db/snoozes.ts`, and the 31 API route handlers under `src/app/api`. No code was modified.
