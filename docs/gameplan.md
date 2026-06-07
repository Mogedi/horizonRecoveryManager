# Horizon Intelligence Dashboard — Gameplan & Milestones

## Build Philosophy

Build in proof-of-concept layers. Do not one-shot the full app.

1. Research HubSpot APIs and save raw output
2. Create Private App, pull schema and one sample deal
3. Mo reviews the output and decides what fields matter
4. Design the database schema based on real data
5. Build Layer 1 sync + attention queue
6. Add Layer 2 only after Layer 1 works
7. Add AI only after Layer 2 works

Never write application code before real HubSpot data has been reviewed. Never build a database schema from assumptions.

Use TDD where practical. Commit frequently.

---

## North Star

The dashboard is successful when Mo can open it and within 60 seconds answer:
1. What needs my attention right now?
2. Which cases are stuck?
3. What should I personally do today?
4. Which employee needs coaching?
5. What is likely to close next?

**This is not a reporting dashboard. It is an owner-attention dashboard.**

**Design philosophy:** Build the smallest useful thing. HubSpot is the source of truth. This dashboard adds an attention intelligence layer on top. A future hub linking multiple Horizon tools is a P3 consideration — do not architect for it now. Keep the code clean and modular, but solve actual problems first.

---

## Demoable Product (Milestone 3 Target)

The minimum weekend build that proves the dashboard is materially better than using HubSpot alone.

**Pages:** `/login`, `/dashboard`, deal detail slide-in panel

**Database tables (5 — not 11):**
- `deals` — Layer 1 cache
- `deal_activities` — Layer 2 activity cache
- `deal_contacts` — Layer 2 contact cache
- `deal_snoozes` — snooze state
- `sync_log` — last-synced timestamp + call count

*Defer to post-M3:* `ai_summaries`, `internal_tasks`, `document_checklist`, `product_roadmap`, `app_settings` (hardcode thresholds instead)

**Sync jobs (2):**
- Layer 1: all deals, scheduled 4x/day + manual trigger
- Layer 2: one deal on demand, triggered by opening detail panel

**API routes (8):**
- `POST /api/auth/login`
- `POST /api/auth/logout`
- `POST /api/sync/layer1`
- `POST /api/sync/layer2/[id]`
- `GET /api/deals` — list with attention flags applied
- `GET /api/deals/[id]` — single deal + cached Layer 2
- `POST /api/deals/[id]/snooze`
- `DELETE /api/deals/[id]/snooze`
- `POST /api/deals/[id]/summary` — AI summary (uses Layer 2 cache)

**User actions (7):**
1. Log in with shared password → land on `/dashboard`
2. See attention queue: all flagged deals grouped by issue, color-coded
3. Click "Refresh" → triggers Layer 1 sync, updates "Last synced" timestamp
4. Click any deal → slide-in panel with contacts + activity timeline
5. Click "Load full detail" → pulls Layer 2 (activities + contacts) for that deal
6. Click "Generate AI Summary" → Claude summarizes the deal in bullet form
7. Click "Snooze" → pick category + date → deal disappears from queue until wake date

**Success criteria:**
- Mo sees all flagged deals grouped by reason in 5 seconds — no filtering or searching required
- Clicking one deal surfaces full context (contacts, timeline) without opening HubSpot tabs
- Snoozed cases don't pollute the queue
- "Last synced 11 minutes ago" is always visible
- AI summary answers "what's blocking this case" in 10 seconds

Everything after this is enhancement, not MVP.

---

## Agent Protocol

Each milestone follows this pattern:

```
1. Read preconditions
2. If preconditions unmet → STOP, report what Mo needs to provide
3. Work through checklist autonomously
4. After each sub-milestone: run tests → if PASS, git commit → if FAIL, STOP and report
5. When milestone complete → report what was built, wait for Mo before starting next
```

Commit format: `[M0] description` | `[M1] description` | `[M2a] description` etc.

Never commit if tests fail. Never commit `.env.local`. Add `docs/research/` to `.gitignore`.

---

## Milestone 0: HubSpot Private App Setup

> **AGENT PRECONDITIONS:** Mo must complete this milestone manually. There is no code to write. Stop immediately if HubSpot token is not provided. Do not proceed to M1 without a working token.

**Goal:** HubSpot access token in hand, ready to run API research scripts. No application code yet.

**This milestone is setup, not building.**

**Prerequisites needed from Mo:**
- [ ] HubSpot Personal Access Key (or Private App token — either works)
- [ ] Anthropic API key (get from console.anthropic.com — for later)

