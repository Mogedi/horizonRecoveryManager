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

**2a — Project Skeleton (comes first, before DB work)**
- [ ] `npx create-next-app@latest horizon-manager --typescript --tailwind --app` (installs Next.js 16+, Turbopack default)
- [ ] `npm install prisma @prisma/client`
- [ ] `npm install -D vitest @vitejs/plugin-react jsdom @testing-library/react @testing-library/dom vite-tsconfig-paths @vitest/coverage-v8` — test framework
- [ ] Create `vitest.config.mts` — Vitest config with react plugin + jsdom environment
- [ ] Create `.env.local` with: `DATABASE_URL` (Neon pooled), `DIRECT_URL` (Neon direct), `HUBSPOT_ACCESS_TOKEN`, `DASHBOARD_PASSWORD`
- [ ] Create `.env.example` — same keys, blank values, committed to repo
- [ ] `/src/lib/db/client.ts` — Prisma singleton (`globalThis` pattern)
- [ ] In `prisma/schema.prisma` datasource: set both `url = env("DATABASE_URL")` and `directUrl = env("DIRECT_URL")`
- [ ] `/middleware.ts` — password check, redirect to `/login` if cookie missing
- [ ] `/login/page.tsx` → sets HTTP-only cookie → redirects to `/dashboard`
- [ ] `/dashboard/layout.tsx` — sidebar layout, basic structure
- [ ] GitHub repo created, Vercel project connected, first deploy succeeds (Vercel autogenerated URL)
- [ ] Add `docs/research/` and `.env.local` to `.gitignore`
- [ ] Acceptance: `/login` with correct password → `/dashboard` loads. Wrong password → stay on `/login`.
- [ ] git commit: `[M2a] project skeleton — auth, Prisma singleton, Vitest`
- [ ] git tag: `sprint-2a-done`

**2b — Database Schema (blocked until `DATABASE_URL` + `DIRECT_URL` provided by Mo)**
- [ ] Neon database created — Mo pastes `DATABASE_URL` (pooled) + `DIRECT_URL` (direct) into `.env.local` and Vercel env
- [ ] Finalize Prisma schema from `field-mapping.md`. Key column notes from M1:
  - `deals`: include `stage_entered_at` (→ `hs_v2_date_entered_current_stage`), `estimated_surplus`, `last_modified`; use `owner_id` not `owner_name`; `property_address` (maps from `properties_address`), `parcel_id` (maps from `parcel_id__deal`)
  - `deals`: **drop** `task_count` and `open_task_count` — not confirmed available in Layer 1; add back when confirmed
  - `deal_contacts`: use `contact_type` (→ `contact_type1`) and `ownership_status` (→ `ownership_contact_status1`); **drop** `relationship_status`, `curr_address`, `age` — not in confirmed field list
  - All tables: include `raw_payload JSONB`
- [ ] M3 tables: `deals`, `deal_activities`, `deal_contacts`, `deal_snoozes`, `sync_log`
- [ ] Seed `app_settings` with `stage_map` (from `pipeline-stages.json`) and `owner_map` (from `owners.json`)
- [ ] `npx prisma migrate dev --name init`
- [ ] `/src/lib/utils/thresholds.ts` — hardcoded staleness thresholds per active stage (settings page is M7)
  - Skip terminal stages (Dead/Not Interested, DNC, Blocked Missing Info, Exhausted, Closed-Paid) — no staleness rules fire on these
  - Skip Foreclosures ("F") and More Research Need — pre-pipeline, no staleness rules
- [ ] Acceptance: `npx prisma studio` shows all tables with correct columns
- [ ] git commit: `[M2b] database schema — M3 tables, confirmed field names from M1`
- [ ] git tag: `sprint-2b-done`

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

**Known architectural debt from M2c (fix in pre-M3 pass):**
- [ ] N+1 upsert in layer1.ts — 150 DB round-trips on full refresh. Fix: bulk upsert via `$executeRaw INSERT ... ON CONFLICT DO UPDATE`
- [ ] `asJson` bare cast — use `JSON.parse(JSON.stringify(v))` before cast to catch non-serializable values
- [ ] Remove `_stageMap` param from `mapDeal` — accepted but never used, misleading API
- [ ] Remove `estimateLayer2Calls()` — returns made-up number; replace with static UI message
- [ ] Cron auth not verified — `x-vercel-cron-signature` presence checked but not HMAC-verified (low risk, fix in M4)

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

## Milestone 4: Deal Detail Panel

> **AGENT PRECONDITIONS:** M3 complete, attention queue rendering correctly with real data.
> **AGENT:** Panel opens immediately with Layer 1 data. Layer 2 pull is behind "Load Full Detail" button with static call count range. Test snooze creates correct DB row and removes deal from queue in next render.
> **COMMIT:** `[M4] deal panel — Layer 1 display` → `[M4] Layer 2 pull — on demand` → `[M4] snooze — save + remove from queue`

**Goal:** Click a deal, see everything relevant, snooze it.

