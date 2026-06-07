# Horizon Intelligence Dashboard — Historical Milestones (M0–M8)

*All milestones below are complete as of 2026-06-07. Archived from `docs/gameplan.md` for reference.*

---

## Milestone 0: HubSpot Private App Setup ✅ COMPLETE

**Goal:** HubSpot access token in hand, ready to run API research scripts.

**Completed:**
- HubSpot Personal Access Key generated with CRM Objects scope
- Token confirmed working (curl test returns owner list)
- `docs/research/` directory created
- `.env.local` with `HUBSPOT_ACCESS_TOKEN`

---

## Milestone 1: HubSpot API Research ✅ COMPLETE

**Goal:** Know exactly what data we can pull before writing any sync code.

**Output files saved:**
- `docs/research/deal-properties.json` — 183 properties
- `docs/research/contact-properties.json` — 453 properties
- `docs/research/pipeline-stages.json` — "Cases – Surplus Funds" pipeline, 16 stages
- `docs/research/owners.json` — 3 owners: Mo, Kathleen, Marwa
- `docs/research/sample-deal.json` — CHATHAM - 701 W 48th St - Idella Grant ($36K)
- `docs/research/sample-deal-contacts.json`, notes, calls, emails, tasks
- `docs/research/field-mapping.md` — confirmed HubSpot property names

**Key decisions made:**
- `amount` is primary display field — `estimated_surplus` is null on all 150 deals
- `hs_v2_date_entered_current_stage` → `stage_entered_at` for staleness rules
- `notes_last_updated` → `last_activity_date`
- `num_associated_contacts` available in Layer 1 CRM Search
- 11 phone field variants confirmed
- Google Drive files NOT accessible via API (UI sidebar integration only)
- Email direction values not fully confirmed — directional logic deferred

---

## Milestone 2: Project Skeleton + Database + Sync Engine ✅ COMPLETE

**2a — Project Skeleton:**
- Next.js 16+ app with TypeScript + Tailwind (App Router)
- Prisma + @prisma/adapter-pg; Vitest test framework
- `src/lib/db/client.ts` — Prisma singleton (globalThis pattern)
- `src/proxy.ts` — auth cookie check (Next.js 16: renamed from middleware.ts; exports `proxy`)
- `/login/page.tsx` + `/dashboard/layout.tsx` — sidebar layout

**2b — Database Schema:**
- Neon database + env vars set
- Prisma schema: `deals`, `deal_activities`, `deal_contacts`, `deal_snoozes`, `sync_log`, `app_settings`
- `app_settings` seeded with `stage_map` + `owner_map`

**2c — Sync Engine (commit 7697a66):**
- `/src/lib/utils/rate-limiter.ts` — TokenBucket, 3 req/s
- `/src/lib/hubspot/client.ts` — rate-limited fetch, 429 backoff, HubSpotError
- `/src/lib/hubspot/mapper.ts` — only file with HubSpot property names
- `/src/lib/sync/layer1.ts` — smart sync + full refresh
- `/src/lib/sync/layer2.ts` — per-deal, delete+reinsert in transaction
- `/api/sync/layer1/route.ts` + `/api/sync/layer2/[id]/route.ts`
- `vercel.json` — cron 4x/day weekdays EDT
- 28 tests passing

---

## Milestone 3: Attention Queue UI ✅ COMPLETE

**Goal:** Full attention queue rendering with real data. First demoable milestone.

**Pre-M3 fixes:**
- Fix N+1 upsert in layer1.ts — `$transaction([...array])` bulk upsert
- Fix `asJson` — `JSON.parse(JSON.stringify(v))` safe cast
- Remove `_stageMap` from `mapDeal` signature
- Remove `estimateLayer2Calls()` — static range message instead

**Rules Engine (TDD):**
- `/src/lib/utils/business-days.ts` — 10 tests, `America/New_York`
- `/src/lib/rules/staleness.ts` — `stageEnteredAt`, skips terminals, `ctx.staleThresholds`
- `/src/lib/rules/agreement.ts` — Agreement Sent + `lastActivityDate` > 2 business days
- `/src/lib/rules/signed.ts` — Signed/In Progress + `lastActivityDate` > 5 business days
- `/src/lib/rules/contacts.ts` — Layer 1 version: `contactCount === 0`
- `/src/lib/rules/snooze.ts` — preloaded Set lookup, suppresses all other flags
- 59 tests passing