**Checklist:**
- [ ] Generate a HubSpot Personal Access Key: HubSpot → Settings → Integrations → Private Apps (if redirected, use Personal Access Key instead — both work as Bearer tokens)
- [ ] Ensure "CRM Objects" scope is checked (covers deals, contacts, notes, calls, emails, tasks)
- [ ] Copy the access token
- [ ] Create `docs/research/` directory for raw API output files
- [ ] Create `.env.local` with `HUBSPOT_ACCESS_TOKEN=your_token_here`
- [ ] Confirm token works: `curl -H "Authorization: Bearer $HUBSPOT_ACCESS_TOKEN" https://api.hubapi.com/crm/v3/owners`

**Done when:** HubSpot API responds successfully to a test request (returns owner list with Marwa, Kathleen, etc.).

---

## Milestone 1: HubSpot API Research

> **AGENT PRECONDITIONS:** `HUBSPOT_ACCESS_TOKEN` must be set in `.env.local` and verified working (curl test returns 200). Stop if token missing or invalid.
> **AGENT:** Run all API scripts autonomously. Save raw output. Do NOT interpret or design from the data — stop after saving and report to Mo for review. Mo must fill in `field-mapping.md` before the agent continues to M2.
> **COMMIT:** `[M1] raw API output — {list of files saved}`

**Goal:** Know exactly what data we can pull before writing any sync code. Output is raw JSON files + documented field mappings. Database schema is designed after this milestone, not before.

**This milestone is research, not building.**

**Output file locations:**
```
docs/research/
  deal-properties.json       -- GET /crm/v3/properties/deals
  contact-properties.json    -- GET /crm/v3/properties/contacts
  pipeline-stages.json       -- GET /crm/v3/pipelines/deals
  owners.json                -- GET /crm/v3/owners
  sample-deal.json           -- one deal from Layer 1 search
  sample-deal-contacts.json  -- contacts linked to sample deal
  sample-deal-notes.json     -- notes for sample deal
  sample-deal-calls.json     -- calls for sample deal
  sample-deal-emails.json    -- emails for sample deal
  sample-deal-tasks.json     -- tasks for sample deal
  field-mapping.md           -- Mo-confirmed field name decisions
```

**API call count log:** Record calls made per test. Total should stay under 50 for the full M1 research run.

**Checklist — Step 1: Schema Discovery**
- [x] Run `GET /crm/v3/properties/deals` → saved to `docs/research/deal-properties.json` (183 properties)
- [x] Run `GET /crm/v3/properties/contacts` → saved to `docs/research/contact-properties.json` (453 properties)
- [x] Run `GET /crm/v3/pipelines/deals` → saved to `docs/research/pipeline-stages.json` — pipeline is **"Cases – Surplus Funds"** (not "KSR Plus Funds"), 16 stages
- [x] Run `GET /crm/v3/owners` → saved to `docs/research/owners.json` — 3 owners confirmed: Mo, Kathleen, Marwa

**Checklist — Step 2: Sample Deal Pull**
- [x] Sample deal: CHATHAM - 701 W 48th St - Idella Grant ($36K), ID: 322527156927
- [x] Layer 1 search for sample deal → saved to `docs/research/sample-deal.json`
- [x] Contacts (3) pulled with all phone fields → saved to `docs/research/sample-deal-contacts.json`
- [x] First 5 notes → saved to `docs/research/sample-deal-notes.json` (HTML-formatted)
- [x] Calls → saved to `docs/research/sample-deal-calls.json` (0 calls — endpoint works but deal has none)
- [x] First 1 email → saved to `docs/research/sample-deal-emails.json` (sales-email-read scope confirmed working)
- [x] First 5 tasks → saved to `docs/research/sample-deal-tasks.json` (all "Follow Up Call" type)

**Checklist — Step 3: Mo Reviews Output**
- [ ] **Mo reviews `sample-deal.json`** — all field names are confirmed correct in `field-mapping.md`, but Mo should visually verify the data looks right
- [ ] **Mo reviews `sample-deal-contacts.json`** — confirm contact types, phone data looks right (note: one phone field has a date "02/06/2024" as value — known data quality issue)
- [ ] **Mo: What does stage "F" (ID: 3639720641) mean?** — not in any known stage definition
- [ ] **Mo: confirm `estimated_surplus` vs `amount`** — are these the same? Which should be displayed?
- [ ] **Mo: confirm email direction** — does "EMAIL" vs "INCOMING_EMAIL" distinction matter for Mo Action Required rule?
- [x] Field names documented in `docs/research/field-mapping.md`

