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
> **OPEN M1 QUESTIONS (do not block M2a/M2b — document in mapper TODO):**
> - `estimated_surplus` is the primary display field. Store both `estimated_surplus` and `amount` in DB, display `estimated_surplus`. ✅ resolved
> - Email `hs_email_direction` values — do not implement directional logic until confirmed.
> - Task counts in Layer 1 — assume not available; skip `task_count`/`open_task_count` columns for now.

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

**2c — Sync Engine**
- [ ] `/src/lib/utils/rate-limiter.ts` — token bucket (3 req/s cap) — **write tests first using Vitest**
- [ ] `/src/lib/hubspot/client.ts` — uses rate-limiter; exponential backoff on 429; throws typed errors on 5xx; daily call count read from sync_log (not in-memory)
- [ ] `/src/lib/hubspot/mapper.ts` — raw HubSpot → internal types. **M1-confirmed rules:**
  - Every property read uses `?? null` — never assume a key exists (schema flexibility rule)
  - HTML-strip `hs_note_body` before storing (notes return HTML div/p tags)
  - Phone validation: collect all 11 variants, reject values that are clearly not phone numbers (e.g. date strings like "02/06/2024")
  - Use `hs_v2_date_entered_current_stage` → `stage_entered_at`; use `notes_last_updated` → `last_activity_date` (both useful, different meaning)
  - Loads `stageMap` + `ownerMap` from `app_settings` — never hardcode stage names
  - **Tests use `docs/research/sample-deal.json`, `sample-deal-contacts.json`, etc. as fixtures — never call real HubSpot**
- [ ] `/src/lib/sync/layer1.ts` — smart sync (hs_lastmodifieddate filter) + full refresh mode; upserts deals with raw_payload; writes sync_log entry
- [ ] `/src/lib/sync/layer2.ts` — per-deal pull; upserts activities + contacts with raw_payload
- [ ] `/api/sync/layer1/route.ts` — callable by Vercel Cron + manual refresh button
- [ ] `/api/sync/layer2/[id]/route.ts` — on-demand, called from deal panel "Load Full Detail"
- [ ] Vercel Cron in `vercel.json`: `"schedule": "0 13,15,17,19 * * 1-5"` (EDT UTC — see api-reference.md)
  - **⚠️ Hobby plan only allows once/day.** Use `"0 14 * * 1-5"` on Hobby. Upgrade to Pro ($20/mo) for 4x daily. Pro plan timeout: 300s (not 10s).
- [ ] "Last synced: [timestamp]" reads from sync_log.completed_at
- [ ] **All unit tests pass:** `npm test`
- [ ] git commit: `[M2c] sync engine — rate limiter, client, mapper, layer1, layer2`
- [ ] Integration test: trigger Layer 1 sync manually → verify deals table populated with real HubSpot data
- [ ] Integration test: trigger Layer 2 for one deal → verify deal_activities + deal_contacts populated
- [ ] Acceptance: deals in DB, stageMap resolves correctly, "Last synced: [time]" visible
- [ ] git commit: `[M2c] integration verified — real data in database`
- [ ] git tag: `sprint-2c-done`

**Done when:** Real HubSpot data is in the database, syncing on schedule, last-synced timestamp visible in production.

---

## Milestone 3: Attention Queue UI

> **AGENT PRECONDITIONS:** M2 complete, real deals in `deals` table, sync log shows successful Layer 1 sync.
> **AGENT:** Write rule tests before implementing rules. Each rule is a separate file in `/src/lib/rules/`. Test with real deal data from the database. Stop and ask Mo if attention queue results don't match expectations.
> **COMMIT:** `[M3] business-days utility + tests` → `[M3] attention rules + tests` → `[M3] attention queue UI`

**Goal:** The full attention queue renders with real data. First demoable milestone.

**Checklist — Layer 1 Rules Only (no Layer 2 data available yet):**
- [ ] `/src/lib/utils/business-days.ts` — write tests first, implement after tests are red
- [ ] `/src/lib/rules/staleness.ts` — write test first (test with mock deal + threshold)
- [ ] `/src/lib/rules/agreement.ts` — write test first
- [ ] `/src/lib/rules/signed.ts` — write test first
- [ ] `/src/lib/rules/contacts.ts` — Layer 1 version only: flag if `contact_count = 0`
- [ ] `/src/lib/rules/snooze.ts` — write test first
- [ ] `/src/lib/rules/index.ts` — orchestrates all rules, returns AttentionFlag[]
- [ ] All rule tests green: `npm test`
- [ ] git commit: `[M3] attention rules + tests — Layer 1 only`
- [ ] `/api/deals/route.ts` — returns deals grouped by attention flags
- [ ] Dashboard home: collapsible attention groups (flagged first, Healthy Deals collapsed at bottom)
- [ ] Summary cards: counts per group
- [ ] Deal card: name, stage, owner, last activity, reason flagged
- [ ] Snoozed deals excluded from attention groups
- [ ] "Last synced: [timestamp]" always visible
- [ ] Refresh button (smart default) + "Full Refresh" option
- [ ] Color coding: 🔴 red, 🟡 yellow, 🔵 blue, ⬜ gray (snoozed/healthy)
- [ ] **Acceptance:** Mo opens dashboard, sees real deals grouped by attention reason. Snoozed deals don't appear. Last synced timestamp visible.
- [ ] git commit: `[M3] attention queue UI — collapsible groups, deal cards`
- [ ] git tag: `sprint-3-done`

