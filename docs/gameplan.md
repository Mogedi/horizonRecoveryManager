# Horizon Intelligence Dashboard — Gameplan & Milestones

## Build Philosophy

Build in proof-of-concept layers. Do not one-shot the full app.

- Verify data shapes before writing code
- Sample before bulk: pull a small dataset, confirm it looks right, then pull everything
- Build the smallest working thing; refactor after it proves value
- Never build database schemas from assumptions
- Commit at every passing test gate

---

## North Star

The dashboard is successful when Mo can open it and within 60 seconds answer:

1. What needs my attention right now?
2. Which cases are stuck, and why?
3. How many call attempts has Kathleen made on each outreach deal?
4. What should I personally do today?
5. Which employee needs coaching?

**This is not a reporting dashboard. It is an owner-attention dashboard.**

**Read-only permanently.** HubSpot is the source of truth. The dashboard adds an intelligence layer on top. No HubSpot writes — ever. No `src/lib/hubspot/actions.ts` without Mo's explicit approval.

---

## Phase 1 Complete (M0–M8) ✅

All original milestones shipped. See `docs/archive/milestones-m0-m8.md` for full history.

**What's running in production:**
- Layer 1 sync (all 150 deals, 4×/day via Vercel cron)
- Attention queue: flagged deals grouped by issue type (Stage Stale, Agreement No Follow-Up, Signed No Activity, No Contacts, Mo Action Required, Calls Exhausted, Snoozed, Healthy)
- Deal detail panel: Layer 2 on-demand (contacts, notes, calls, emails, tasks)
- Per-deal AI summary (7 structured fields via Claude claude-sonnet-4-6)
- Internal task list (6 categories, Trello replacement)
- Daily Briefing modal (AI-generated, attention queue + tasks + employee activity)
- Settings page (configurable staleness thresholds, sync log)
- 342 tests passing

---

## Current State Snapshot (as of June 2026)

### Milestones Complete ✅
- **M9** — Multi-source DB foundation: `activity_events`, `phone_numbers`, `pipeline_states`, `sync_sources`, `PIPELINE_GROUP` constant
- **M10** — JustCall client, normalizer, sample sync, `/api/sync/justcall`
- **M11 (partial)** — Full JustCall pull complete (7,110 events, 2,543 phone numbers). Rules engine: `calls_exhausted` (7+ unique call days) and `setup_readiness` shipped. **Not yet done:** `call_due_today` rule, stage staleness refactor for outreach, call cadence settings.

### Shipped Beyond Original Gameplan
These were unplanned but shipped because the data unlocked them:

**Call Transcription Pipeline** (`src/lib/integrations/call-classifier/`)
- Whisper transcription + Claude classification → `call_transcripts` table
- 2,432 calls transcribed and classified (live/voicemail/disconnected/unknown)
- Backfill system with permanent error-row tombstones for 413s and missing recording URLs
- Per-contact call timeline with transcripts in DealPanel

**Analytics Layer** (unplanned M11+)
- `deal_enriched` PostgreSQL view: state, county, owner_name, tax_sale_year, case_age_months, amount_bucket, unique_call_days, call_intensity
- `src/lib/db/analytics.ts`: `getPortfolioAnalytics()`, `getDealEnrichedById()`
- `src/lib/db/pipeline-stats.ts`: `computePipelineStats()`, `getWeeklyCallStats()`
- `/dashboard/pipeline` — portfolio analytics page (geography, vintage, outreach coverage, amount distribution)
- `/dashboard/contacts` — contact quality page (contact tiers, owner matching, phone coverage, skip-trace surfacing)

### In Progress / Pending
- M11 remainder: call_due_today rule, outreach staleness refactor, cadence settings UI
- M12: Deal Workspace Redesign (DealPanel.tsx is 1,277 lines — needs breaking up)
- M13: Google Workspace (scaffold exists at `src/lib/integrations/google/client.ts`)
- `pipeline_states` table: created in M9, never populated — reassess whether needed

---

## Agent Protocol

Each milestone follows this pattern:

```
1. Read preconditions
2. If preconditions unmet → STOP, report exactly what Mo needs to provide
3. Work through checklist autonomously
4. After each sub-milestone: run tests → if PASS, git commit → if FAIL, STOP and report
5. When milestone complete → report what was built, wait for Mo before starting next
```