**Checklist — Step 4: Decisions — RESOLVED**
- [x] Google Drive files via API → **NOT accessible** (UI-sidebar integration only)
- [x] Email direction → `hs_email_direction` exists but observed value is "EMAIL" — **open question on all possible values**
- [x] `last_activity_date` → `notes_last_updated` confirmed; use `hs_v2_date_entered_current_stage` for staleness
- [x] `num_associated_contacts` → **confirmed available in Layer 1 CRM Search**
- [x] Phone field variants → **11 variants confirmed** — see `field-mapping.md`
- [ ] Update `docs/hubspot-api-research.md` with M1 summary report

**Done when:** Raw JSON files exist in `docs/research/`. Mo has reviewed them and confirmed field mappings. `field-mapping.md` documents which HubSpot property names map to our internal Deal/Contact/Activity fields. Database schema can now be designed.

## Milestone 2: Project Skeleton + Database + Sync Engine

> **AGENT PRECONDITIONS:**
> - `docs/research/field-mapping.md` must exist and be filled in ✅ (done in M1)
> - `pipeline-stages.json` must exist ✅ (done in M1)
> - `owners.json` must exist ✅ (done in M1)
> - Mo must provide `DATABASE_URL` and `DIRECT_URL` from Neon ⬜ (Mo action required before M2b)
> - GitHub repo must exist and Vercel project connected ⬜ (Mo action required before M2a deploy step)
>
> **M1 RESOLVED:**
> - `amount` is the primary display field — confirmed populated 100% of deals. `estimated_surplus` is null on all 150 deals. Store both, display `amount`. ✅ resolved (M1-EXT)
> - Email `hs_email_direction` values — do not implement directional logic until confirmed.
> - Task counts in Layer 1 — not available; `task_count`/`open_task_count` columns dropped.

**Goal:** Working Next.js app skeleton, schema finalized from M1 findings, reliable data pipeline.

**2a — Project Skeleton** ✅ COMPLETE
- [x] Next.js 16+ app with TypeScript + Tailwind (App Router)
- [x] Prisma + @prisma/adapter-pg; Vitest test framework
- [x] `.env.local`, `.env.example`, `.gitignore` (research/ + .env.local)
- [x] `src/lib/db/client.ts` — Prisma singleton (globalThis pattern)
- [x] `src/proxy.ts` — auth cookie check (Next.js 16: renamed from middleware.ts; exports `proxy`)
- [x] `/login/page.tsx` → sets HTTP-only cookie → redirects to `/dashboard`
- [x] `/dashboard/layout.tsx` — sidebar layout

**2b — Database Schema** ✅ COMPLETE
- [x] Neon database + env vars set
- [x] Prisma schema: `deals`, `deal_activities`, `deal_contacts`, `deal_snoozes`, `sync_log`, `app_settings` (+ `ai_summaries`, `internal_tasks` added in M5)
- [x] Field names confirmed from M1 research (field-mapping.md)
- [x] `app_settings` seeded with `stage_map` + `owner_map`
- [x] `thresholds.ts` — hardcoded staleness thresholds (replaced by app_settings in M7)

**2c — Sync Engine** ✅ COMPLETE (commit 7697a66)
- [x] `/src/lib/utils/rate-limiter.ts` — TokenBucket, 3 req/s, injectable jitter for tests
- [x] `/src/lib/hubspot/client.ts` — rate-limited fetch, 429 backoff, HubSpotError
- [x] `/src/lib/hubspot/mapper.ts` — mapDeal/mapContact/mapActivity, only file with HubSpot property names
- [x] `/src/lib/db/settings.ts` — loadStageMap/loadOwnerMap from app_settings
- [x] `/src/lib/db/sync-log.ts` — daily call tracking, getDailyCallCount, assertDailyLimitOk
- [x] `/src/lib/sync/layer1.ts` — smart sync + full refresh, upserts deals
- [x] `/src/lib/sync/layer2.ts` — per-deal, delete+reinsert in transaction
- [x] `/api/sync/layer1/route.ts` + `/api/sync/layer2/[id]/route.ts`
- [x] `vercel.json` — cron 4x/day weekdays EDT
- [x] 28 tests passing, 0 TypeScript errors

**Done when:** Real HubSpot data is in the database, syncing on schedule, last-synced timestamp visible in production.