**Checklist:**
- [ ] Slide-in panel component (no page navigation, overlay from right)
- [ ] Panel header: deal name, stage, owner, amount, address, county, parcel ID, tax sale date
- [ ] "Open in HubSpot" link (deal URL from `deals.hubspot_url`)
- [ ] Panel opens with Layer 1 data immediately — no loading state
- [ ] GET `/api/sync/layer2/[id]` — returns `{ callRangeMessage, lastSyncedAt }` (no fake estimate — already built)
- [ ] "Load Full Detail" button — shows `callRangeMessage`, then POSTs to `/api/sync/layer2/[id]`
- [ ] Activity timeline: calls, notes, emails, tasks in reverse chronological order
- [ ] Timeline items: type, author, timestamp, content
- [ ] Linked contacts: name, relationship, deceased flag, phone numbers, DNC status
- [ ] Snooze button → modal: category dropdown, date picker, optional note field
- [ ] Snooze saved to `deal_snoozes` table
- [ ] Snooze removes deal from queue on next render (deal reappears in normal flag group when snooze expires — no separate "Snooze Expired" group)
- [ ] "Remove snooze" button for active snoozes
- [ ] Snooze history visible in panel (past snoozes, collapsed)
- [ ] **Layer 2-dependent rules upgrade:**
  - [ ] `/src/lib/rules/contacts.ts` — upgrade to check `phone_numbers` from deal_contacts (semantics change — update existing tests, not just implementation)
  - [ ] **Do NOT create `mo-action.ts`** — Mo Action Required is read from AI summary JSON in M5, not keyword heuristics
- [ ] `GET /api/deals/[id]` — single deal with Layer 2 data if cached
- [ ] `POST /api/deals/[id]/snooze` + `DELETE /api/deals/[id]/snooze`
- [ ] **Acceptance:** Mo clicks any deal → Layer 1 panel opens instantly. "Load Full Detail" shows call range → Mo confirms → timeline + contacts appear. Snooze → deal gone from queue. Refresh → deal still gone.
- [ ] git commit: `[M4] deal panel + snooze + Layer 2 rules`
- [ ] git tag: `sprint-4-done`

**Done when:** Mo can open any deal, see all relevant context, and snooze it with a reason and date.

---

## Milestone 5: AI Summary

> **AGENT PRECONDITIONS:** M4 complete. `ANTHROPIC_API_KEY` set in `.env.local`. Layer 2 working for at least one real deal (activities + contacts in DB).
> **AGENT:** Build prompts.ts first, verify prompt output manually before wiring to Claude API. Summary button is ALWAYS manual — no auto-trigger. Test `is_stale` flag logic. Do NOT add Daily Briefing here — that ships in M6.
> **COMMIT:** `[M5] AI client + prompts` → `[M5] per-deal summary — generate + cache` → `[M5] mo-action flag wired to /api/deals`

**Goal:** Per-deal AI summaries working. Mo can get full deal context from Claude in one click.

**Checklist:**
- [ ] `npm install @anthropic-ai/sdk`
- [ ] `/lib/ai/summary.ts` — builds prompt from Layer 2 data, calls Claude API, parses 7-field response
- [ ] AI summary stored in `ai_summaries` table (JSON)
- [ ] "Generate AI Summary" button in deal panel — always manual, no auto-trigger
- [ ] Summary renders in panel with correct bullet sections:
  - Current Status
  - Last Meaningful Activity
  - Blockers
  - Who Needs Something
  - Suggested Next Step
  - Mo Action Required (yes/no)
  - Documents Likely Missing
- [ ] "Generated [X minutes ago]" timestamp shown
- [ ] "New activity since summary" badge shown when `deal.last_activity_date > summary.generated_at`
- [ ] "↻ Regenerate" button triggers fresh summary
- [ ] **Mo Action Required group in `/api/deals`:** after M5 ships, deals where `ai_summaries.summary_json.mo_action_required = true` appear in a "Mo Action Required" group (urgent). Add to `/api/deals` response once `ai_summaries` table has data.
- [ ] "Mo Action Required" → create suggested `internal_tasks` row with `source: 'ai_detected'` (accept/dismiss in M6 when tasks page ships)
- [ ] Suggested follow-up questions (3–5 presets below summary) — low priority, add if straightforward
- [ ] **Acceptance:** Mo clicks "Generate AI Summary" on one Signed/In Progress deal → 7-section response in under 15 seconds. Badge visible on next sync if new HubSpot activity exists. Regenerate button works.
- [ ] git commit: `[M5] per-deal AI summary`
- [ ] git tag: `sprint-5-done`

**Not in M5:** Daily Briefing (M6), document checklist inference (deferred indefinitely), Mo Action Required keyword heuristics (not building — AI handles it).

**Done when:** Mo can click "Generate AI Summary" on any Signed/In Progress deal and get a useful, actionable summary.

---

## Milestone 6: Tasks + Daily Briefing