Commit format: `[M9a] description` | `[M10] description` etc.

Never commit if tests fail. Never commit `.env.local` or secrets. `docs/research/` in `.gitignore`.

**STOP AND WAIT when:**
- A required credential is missing
- About to make real API calls to a new service (JustCall, Google) — confirm sample scope first
- About to do a full historical data pull — Mo must approve the sample first
- Schema destructive change (column drop, table drop, enum removal)
- Tests fail and root cause is unclear after one fix attempt
- A new external API returns a response shape not in the docs

---

## Milestone 9: Three-Pipeline DB Foundation

> **AGENT PRECONDITIONS:** M8 complete. No new credentials needed — this is schema + DB work only.
> **COMMIT:** `[M9a] multi-source schema migration` → `[M9b] sync_sources seed + PIPELINE_GROUP constant`

**Goal:** Database tables and constants that support multi-source event tracking and pipeline-aware deal analysis. Rules engine unchanged in this milestone — existing attention queue keeps working.

### What this unlocks

Before M9, all activity data comes from HubSpot's Layer 2. M9 adds the infrastructure to receive calls from JustCall, emails from Google, and any future source — all normalized into one table. Phone numbers get a dedicated registry for cross-source matching.

### Stage-to-Pipeline Mapping

Code constant — not configurable. Architectural, not a setting.

| Stage | ID | Pipeline Group |
|---|---|---|
| More Research Need | 3501274836 | `terminal` (no rules fire) |
| F | 3639720641 | `terminal` (no rules fire) |
| New Case | 3477730034 | `setup` |
| Ready for Outreach | 3477730035 | `setup` |
| Attempted Contact | 3477730036 | `outreach` |
| Contact Made | 3477730037 | `outreach` |
| Follow-Up Needed | 3477730038 | `outreach` |
| Engaged / Interested | 3477730039 | `outreach` |
| Letter Outreach - Final Attempt | 3551234806 | `outreach` |
| Agreement Sent | 3477730040 | `case_mgmt` |
| Signed / In Progress | 3478695644 | `case_mgmt` |
| Closed – Paid | 3478695645 | `terminal` |
| Dead / Not Interested | 3478695646 | `terminal` |
| DNC | 3513772741 | `terminal` |
| Blocked, Missing Info | 3513772742 | `terminal` |
| Exhausted | 3741613778 | `terminal` |

### New Prisma Models

**`activity_events`** — Unified multi-source event log. Replaces `deal_activities` for new data sources. HubSpot's `deal_activities` table stays for legacy Layer 2 data; `activity_events` receives JustCall and Google data going forward.

**`phone_numbers`** — E.164 normalized phone registry. Populated from `deal_contacts.phoneNumbers` during Layer 2 sync. Used to match incoming JustCall calls to deals without a deal ID.

**`pipeline_states`** — One row per deal per pipeline group. Tracks operational status (not_started | active | completed | blocked). Future: auto-computed from event data. For now: seeded/updated manually or by sync.

**`sync_sources`** — Integration registry. One row per external data source. Tracks active/inactive, last synced, config. Gate: check `isActive` before syncing a source.

### Denormalized Cache Columns on `deals`

`callAttemptCount` and `lastCallAttemptAt` — computed from JustCall `activity_events`. Updated atomically when a JustCall sync inserts new call events for a deal. Avoid a JOIN on every attention queue load.

### Checklist

**9a — Schema Migration (TDD: write tests against new schema first):**
- [ ] Add `ActivitySource` enum: `HUBSPOT | JUSTCALL | GOOGLE | USER | AI`
- [ ] Add `ActivityEvent` model with `@@unique([source, externalId])` and `@@index([dealHubspotId, happenedAt])`
- [ ] Add `PhoneStatus` enum: `active | disconnected | invalid | unknown`
- [ ] Add `PhoneNumber` model with `@@index([numberE164])` and `@@index([dealHubspotId])`
- [ ] Add `PipelineGroup` enum: `setup | outreach | case_mgmt | terminal`
- [ ] Add `PipelineState` model with `@@unique([dealHubspotId, pipeline])`
- [ ] Add `SyncSource` model
- [ ] Add `callAttemptCount Int @default(0)` and `lastCallAttemptAt DateTime?` to `Deal`
- [ ] Add relations: `Deal` → `ActivityEvent[]`, `PhoneNumber[]`, `PipelineState[]`
- [ ] `npm run db:migrate` → migration name: `add-multi-source-foundation`
- [ ] `npm run db:generate`