---

## Milestone 3: Attention Queue UI ✅ COMPLETE

> **AGENT PRECONDITIONS:** M2 complete, real deals in `deals` table, sync log shows successful Layer 1 sync.
> **COMMIT:** `[M3] business-days utility + tests` → `[M3] attention rules + tests` → `[M3] attention queue UI`

**Goal:** The full attention queue renders with real data. First demoable milestone.

**Checklist — Pre-M3 fixes (done in [M2c-fix] commit):**
- [x] Fix N+1 upsert in layer1.ts — `$transaction([...array])` bulk upsert (Prisma 7 pipelining)
- [x] Fix `asJson` — `JSON.parse(JSON.stringify(v))` before cast, in shared `utils/json.ts`
- [x] Remove `_stageMap` from `mapDeal` signature + call sites + mapper tests
- [x] Remove `estimateLayer2Calls()` — replaced with honest static range message in Layer 2 GET route

**Checklist — Rules Engine (TDD):**
- [x] `/src/lib/db/deals.ts` — `getDealsForQueue()`: loads deals, Decimal→number, preloads snooze Set
- [x] `/src/lib/utils/business-days.ts` — 10 tests, `America/New_York` via `Intl.DateTimeFormat`
- [x] `/src/lib/rules/staleness.ts` — `stageEnteredAt`, skips terminals, `ctx.staleThresholds`
- [x] `/src/lib/rules/agreement.ts` — Agreement Sent + `lastActivityDate` > 2 business days
- [x] `/src/lib/rules/signed.ts` — Signed/In Progress + `lastActivityDate` > 5 business days
- [x] `/src/lib/rules/contacts.ts` — Layer 1 version: `contactCount === 0`
- [x] `/src/lib/rules/snooze.ts` — preloaded Set lookup, suppresses all other flags
- [x] `/src/lib/rules/index.ts` — `applyRules` + `evaluateAll`
- [x] 59 tests passing, 0 TypeScript errors

**Checklist — API + UI:**
- [x] `/api/deals/route.ts` — parallel fetch, groups by flag type, returns stageMap
- [x] Dashboard: collapsible attention groups (flagged first, Snoozed/Healthy collapsed at bottom)
- [x] Deal card: name, stage name (resolved from stageMap), last activity relative date, flag reason
- [x] Synced timestamp always visible; "No sync data" shown when DB empty
- [x] Refresh button (re-fetches `/api/deals`) + Sync Now button (POST `/api/sync/layer1`) + Force Refresh
- [x] Layer 1 sync route: fixed cron auth header (`Authorization: Bearer <CRON_SECRET>`), added cookie auth for browser

**Layer 2-dependent rules (Mo Action Required, phone check) are added in M4 after Layer 2 works.**

**Done when:** Dashboard opens and shows real deals in the right attention groups. Mo can look at it and say "yes, that's what needs attention."

**Pending acceptance test (requires real data in DB):** Mo triggers Sync Now → deals appear → flagged deals grouped by reason. Snoozed deals in collapsed group. Last synced visible.

---

## Milestone 4: Deal Detail Panel ✅ COMPLETE

> **AGENT PRECONDITIONS:** M3 complete, attention queue rendering correctly with real data.
> **AGENT:** Panel opens immediately with Layer 1 data. Layer 2 pull is behind "Load Full Detail" button with static call count range. Test snooze creates correct DB row and removes deal from queue in next render.
> **COMMIT:** `[M4] deal panel — Layer 1 display` → `[M4] Layer 2 pull — on demand` → `[M4] snooze — save + remove from queue`

**Goal:** Click a deal, see everything relevant, snooze it.