**Layer 2-dependent rules (Mo Action Required, phone check) are added in M4 after Layer 2 works.**

**Done when:** Dashboard opens and shows real deals in the right attention groups. Mo can look at it and say "yes, that's what needs attention."

---

## Milestone 4: Deal Detail Panel

> **AGENT PRECONDITIONS:** M3 complete, attention queue rendering correctly with real data.
> **AGENT:** Panel opens immediately with Layer 1 data. Layer 2 pull is behind "Load Full Detail" button with call count warning. Test snooze creates correct DB row and removes deal from queue in next render.
> **COMMIT:** `[M4] deal panel — Layer 1 display` → `[M4] Layer 2 pull — on demand` → `[M4] snooze — save + remove from queue`

**Goal:** Click a deal, see everything relevant, snooze it, add a task.

**Checklist:**
- [ ] Slide-in panel component (no page navigation, overlay from right)
- [ ] Panel header: deal name, stage, owner, amount, address, county, parcel ID, tax sale date
- [ ] "Open in HubSpot" link (deal URL from `deals.hubspot_url`)
- [ ] Panel opens with Layer 1 data immediately — no loading required
- [ ] "Load Full Detail" button — triggers Layer 2 pull for this deal
- [ ] API call count warning shown before Layer 2 pull: *"~30–50 HubSpot API calls. Continue?"*
- [ ] Activity timeline: calls, notes, emails, tasks in reverse chronological order
- [ ] Timeline items show: type, author, timestamp, content
- [ ] Linked contacts section: name, relationship, deceased flag, phone numbers, DNC status
- [ ] Document checklist section (manual check-off for Phase 1)
- [ ] Snooze button → modal with: category dropdown, date picker, freeform note field
- [ ] Snooze saved to `deal_snoozes` table
- [ ] Snooze removes deal from attention queue immediately
- [ ] Snooze expired → deal appears in Snooze Expired group on wake date
- [ ] "Remove snooze" button in panel for active snoozes
- [ ] Snooze history visible in panel (past snoozes, collapsed)
- [ ] **Add Layer 2-dependent rules now that deal_activities + deal_contacts exist:**
  - [ ] `/src/lib/rules/contacts.ts` — upgrade: check phone_numbers from deal_contacts
  - [ ] `/src/lib/rules/mo-action.ts` — PLACEHOLDER keywords, validate with real data first — write test after seeing real notes
- [ ] **Acceptance:** Mo clicks any deal → Layer 1 panel instant. "Load Full Detail" → timeline + contacts appear. Snooze → deal gone from queue. Refresh → deal gone.
- [ ] git commit: `[M4] deal panel + snooze + Layer 2 rules`
- [ ] git tag: `sprint-4-done`

**Done when:** Mo can open any deal, see all relevant context, and snooze it with a reason and date.

---

## Milestone 5: AI Integration

> **AGENT PRECONDITIONS:** M4 complete. `ANTHROPIC_API_KEY` set in `.env.local`. Layer 2 working for at least one real deal (activities + contacts in DB).
> **AGENT:** Build prompts.ts first, verify prompt output manually before wiring to Claude API. Summary button is ALWAYS manual — no auto-trigger. Test that `is_stale` flag is set correctly when new activity exists.
> **COMMIT:** `[M5] AI client + prompts` → `[M5] per-deal summary — generate + cache` → `[M5] daily briefing`

**Goal:** Per-deal AI summaries and Daily Briefing both working.

**Checklist:**
- [ ] `npm install @anthropic-ai/sdk`
- [ ] `/lib/ai/summary.ts` — builds prompt from Layer 2 data, calls Claude API, parses response
- [ ] AI summary stored in `ai_summaries` table (JSON)
- [ ] "Generate AI Summary" button in deal panel — always manual, no auto-trigger
- [ ] Summary renders in panel with correct bullet sections:
  - Current Status
  - Last Meaningful Activity
  - Blockers
  - Who Needs Something
  - Suggested Next Step
  - Mo Action Required flag
  - Documents Likely Missing