**API + UI:**
- `/api/deals/route.ts` — parallel fetch, groups by flag type, returns stageMap
- Dashboard: collapsible attention groups, color-coded
- Deal card: name, stage name, last activity relative date, flag reason

---

## Milestone 4: Deal Detail Panel ✅ COMPLETE

**Goal:** Click a deal, see everything relevant, snooze it.

- Slide-in panel component (fixed overlay from right)
- Panel header: deal name, stage name, owner, amount, county, parcel ID, tax sale date
- "Open in HubSpot" link
- "Load Full Detail" button → static call range confirmation → Layer 2 pull
- Activity timeline (calls, notes, emails, tasks) sorted newest first
- Linked contacts: name, relationship, deceased flag, phone numbers, DNC status
- Snooze: 7 categories, date picker, optional note
- Snooze history collapsible
- `contacts.ts` upgraded: checks `hasValidPhone` from deal_contacts
- 62 tests passing

---

## Milestone 5: AI Summary ✅ COMPLETE

**Goal:** Per-deal AI summaries via Claude API.

- `/src/lib/ai/client.ts` — Anthropic SDK singleton
- `/src/lib/ai/prompts.ts` — `buildSummaryPrompt()` with JSON instruction
- `/src/lib/ai/summary.ts` — `parseSummaryResponse()` with full validation
- `/src/lib/ai/generate.ts` — `runSummaryGeneration()` orchestrator
- `POST /api/deals/[id]/summary` — cookie-authed, manual only
- DealPanel: Generate button, `AiSummaryBlock` (6 sections, stale badge, Regenerate)
- Dashboard: `mo_action_required` group reads from AI summary JSON
- 72 tests passing

**7 AI summary fields:** `status`, `last_activity`, `blockers`, `who_needs_something`, `suggested_next_step`, `mo_action_required`, `missing_documents`

---

## Milestone 6: Tasks + Daily Briefing ✅ COMPLETE

**Goal:** Tasks replace Trello. Daily Briefing gives Mo a morning summary.

- `internal_tasks` schema migration
- Tasks: CRUD API, `/dashboard/tasks` page, 6 categories, case-linked
- Task count badge on sidebar nav
- AI summary → task prompt when `mo_action_required: true` (pre-fills suggested_next_step)
- Daily Briefing modal — AI-generated prose, attention queue + tasks + employee activity
- `getEmployeeActivitySummary()` — call/note counts per owner (last 7 days)
- 76 tests passing

---

## Milestone 7: Settings ✅ COMPLETE

**Goal:** Configurable staleness thresholds without a code deploy.

- `app_settings` seeded with all threshold defaults
- `buildRuleCtx()` made async, loads thresholds from `app_settings`
- `GET /api/settings` + `PATCH /api/settings`
- Settings page: editable number inputs per group, per-group Save buttons
- Sync log: last 10 syncs with call counts, duration, status
- 76 tests passing

**Settings keys seeded:**
- `stage_stale_ready_for_outreach = 5`
- `stage_stale_attempted_contact = 7`
- `stage_stale_contact_made = 5`
- `stage_stale_follow_up_needed = 5`
- `stage_stale_engaged_interested = 3`
- `stage_stale_letter_outreach = 14`
- `agreement_sent_no_followup_days = 2`
- `signed_no_activity_days = 5`
- `ai_summary_lookback_days = 28`

---

## Milestone 8: Polish & Production ✅ COMPLETE (code-side)

**Goal:** Production-ready, stable, maintainable.

- Error boundaries on all major components
- Stale data banner when last sync failed
- Mobile warning overlay ("Desktop required")
- "Summary unavailable" on Anthropic failures
- Loading states and empty states everywhere
- 175 tests passing

**Pending (Mo's production tasks):**
- Cloudflare domain → Vercel
- Vercel env vars confirmed in production
- Manual run-through of all features
- Verify cron fires and appears in sync_log

---

## Legacy Architecture Notes

The original time-based staleness model (M3–M8) fired `stage_stale` when a deal was stuck in a stage for N business days. Settings keys `stage_stale_*` drove this for 6 active outreach stages. This model was correct for Pipeline 3 (Case Management) but was a misleading proxy for Pipelines 1 and 2, where action counts and data completeness are the real health signals. The three-pipeline architecture introduced in M9+ replaces these rules for Pipelines 1 and 2.