**Checklist:**
- [x] Slide-in panel component (fixed overlay from right, backdrop closes on click)
- [x] Panel header: deal name, stage name, owner, amount, county, parcel ID, tax sale date
- [x] "Open in HubSpot" link (from `deals.hubspot_url`)
- [x] Panel opens with Layer 1 data immediately — fetches `/api/deals/[id]`
- [x] "Load Full Detail" button → shows static call range → confirmation → POSTs to `/api/sync/layer2/[id]`
- [x] Activity timeline (calls, notes, emails, tasks) sorted newest first
- [x] Linked contacts: name, relationship, deceased flag, phone numbers, DNC status
- [x] Snooze button → modal: 7 category options, date picker, optional note
- [x] Snooze saved to `deal_snoozes` table — panel closes, queue re-fetches
- [x] "Remove snooze" button for active snooze
- [x] Snooze history collapsible at bottom of panel
- [x] `contacts.ts` upgraded: checks `hasValidPhone` from deal_contacts, falls back to contactCount; no longer fires on terminal stages; 3 new tests added
- [x] Cookie auth added to Layer 2 sync route (browser doesn't need x-dashboard-token)
- [x] `GET /api/deals/[id]` — Layer 1 + cached Layer 2 + snooze data
- [x] `POST /api/deals/[id]/snooze` + `DELETE /api/deals/[id]/snooze`
- [x] 62 tests passing, 0 TypeScript errors

**Done when:** Mo can open any deal, see all relevant context, and snooze it with a reason and date.

---

## Milestone 5: AI Summary

> **AGENT PRECONDITIONS:** M4 complete. `ANTHROPIC_API_KEY` set in `.env.local`. Layer 2 working for at least one real deal (activities + contacts in DB).
> **AGENT:** Schema migration first. Build `prompts.ts` next — print the constructed prompt and inspect it manually before wiring the Claude API. Use JSON structured output (not markdown sections) — the prompt must ask for a JSON object with exact keys. Write parsing tests before wiring the API. Summary button is ALWAYS manual — no auto-trigger. Do NOT add Daily Briefing here (M6). Do NOT create `internal_tasks` rows here (M6).
> **COMMIT:** `[M5] ai_summaries schema migration` → `[M5] AI client + prompts + tests` → `[M5] per-deal summary — generate + cache` → `[M5] mo-action group wired to /api/deals`

**Goal:** Per-deal AI summaries working. Mo can get full deal context from Claude in one click.

**Checklist — Schema (must be first):**
- [x] Add `AiSummary` model to `prisma/schema.prisma`
- [x] `npm run db:migrate` → `add-ai-summaries`
- [x] `npm run db:generate`

**Checklist — AI Library (TDD):**
- [x] `npm install @anthropic-ai/sdk`
- [x] `/src/lib/ai/errors.ts` — `AIError` class (isolated from SDK for testability)
- [x] `/src/lib/ai/client.ts` — `callClaude()` wrapper, throws `AIError`
- [x] `/src/lib/ai/prompts.ts` — `buildSummaryPrompt()` with JSON instruction, lookback filter
- [x] `/src/lib/ai/summary.ts` — `parseSummaryResponse()` with full validation
- [x] `/src/lib/ai/generate.ts` — `runSummaryGeneration()` orchestrator
- [x] `prompts.test.ts` + `summary.test.ts` — 14 tests all green

**Checklist — API + UI:**
- [x] `/src/lib/db/summaries.ts` — `getLatestSummary()`, `upsertSummary()`, `getMoActionDealIds()`
- [x] `POST /api/deals/[id]/summary` — cookie-authed
- [x] `GET /api/deals/[id]` — includes `summaryData`
- [x] `GET /api/deals` — `mo_action_required` group via `getMoActionDealIds()`
- [x] DealPanel: Generate button, `AiSummaryBlock` (6 sections, stale badge, ↻ Regenerate)
- [x] `dashboard/page.tsx`: `mo_action_required` in `FLAG_CONFIG` + `DISPLAY_ORDER`
- [x] git commit: `[M5] per-deal AI summary`
- [ ] git tag: `sprint-5-done`

**Not in M5:** Daily Briefing (M6), internal_tasks creation (M6), suggested follow-up questions (P2), document checklist (deferred indefinitely), Mo Action Required keyword heuristics (not building — AI handles it).

**Done when:** Mo can click "Generate AI Summary" on any deal with Layer 2 loaded and get a useful, actionable summary in under 20 seconds.

---

## Milestone 6: Tasks + Daily Briefing

> **AGENT PRECONDITIONS:** M5 complete. `ai_summaries` table has real data from at least 3 deals.
> **AGENT:** Schema migration first (internal_tasks table). Tasks is the primary deliverable — complete all task functionality before starting Daily Briefing. If tasks runs long, Daily Briefing slips cleanly; tasks alone makes M6 a success. Test task CRUD with real DB. Daily Briefing prompt must be manually inspected before wiring to Claude.
> **COMMIT:** `[M6] internal_tasks schema migration` → `[M6] tasks API + UI` → `[M6] daily briefing`

**Goal:** Tasks replaces Trello. Daily Briefing gives Mo a morning summary in one click.

**Checklist — Schema (must be first):**
- [x] Add `InternalTask` model to `prisma/schema.prisma`:
  - `id`, `dealHubspotId` (nullable FK → deals), `title`, `notes`, `status` (open/done), `dueDate`, `category` enum (case/business/vendor/legal/networking/other), `source` (always `'manual'` in v1), `createdAt`, `completedAt`
- [x] `npm run db:migrate` → migration name: `add-internal-tasks`
- [x] `npm run db:generate`

**Checklist — Tasks (primary deliverable):**
- [x] `/src/lib/db/tasks.ts` — `getOpenTasks()`, `createTask()`, `completeTask()`, `deleteTask()`
- [x] `GET /api/tasks` — returns open + recent completed tasks
- [x] `POST /api/tasks` — creates task (manual source)
- [x] `PATCH /api/tasks/[id]` — mark complete
- [x] `DELETE /api/tasks/[id]` — delete
- [x] Tasks page (`/dashboard/tasks`) renders all open tasks sorted by due date
- [x] Tasks grouped by category (case / business / vendor / legal / networking)
- [x] Case-linked tasks show deal name with clickable link to open the deal panel
- [x] Add task form: title, notes, due date, category, optional deal link
- [x] Mark task complete (moves to "Completed" section, last 30 days)
- [x] Delete task
- [x] Task count badge on "Tasks" link in sidebar navigation
- [x] **Mo Action Required → task prompt**: when Mo clicks "Generate AI Summary" and `mo_action_required: true`, show a "Create task" prompt below the summary — pre-fills `suggested_next_step` as the task title. Mo can accept (creates task with `source: 'manual'`) or dismiss. No auto-create. `source: 'ai_detected'` is NOT used — all tasks are manual source regardless of origin.

**Checklist — Daily Briefing (secondary, ships after tasks):**
- [x] "Daily Briefing" button on dashboard header
- [x] `/api/briefing` route — builds context from Layer 1 flags + cached AI summaries + open tasks
- [x] Briefing prompt: what happened, what needs attention, suggested priorities for today, open tasks
- [x] Employee activity section: count notes/calls per owner in last 7 days from `deal_activities` — **silently omit if fewer than 7 days of data exist** (no placeholder, no error)
- [x] Briefing renders in a full-width modal
- [x] Briefing is always freshly generated — no caching
- [x] **Acceptance:** Mo clicks "Daily Briefing" → receives a concise morning briefing in under 30 seconds covering flagged deals, open tasks, and (if available) employee activity. Employee section silently absent if no Layer 2 data.
- [x] git commit: `[M6] tasks + daily briefing`
- [x] git tag: `sprint-6-done`

**Done when:** Mo can manage his daily case and business tasks without Trello. Daily Briefing is a bonus if tasks ships cleanly.

---

## Milestone 7: Settings

> **AGENT PRECONDITIONS:** M6 complete. `app_settings` table exists (seeded in M2b).
> **AGENT:** When settings are saved, attention queue rules must read from `app_settings` instead of `thresholds.ts`. Replace thresholds.ts lookups with DB lookups. Verify staleness rules still work after the switch.
> **COMMIT:** `[M7] app_settings seed defaults` → `[M7] settings API` → `[M7] settings UI — thresholds editable`

**Goal:** Configurable staleness thresholds without requiring a code deploy.

**What changes in M7:** All rules currently read from `thresholds.ts` constants passed as `RuleContext` fields. In M7, `buildRuleCtx()` (in `src/lib/rules/ctx.ts`) loads the same values from `app_settings` instead of hardcoded constants. Rules don't change at all — only `ctx.ts` changes. Both `/api/deals` and `briefing.ts` automatically pick up the new values since they both call `buildRuleCtx()`.

**Checklist:**
- [ ] Seed `app_settings` with all threshold defaults (if not already done in M2b):
  - `stage_stale_ready_for_outreach = 5`
  - `stage_stale_attempted_contact = 7`
  - `stage_stale_contact_made = 5`
  - `stage_stale_follow_up_needed = 5`
  - `stage_stale_engaged_interested = 3`
  - `stage_stale_letter_outreach = 14`
  - `agreement_sent_no_followup_days = 2`
  - `signed_no_activity_days = 5`
  - `ai_summary_lookback_days = 28`
- [ ] Update `src/lib/rules/ctx.ts` (`buildRuleCtx`): make async, load thresholds from `app_settings` via `loadThresholds()` instead of `thresholds.ts` constants. Update all callers to `await buildRuleCtx(...)` (two callers: `/api/deals` route and `briefing.ts`).
- [ ] Update `generate.ts`: replace `AI_SUMMARY_LOOKBACK_DAYS` import with value loaded from `app_settings`
- [ ] `GET /api/settings` — returns all editable settings as `{ key, value, label }` objects
- [ ] `PATCH /api/settings` — saves one or more settings (validate: must be positive integer)
- [ ] Settings page (`/dashboard/settings`) renders all threshold values as editable number inputs
- [ ] Settings save → immediately affects attention queue and AI summary lookback on next request
- [ ] Sync log visible in settings: last 10 syncs, call counts, errors, timestamps
- [ ] Note: sync schedule is NOT in settings — lives in `vercel.json`, requires redeploy to change
- [ ] **Acceptance:** Mo changes "Attempted Contact" from 7 to 10 days → attention queue immediately reflects the new threshold without a code deploy.
- [ ] git commit: `[M7] configurable thresholds — settings page`
- [ ] git tag: `sprint-7-done`

**Not in M7:** In-app Product Roadmap page (the markdown file IS the roadmap — no in-app editor needed).

**Done when:** Mo can change any staleness threshold from the dashboard and see it take effect immediately without a code deploy.

---

## Milestone 8: Polish & Production

**Goal:** Production-ready, stable, and maintainable.

**Checklist:**
- [ ] Error boundaries on all major components (dashboard, deal panel, tasks page, settings)
- [ ] HubSpot API down → show stale data with clear warning banner (HubSpotError → banner, not crash)
- [ ] Anthropic API down → "Summary unavailable" in panel (AIError → message, not crash)
- [ ] Loading states on all async operations
- [ ] Mobile warning: "This dashboard is optimized for desktop browsers"
- [ ] Empty state messages: no deals in a group, no tasks, no summary yet, no Layer 2 loaded
- [ ] Cloudflare domain pointing to Vercel (production URL)
- [ ] All Vercel environment variables confirmed set in production:
  - `DATABASE_URL`, `DIRECT_URL`, `HUBSPOT_ACCESS_TOKEN`, `DASHBOARD_PASSWORD`, `ANTHROPIC_API_KEY`, `CRON_SECRET`
- [ ] Manual run-through of all features in production environment
- [ ] **Verify cron fires in production:** check sync_log after first scheduled run — confirm entries exist with `sync_type = 'layer1'` and non-null `completed_at`

**Done when:** The production URL loads, password gate works, data syncs on schedule, and Mo can use it as his daily driver without watching the terminal.

---

## Design Doc Coverage Checklist

Use this to verify the design-doc.md covers everything before building.

### Architecture
- [x] Tech stack defined
- [x] Design philosophy defined (KISS, smallest useful thing, proof-of-concept layers)
- [x] Full file structure defined (src/lib/rules/, src/lib/hubspot/, src/lib/db/, etc.)
- [x] Two-layer data model defined (Layer 1 cheap+broad, Layer 2 on-demand only)
- [x] Layer 1 fields enumerated (some field names TBD from M1)
- [x] Layer 2 content defined (always on-demand — no auto-pull)
- [x] Sync schedule defined (4x daily, smart sync default, full refresh available)
- [x] Rate limiter spec (3 req/s = 30% of Starter limit)
- [x] Caching strategy defined (DB is the cache, raw_payload for flexibility)

### Database
- [x] `deals` table
- [x] `deal_activities` table
- [x] `deal_contacts` table
- [x] `deal_snoozes` table with categories
- [x] `ai_summaries` table with JSON shape
- [x] `internal_tasks` table
- [ ] ~~`document_checklist` table~~ — removed (deferred indefinitely)
- [ ] ~~`product_roadmap` table~~ — removed (markdown file is sufficient)
- [x] `app_settings` table with defaults
- [x] `sync_log` table

### Business Logic
- [x] Stage health rules (all 9 stages)
- [x] Attention triggers (all categories)
- [x] Business days calculation
- [x] Snooze system (categories, wake behavior)
- [x] Mo Action Required — surfaced from AI summary JSON (no keyword heuristics)
- [ ] ~~Document checklist~~ — removed (deferred indefinitely)
- [x] AI summary staleness: computed at read time (`lastActivityDate > generatedAt`)

### UI
- [x] Dashboard home layout
- [x] Summary cards
- [x] Attention group structure
- [x] Deal card fields
- [x] Deal detail panel layout
- [x] Activity timeline
- [x] Contacts display
- [x] Document checklist display
- [x] AI summary format
- [x] Suggested follow-up questions
- [x] Snooze modal
- [x] Tasks page
- [x] Settings page
- [x] Product Roadmap page

### AI
- [x] Per-deal summary prompt structure
- [x] Daily Briefing prompt structure
- [x] Cache strategy
- [x] Mo Action Required → task suggestion flow
- [x] Conversational follow-up design

### HubSpot
- [x] Private App scopes listed
- [x] Layer 1 API call documented
- [x] Layer 2 API calls documented
- [x] Schema discovery endpoints
- [x] Rate limiting approach

### Open Questions Remaining (resolve in M1)
- [x] HubSpot plan tier: **Starter confirmed**
- [x] Email notifications: **dashboard only in v1**
- [x] Layer 2 auto-pull: **no auto-pull — always on-demand**
- [x] Timezone: **America/New_York**
- [x] Google Drive file API availability → **NOT accessible via API** (UI sidebar only)
- [x] Email body text accessible on Starter plan → **✅ confirmed** (`hs_email_text` via `sales-email-read`)
- [x] Email direction field accessible → **⚠️ partial** — field exists (`hs_email_direction`), observed value is `"EMAIL"` not assumed `"INCOMING_EMAIL"`. Full value set unconfirmed — do not implement directional Mo Action Required logic until confirmed
- [x] All custom deal property names → **✅ confirmed** — see `field-mapping.md`
- [x] All custom contact property names → **✅ confirmed** — 11 phone variants, `is_deceased`, `do_not_contact`, `contact_type1`
- [x] `last_activity_date` exact property name → **`notes_last_updated`** ✅; also store `hs_v2_date_entered_current_stage` → `stage_entered_at`
- [x] `contact_count` in CRM Search → **`num_associated_contacts` ✅ confirmed available**
- [x] `task_count` / `open_task_count` → **not confirmed — omit columns in M2b, add back when confirmed**
- [ ] Mo Action Required heuristics — validate against real note data in M4 (after Layer 2 working)

---

## HubSpot Token Setup Guide

*(For Mo — complete before Milestone 0)*

**Option A: Personal Access Key (simpler — HubSpot now recommends this)**
1. Log into HubSpot
2. Go to: Settings → Integrations → Private Apps (it redirects to Personal Access Key flow)
3. Ensure **CRM Objects** is checked ("Read data from HubSpot objects in the CRM")
4. Click "Generate personal access key"
5. Copy the token
6. Paste into `.env.local` as `HUBSPOT_ACCESS_TOKEN=your_token_here`

**Option B: Private App (legacy — still works)**
1. Log into HubSpot
2. Go to: Settings → Integrations → Private Apps → Go to Legacy Apps
3. Create a private app with scopes: `crm.objects.deals.read`, `crm.objects.contacts.read`, `crm.objects.notes.read`, `crm.objects.tasks.read`, `crm.objects.calls.read`, `crm.objects.emails.read`, `crm.schemas.deals.read`, `crm.schemas.contacts.read`
4. Copy the access token → paste into `.env.local`

Both options produce a Bearer token used identically in API calls.

---

## Dependencies Between Milestones

```
M0 (Private App Setup)
  └── M1 (API Research + Schema Discovery) ← Mo reviews raw data here
        └── M2a (Project Skeleton)
              └── M2b (DB Schema — finalized from M1 findings)
                    └── M2c (Sync Engine) ✅
                          └── M3 (Attention Queue) ✅ ← First demo
                                └── M4 (Deal Panel + Snooze + Layer 2)
                                      └── M5 (AI Summary — per-deal, manual only)
                                            └── M6 (Tasks + Daily Briefing)
                                                  └── M7 (Settings — configurable thresholds)
                                                        └── M8 (Polish + Deploy)
```

**Critical path:** M1 (API research + Mo review) must complete before DB schema is finalized. Everything else is sequential. M7 can be done in parallel with M5–M6 if needed.

**Things we decided NOT to build:**
- `mo-action.ts` keyword heuristics rule — AI summary's `mo_action_required` field handles this
- In-app Product Roadmap page — the markdown file is the roadmap
- `product_roadmap` DB table — follows from above
- Document checklist UI and AI inference — too complex, Google Drive already exists
- "Snooze Expired" attention group — expired snoozes naturally reappear in their normal flag group
- Summary cards row (🔴/🟡 counts in header) — requires data from M5+ to be meaningful
- Schema drift monitor — too speculative for current needs