> **AGENT PRECONDITIONS:** M5 complete. `ai_summaries` table has real data from at least 3 deals.
> **AGENT:** Tasks table migration before any UI work. Daily Briefing prompt built and verified manually before wiring to Claude. Test task CRUD with real DB.
> **COMMIT:** `[M6] tasks table migration` → `[M6] tasks API + UI` → `[M6] daily briefing`

**Goal:** Mo's Trello replacement, plus a morning briefing that summarizes what happened and what needs attention.

**Checklist — Tasks:**
- [ ] Tasks page renders all open tasks sorted by due date
- [ ] Tasks grouped by category (case / business / vendor / legal / networking)
- [ ] Case-linked tasks show deal name with link to deal panel
- [ ] Add task form: title, notes, due date, category, deal link (optional search)
- [ ] Mark task complete (moves to "Completed" section, last 30 days)
- [ ] Delete task
- [ ] AI-suggested tasks from M5 (`source: 'ai_detected'`) shown with "Accept / Dismiss"
- [ ] Task count badge in sidebar navigation

**Checklist — Daily Briefing:**
- [ ] "Daily Briefing" button on dashboard (replaces placeholder)
- [ ] `/api/briefing` route — generates briefing using Layer 1 + cached Layer 2 summaries
- [ ] Briefing prompt sections: what happened, what needs attention, open tasks
- [ ] Employee activity section ONLY if `deal_activities` has sufficient data (≥7 days) — query `author_owner_id`, count notes/calls per owner in last 7 days
- [ ] Briefing renders in modal or expanded panel
- [ ] Briefing is always freshly generated (no caching) — cheap enough at current volume
- [ ] **Acceptance:** Mo clicks "Daily Briefing" → concise summary of flagged deals + open tasks in under 20 seconds. Employee activity section appears only if data exists.
- [ ] git commit: `[M6] tasks + daily briefing`
- [ ] git tag: `sprint-6-done`

**Done when:** Mo can manage his daily case and business tasks without Trello, and get a morning briefing in one click.

---

## Milestone 7: Settings

> **AGENT PRECONDITIONS:** M6 complete. `app_settings` table exists (seeded in M2b).
> **AGENT:** When settings are saved, attention queue rules must read from `app_settings` instead of `thresholds.ts`. Replace thresholds.ts lookups with DB lookups. Verify staleness rules still work after the switch.
> **COMMIT:** `[M7] app_settings seed defaults` → `[M7] settings API` → `[M7] settings UI — thresholds editable`

**Goal:** Configurable staleness thresholds without requiring a code deploy.

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
- [ ] `GET /api/settings` — returns all editable settings
- [ ] `PATCH /api/settings` — saves one or more settings
- [ ] Settings page renders all values as editable number inputs (one row per threshold)
- [ ] Settings save → immediately affects attention queue (replaces hardcoded `thresholds.ts` lookups)
- [ ] Sync log visible in settings: last 10 syncs, call counts, errors
- [ ] Note: sync schedule is NOT in settings — lives in `vercel.json`, requires redeploy to change
- [ ] **Acceptance:** Mo changes "Attempted Contact" from 7 to 10 days → attention queue immediately reflects the new threshold.
- [ ] git commit: `[M7] configurable thresholds — settings page`
- [ ] git tag: `sprint-7-done`

**Not in M7:** In-app Product Roadmap page (the markdown file IS the roadmap — no in-app editor needed).

**Done when:** Mo can change any staleness threshold from the dashboard and see it take effect immediately without a code deploy.

---

## Milestone 8: Polish & Production

**Goal:** Production-ready, stable, and maintainable.

**Checklist:**
- [ ] Error boundaries on all major components
- [ ] HubSpot API down → show stale data with clear warning banner (HubSpotError → banner, not crash)
- [ ] Loading states on all async operations
- [ ] Mobile warning: "This dashboard is optimized for desktop browsers"
- [ ] Empty state messages (no deals in a group, no tasks, no summary yet)
- [ ] Cloudflare domain pointing to Vercel (production URL)
- [ ] All Vercel environment variables confirmed set in production (`DATABASE_URL`, `DIRECT_URL`, `HUBSPOT_ACCESS_TOKEN`, `DASHBOARD_PASSWORD`, `ANTHROPIC_API_KEY`, `CRON_SECRET`)
- [ ] Manual run-through of all features in production environment
- [ ] Sync log visible in settings (last 10 syncs, call counts, errors)

**Done when:** The production URL loads, password gate works, data syncs, and Mo can use it as his daily driver.

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
- [x] `document_checklist` table
- [x] `product_roadmap` table
- [x] `app_settings` table with defaults
- [x] `sync_log` table

### Business Logic
- [x] Stage health rules (all 9 stages)
- [x] Attention triggers (all categories)
- [x] Business days calculation
- [x] Snooze system (categories, wake behavior)
- [x] Mo Action Required detection heuristics
- [x] Document checklist (all document types)
- [x] AI summary cache invalidation rules

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