**9b — Constants + Seed:**
- [ ] Add `PIPELINE_GROUP: Record<string, 'setup' | 'outreach' | 'case_mgmt' | 'terminal'>` to `src/lib/db/settings.ts` (keyed by stage ID)
- [ ] Add `src/lib/db/activity-events.ts` — `getActivityEvents(dealHubspotId)`, `upsertActivityEvent(event)`
- [ ] Add `src/lib/db/phone-numbers.ts` — `lookupDealByPhone(e164)`, `upsertPhoneNumber(number, dealHubspotId)`
- [ ] Seed `sync_sources`: HUBSPOT (active=true), JUSTCALL (active=false), GOOGLE (active=false)
- [ ] `npm test` — existing 175 tests still pass + new DB function tests
- [ ] Git commit: `[M9] multi-source DB foundation`

**Done when:** Migration runs cleanly, new tables exist in DB, sync_sources seeded, 175+ tests passing, attention queue still works exactly as before.

---

## Milestone 10: JustCall Integration — Sample Mode

> **AGENT PRECONDITIONS:**
> - M9 complete
> - `JUSTCALL_API_KEY` set in `.env.local` (Mo provides)
> - **STOP AND CONFIRM before any JustCall API call:** Tell Mo the scope (last 24h, max 20 records) and wait for explicit go-ahead
>
> **COMMIT:** `[M10a] justcall client + normalizer` → `[M10b] sample sync + verification`

**Goal:** Pull a tiny sample of JustCall call records. Verify the data looks right (phone numbers normalize correctly, calls match to deals). Mo approves before anything larger is pulled.

**Rate limits (verified from account):**
- Burst: 60 req/min → 30% cap = **18 req/min**
- Hourly: 3600 req/hr → 30% cap = **1,080 req/hr**
- Webhooks: not rate-limited

**JustCall API base:** `https://api.justcall.io/v2.1`

**Auth:** `Authorization: <api_key>:<api_secret>` header

### PhoneProvider Interface

All phone integrations implement this. JustCall is the first. RingCentral, GoHighLevel, or any future provider implements the same interface and plugs in without changes downstream.

```typescript
// src/lib/integrations/phone-provider.ts
export interface NormalizedCallLog {
  externalId: string          // JustCall call ID (string)
  happenedAt: Date
  durationSecs: number | null
  direction: 'inbound' | 'outbound'
  outcome: 'answered' | 'voicemail' | 'no_answer' | 'busy'
  fromNumberE164: string
  toNumberE164: string
  agentId: string | null      // JustCall agent ID
  rawPayload: unknown
}

export interface PhoneProvider {
  getCallLogs(since: Date, until: Date): Promise<NormalizedCallLog[]>
}
```

### Sample Mode Definition

Sample = last 24 hours of calls, max 20 records total. Exits early if 20 records hit. Shows Mo:
- How many calls matched to known deal phone numbers
- How many had no match (unmatched = phone not in phone_numbers table)
- The raw normalized records (redacted for display)

### Checklist

**10a — JustCall Client + Normalizer (TDD):**
- [ ] `src/lib/integrations/phone-provider.ts` — `PhoneProvider` interface + `NormalizedCallLog` type
- [ ] `src/lib/integrations/justcall/types.ts` — JustCall API response shapes (typed from actual API docs)
- [ ] `src/lib/integrations/justcall/normalize.ts` — E.164 normalizer (`+14045551234`, `(404) 555-1234`, `14045551234` all → `+14045551234`); handle US numbers only for now (10-digit min)
- [ ] `src/lib/integrations/justcall/client.ts` — implements `PhoneProvider`; `TokenBucket(18, 'per_minute')` rate cap; all calls flow through `request()` method; `JustCallError extends IntegrationError`
- [ ] `normalize.test.ts` — 8+ tests: E.164 normalization for common formats, rejects obviously invalid strings
- [ ] `client.test.ts` — mock HTTP, test rate cap enforced, test `JustCallError` on 4xx
- [ ] Tests pass: `npm test`