- [ ] "Generated [X minutes ago]" timestamp shown
- [ ] "New activity since summary" badge shown when `deal.last_activity_date > summary.generated_at`
- [ ] "↻ Regenerate" button triggers fresh summary
- [ ] Suggested follow-up questions (3–5 presets) shown below summary
- [ ] Free-text follow-up input → sends to Claude with deal context → response displayed
- [ ] "Mo Action Required" flag from AI summary creates suggested internal task (with accept/dismiss prompt)
- [ ] "Daily Briefing" button on dashboard home
- [ ] `/api/briefing` route — generates briefing using Layer 1 + cached Layer 2 for high-value stages
- [ ] Briefing renders in a modal or dedicated panel
- [ ] Briefing cached per day (one per day unless manually regenerated)

- [ ] Add employee activity section to briefing ONLY if `deal_activities` has sufficient data — query by `author_owner_id`, count notes/calls in last 7 days per owner
- [ ] **Acceptance:** Mo clicks "Generate AI Summary" on one deal → 7-section bullet response appears in under 15 seconds. Clicking again before new activity → "stale" badge visible, not auto-regenerated.
- [ ] git commit: `[M5] AI summary + daily briefing`
- [ ] git tag: `sprint-5-done`

**Done when:** Mo can click "Generate AI Summary" on any Signed/In Progress deal and get a useful, actionable summary in bullet form.

---

## Milestone 6: Internal Task List

> **AGENT PRECONDITIONS:** M5 complete.
> **AGENT:** Tasks table added via `npx prisma migrate dev`. Migrate before building UI. Test task CRUD with real DB.
> **COMMIT:** `[M6] tasks table migration` → `[M6] tasks API + UI`

**Goal:** Mo's Trello replacement, linked to deals and general.

**Checklist:**
- [ ] Tasks page renders all open tasks sorted by due date
- [ ] Tasks grouped by category (case / business / vendor / legal / networking)
- [ ] Case-linked tasks show deal name with link to deal panel
- [ ] Add task form: title, notes, due date, category, deal link (optional search)
- [ ] Mark task complete (moves to "Completed" section, last 30 days)
- [ ] Delete task
- [ ] AI-suggested tasks (from Mo Action Required detection) shown with "Accept / Dismiss"
- [ ] Task count badge in sidebar navigation
- [ ] Dashboard home shows "X open tasks" in summary cards

**Done when:** Mo can manage his daily case and business tasks without opening Trello.

---

## Milestone 7: Settings & Product Roadmap

> **AGENT PRECONDITIONS:** M6 complete. `app_settings` and `product_roadmap` tables added via migration.
> **AGENT:** When settings are saved, attention queue rules must read from `app_settings` instead of `thresholds.ts`. Replace thresholds.ts lookups with DB lookups. Verify staleness rules still work after the switch.
> **COMMIT:** `[M7] app_settings migration + seeded defaults` → `[M7] settings page — thresholds editable` → `[M7] roadmap page + export`

**Goal:** Configurable thresholds, in-app roadmap capture.

**Checklist:**
- [ ] `app_settings` and `product_roadmap` table migrations applied, defaults seeded
- [ ] Settings page renders all `app_settings` values
- [ ] Stage staleness thresholds: one editable row per stage
- [ ] AI summary lookback window (days)
- [ ] Sync log: last 10 syncs, call counts, errors
- [ ] Settings save to `app_settings` table → immediately affects attention queue (replaces thresholds.ts lookups)
- [ ] Note: sync schedule is NOT in settings — it lives in vercel.json (static, requires redeploy to change)
- [ ] Product Roadmap page renders items grouped by version (v2, v3, v4+)
- [ ] Each roadmap item: title, description, status badge
- [ ] Add / edit / delete roadmap items
- [ ] "Export as Markdown" downloads a `.md` file of all roadmap items (for feeding back to Claude)

**Done when:** Mo can change a staleness threshold, see it reflected in the attention queue immediately, and export the roadmap to feed back to an AI.

---

## Milestone 8: Polish & Production

**Goal:** Production-ready, stable, and maintainable.

**Checklist:**
- [ ] Error boundaries on all major components
- [ ] HubSpot API down → show stale data with clear warning banner
- [ ] Loading states on all async operations
- [ ] Mobile warning: "This dashboard is optimized for desktop browsers"
- [ ] Empty state messages (no deals in a group, no tasks, no summary yet)
- [ ] HubSpot Private App setup guide written for Mo (`docs/hubspot-setup.md`)
- [ ] Cloudflare domain pointing to Vercel (production URL)
- [ ] Vercel environment variables all set in production
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
                    └── M2c (Sync Engine)
                          └── M3 (Attention Queue) ← First demo
                                ├── M4 (Deal Panel + Layer 2 on-demand)
                                │     └── M5 (AI Integration — manual only)
                                │           └── M6 (Tasks)
                                └── M7 (Settings + Roadmap)
                                      └── M8 (Polish + Deploy)
```

**Critical path:** M1 (API research + Mo review) must complete before DB schema is finalized. Do not design tables from assumptions. Everything else is sequential. M7 can be done in parallel with M5–M6.