**10b — Sample Sync:**
- [ ] `src/lib/integrations/justcall/sync.ts` — `syncJustCallSample()`: fetches last 24h, max 20 records, writes to `activity_events`, returns match report
- [ ] `POST /api/sync/justcall` — cookie-authed; body: `{ mode: 'sample' }` only for now
- [ ] Add JustCall sync status to settings page (last synced, records pulled, match rate)
- [ ] **STOP:** Run sample sync → inspect `activity_events` table → show Mo match report → wait for approval
- [ ] Git commit: `[M10] justcall sample sync`

**Done when:** Sample sync runs, data appears in `activity_events`, Mo has reviewed and said "looks right, pull everything."

---

## Milestone 11: JustCall Full Pull + Phone Matching + Rules Refactor

> **AGENT PRECONDITIONS:**
> - M10 complete
> - Mo has explicitly approved the sample data and said to pull everything
> - Layer 2 has been run on at least 50 deals (phone_numbers need population source)

**Goal:** Full JustCall history matched to deals. Call cadence rules replace time-based staleness rules for outreach stages.

### Phone Matching Strategy

JustCall call logs have `from_number` (agent) and `to_number` (contact). We match `to_number` (E.164) against `phone_numbers.numberE164` to find the deal.

Population source: `deal_contacts.phoneNumbers` (already pulled via Layer 2). Each phone in that array gets normalized to E.164 and inserted into `phone_numbers` with `dealHubspotId`.

Unmatched calls: logged in `activity_events` with `dealHubspotId = null`. These become the "unmatched" coverage gap that Mo can investigate.

### Rules Refactor

After full JustCall data is loaded and match rate is acceptable (>80% of calls matched):

**Remove from outreach stages:**
- `stage_stale_ready_for_outreach` (5 days)
- `stage_stale_attempted_contact` (7 days)
- `stage_stale_contact_made` (5 days)
- `stage_stale_follow_up_needed` (5 days)
- `stage_stale_engaged_interested` (3 days)

**Keep for outreach:**
- `stage_stale_letter_outreach` (14 days) — time IS the right signal for Letter Outreach

**Add:**
- `call_due_today` — deal in outreach stage, next call is due today or overdue
- `calls_exhausted` — 7+ call attempts with no answer
- `setup_incomplete` — deal in setup stage with 0 contacts or no valid phone

**Call Cadence Logic:**
- No calls yet (count = 0): next call due = stage entered date
- Attempts 1–7: next call = lastCallAttemptAt + 2 business days
- Attempts 7+: next call = lastCallAttemptAt + 7 business days (weekly resurface)

### Checklist

**11a — Phone Population:**
- [ ] `src/lib/db/phone-numbers.ts` — `populateFromDealContacts()`: iterate all `deal_contacts`, normalize each phone number, upsert into `phone_numbers` with `dealHubspotId`
- [ ] Run population against existing Layer 2 data
- [ ] Verify coverage: how many deals have at least one phone number in the registry?

**11b — Full JustCall Pull:**
- [ ] `src/lib/integrations/justcall/sync.ts` — add `syncJustCallFull(since: Date)`: paginated pull, all records since date, rate cap enforced
- [ ] Match each call to a deal via `phone_numbers` table
- [ ] Upsert into `activity_events` (skip duplicates via `@@unique([source, externalId])`)
- [ ] Update `deal.callAttemptCount` + `deal.lastCallAttemptAt` atomically per deal
- [ ] Pull last 90 days of JustCall history
- [ ] Report: total calls pulled, matched count, unmatched count, match rate

**11c — Rules Engine Refactor:**
- [ ] `src/lib/rules/types.ts` — add `'call_due_today' | 'calls_exhausted' | 'setup_incomplete'`; conditionally remove `'stage_stale'` (keep for `letter_outreach` stage only)
- [ ] `src/lib/rules/call-cadence.ts` — `checkCallCadence(deal, ctx)` — fires `call_due_today` for outreach deals; uses `deal.callAttemptCount`, `deal.lastCallAttemptAt`, `ctx.pipelineGroups`
- [ ] `src/lib/rules/calls-exhausted.ts` — `checkCallsExhausted(deal, ctx)` — fires after 7+ attempts
- [ ] `src/lib/rules/setup-readiness.ts` — `checkSetupReadiness(deal, ctx)` — fires for setup-stage deals with no phone
- [ ] `src/lib/rules/staleness.ts` — narrow to only fire for `letter_outreach` + case_mgmt stages; remove outreach stage IDs
- [ ] `src/lib/rules/ctx.ts` — add `pipelineGroups`, `callCadenceMaxAttempts`, `callCadenceInitialSpacingDays`, `callCadenceResurfaceDays` to `RuleContext`; load cadence settings from `app_settings`
- [ ] `src/lib/rules/index.ts` — new rule order: snooze → setupReadiness → callCadence → callsExhausted → agreement → signed → contacts → staleness (letter only)
- [ ] TDD: write rule tests before implementation; confirm red → green

**11d — Settings + UI:**
- [ ] Delete `app_settings` keys: `stage_stale_ready_for_outreach`, `stage_stale_attempted_contact`, `stage_stale_contact_made`, `stage_stale_follow_up_needed`, `stage_stale_engaged_interested`
- [ ] Seed new cadence settings: `call_cadence_max_attempts = 7`, `call_cadence_initial_spacing_days = 2`, `call_cadence_resurface_days = 7`
- [ ] Settings page: replace removed stale inputs with "Call Cadence" group
- [ ] Attention queue: remove `stage_stale` from `FLAG_CONFIG`/`DISPLAY_ORDER`; add `call_due_today`, `calls_exhausted`, `setup_incomplete`
- [ ] New display order: mo_action_required → agreement_no_followup → calls_exhausted → call_due_today → setup_incomplete → signed_no_activity → no_contacts → snoozed
- [ ] `npm test` — all tests pass
- [ ] Git commit: `[M11] justcall full pull + call cadence rules`

**Done when:** Attention queue shows call cadence signals (not time-based) for outreach stages. Full JustCall history matched. Settings page shows cadence controls.

---

## Milestone 12: Deal Workspace Redesign (Case Intelligence Foundation)

> **AGENT PRECONDITIONS:** M9+ complete. Architecture approved by Mo — see `/Users/mogedi/.claude/plans/parallel-nibbling-hartmanis.md`.
>
> **Architecture:** Three-layer model. Layer 1 (raw DB) → Layer 2 (business view models in `src/lib/case/`) → Layer 3 (UI + AI agents). Business objects are view models, not persistence models.

**Goal:** Convert DealPanel from a single-scroll data dump into a tabbed case workstation. Primary innovation: business object layer (`CaseEvent`, `StoryDay`, `CurrentState`) that gives humans and AI agents the same structured view of a case.

### Tab Order
Story | Tasks | Contacts | Calls | Emails | Documents | Notes

### M12a — Case Object Layer + Story Tab ✅ DONE
**Commit:** `[M12a] case object layer + story tab — CaseEvent, StoryDay, CurrentState, tabbed DealPanel`

- [x] `src/lib/case/types.ts` — CaseEvent, StoryDay, CurrentState, CaseEventCategory types
- [x] `src/lib/case/classifier.ts` — `categorizeEvent()` — 7 categories, priority-ordered rules
- [x] `src/lib/case/events.ts` — `buildCaseEvents()` — merges DealActivity + ActivityEvent
- [x] `src/lib/case/story.ts` — `buildStoryDays()` — groups by ET calendar day, deduped labels
- [x] `src/lib/case/state.ts` — `buildCurrentState()` — health inference from status keywords
- [x] `GET /api/deals/[id]/story` — returns `{ days: StoryDay[], currentState: CurrentState }`
- [x] `src/components/deal-panel/StoryTab.tsx` — accordion: date | categories | latest event, expand for events
- [x] `src/components/DealPanel.tsx` — shrink-0 controls (snooze + Layer2 + AI summary) + tab strip + flex-1 tab content
- [x] TDD: 52 tests for case layer + 7 for story route = 59 tests. Full suite: 583 passing.

### M12b — Contacts + Calls Tabs (pipeline-aware defaults)
- [ ] `src/components/deal-panel/ContactsTab.tsx` — lift existing ContactItem list
- [ ] `src/components/deal-panel/CallsTab.tsx` — lift existing OutreachSection
- [ ] Default tab by pipeline group: setup→contacts, outreach→calls, case_mgmt→story, terminal→story
- [ ] `defaultTab.test.ts` — all four pipeline groups map correctly
- [ ] `npm test` → git commit `[M12b] contacts + calls tabs — pipeline-aware defaults`

### M12c — Emails + Notes + Documents Tabs
- [ ] `src/components/deal-panel/NotesTab.tsx` — activity list with date/author/body
- [ ] `src/components/deal-panel/EmailsTab.tsx` — grouped by counterparty (check `/api/deals/[id]/google` metadata shape first)
- [ ] `src/components/deal-panel/DocumentsTab.tsx` — lift existing Drive section verbatim
- [ ] Wire three new tabs in DealPanel; remove Gmail + Drive from main body
- [ ] `email-grouping.test.ts` — counterparty extraction
- [ ] `npm test` → git commit `[M12c] emails + notes + documents tabs`

### M12d — CurrentState Typing + Layer 2 Gate + Polish
- [ ] Replace all `as SummaryJson` casts with `buildCurrentState()` call
- [ ] `<LayerTwoGate>` component: shown per-tab when `!layer2SyncedAt`
- [ ] Tab count indicators: `Calls (12)`, `Notes (8)`, `Emails (3)` when data present
- [ ] CaseSnapshot: collapsed by default when `currentState.status === null`
- [ ] `npm test` → git commit `[M12d] CurrentState typing + layer 2 gate per tab + polish`

**Done when:** All 7 tabs work, tab content scrolls independently, CaseSnapshot shows current state above tabs.

---

## Milestone 13: Google Workspace Integration

> **AGENT PRECONDITIONS:** M12 complete. Mo provides Google OAuth credentials and API keys.

**Goal:** Pull emails and calendar events from Google. Populate `activity_events` with email events. Match emails to deals via contact email addresses.

**When Mo is ready:** Provide `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`, `GOOGLE_REFRESH_TOKEN` in `.env.local`. The scaffold at `src/lib/integrations/google/client.ts` already exists.

**Rate limits (Gmail API — verify before implementation):**
- Quota: 250 req/s per user (read-only)
- 30% cap = **75 req/s**

### Email Matching Strategy

Gmail API returns email threads. For each email:
1. Extract `from` and `to` email addresses
2. Look up in `deal_contacts.emailList` via a join on normalized address
3. If match found → log to `activity_events` with `dealHubspotId`
4. If no match → skip (don't store emails not related to deals)

### Checklist

- [ ] Google OAuth setup (read-only: `gmail.readonly`, `calendar.readonly`)
- [ ] `src/lib/integrations/google/client.ts` — `GoogleClient` implementing email + calendar pulls; 30% rate cap; `GoogleError extends IntegrationError`
- [ ] `src/lib/integrations/google/sync.ts` — `syncGoogleEmails()`: pull last N days of Gmail, match to contacts, populate activity_events
- [ ] Contact email index: add `@@index([contactHubspotId])` to DealContact if missing
- [ ] Populate `activity_events` with `source = GOOGLE` email events
- [ ] Add Google sync to settings page status
- [ ] Sample first (last 7 days, max 50 emails) → Mo approves → full pull
- [ ] `npm test`
- [ ] Git commit: `[M13] google workspace integration`

**Done when:** Emails from/to deal contacts appear in the unified timeline alongside HubSpot notes and JustCall calls.

---

## Dependencies

```
M0–M8 (Complete) ✅
  └── M9: DB Foundation (schema, PIPELINE_GROUP, sync_sources)
        └── M10: JustCall Sample (client, normalizer, sample pull → Mo approves)
              └── M11: JustCall Full Pull + Rules Refactor
                    └── M12: Deal Workspace Redesign
                          └── M13: Google Workspace Integration
```

**Parallel tracks:**
- M12 (workspace design work) can start while M11 is in QA
- M13 can be scaffolded at any time; only needs API keys to activate

---

## What This Does NOT Include

- HubSpot writes of any kind (permanent policy — `src/lib/hubspot/actions.ts` must not exist)
- Auto-generated AI summaries (manual only, forever)
- Auto-generated JustCall/Google syncs (manual trigger or scheduled, not triggered by AI)
- Employee portal / Marwa or Kathleen having dashboard access (P3)
- Multi-pipeline support beyond "Cases – Surplus Funds" (P3)
