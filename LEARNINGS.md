# LEARNINGS.md

This document is a rolling log of mistakes, surprises, and decisions made during the build. It is meant to be kept current — delete stale entries, rewrite freely. At the start of each sprint, review and prune. The goal is a short, high-signal list that prevents repeating mistakes.

---

## How to Use

- Add an entry any time something was wrong, surprising, or decided differently than the docs say.
- Tag each entry with the milestone it came from.
- Delete entries that are no longer relevant or have been fixed in the docs.
- Keep it short. If it's longer than one screen, prune it.

---

## Pre-Build Knowns (before M0)

### [PRE] HubSpot field names are unknown — do not code them in

All custom HubSpot property names (address, county, parcel ID, phone variants, is_deceased, etc.) are unknown until M1. mapper.ts must not be written until `docs/research/field-mapping.md` is filled in. Stage comparisons must go through `stageMap`, never raw strings.

### [PRE] Vercel Hobby plan: once-per-day cron only

Hobby plan limits cron to once per day, ±59 min precision. 4x daily sync requires **Pro plan ($20/mo)**. During development on Hobby: use `"0 14 * * 1-5"` (once daily). Mo manually triggers Layer 1 sync from the dashboard for additional refreshes. Upgrade to Pro before going to production if 4x daily is needed. Pro timeout: 300s (not 10s).

### [PRE] Vercel cron schedule is static

The sync schedule lives in `vercel.json` and cannot be changed at runtime. The Settings page must NOT expose this as a configurable field.

### [PRE] Prisma + Neon: use pooled URL + direct URL

Neon provides two connection strings. Use both:
- `DATABASE_URL` = pooled (PgBouncer) URL — used by the app
- `DIRECT_URL` = direct URL — used by `prisma migrate` only

Set both in `prisma/schema.prisma` datasource (`url` + `directUrl`). Do NOT use `?connection_limit=1` — Neon's pooler handles pooling. Still use the singleton pattern in `src/lib/db/client.ts`.

### [PRE] Prisma client must be a singleton in serverless

Each Vercel function invocation is cold. Without a singleton, each request opens a new DB connection → pool exhaustion. Singleton pattern using `globalThis` is required in `src/lib/db/client.ts`.

### [PRE] stageMap and ownerMap must be loaded from DB, not JSON files at startup

There is no persistent startup in serverless. Seed `stageMap`/`ownerMap` into `app_settings` after M1. Load from DB per sync invocation. Cache in invocation scope only.

### [PRE] Daily API call counter must use DB, not in-memory state

Serverless invocations don't share memory. 75,000/day cap is tracked by summing `sync_log.api_calls_made` for today. Not a process-level variable.

### [PRE] Layer 2 attention rules cannot run in M3

Two rules require Layer 2 data (not available until M4):
- "Mo Action Required" — needs email direction from `deal_activities`
- "Missing Contact Info" — needs phone data from `deal_contacts`

M3 = Layer 1-only rules only.

### [PRE] Employee activity stats in Daily Briefing have no DB backing

Do not include `Marwa: X notes, Y calls` in the M5 briefing prompt until `deal_activities` exists and has data. Add it in M5 with a conditional query by owner.

### [PRE] Test framework is Vitest, not Jest

Vitest is ESM-native, faster, works with App Router without pain. Correct install:
```
npm install -D vitest @vitejs/plugin-react jsdom @testing-library/react @testing-library/dom vite-tsconfig-paths @vitest/coverage-v8
```
Config file: `vitest.config.mts`. Run with `npm test`.

### [PRE] M1 JSON files are the test fixtures for the mapper

Never call real HubSpot in unit tests. Load `docs/research/*.json` with `fs.readFileSync`.

### [PRE] `.env.example` must be created in M2a

List all required env vars without values. Required vars: `DATABASE_URL`, `DIRECT_URL`, `HUBSPOT_ACCESS_TOKEN`, `DASHBOARD_PASSWORD`, `ANTHROPIC_API_KEY`.

### [PRE] HubSpot auth: use Service Keys, not Private Apps

HubSpot deprecated Private Apps → moved to Legacy Apps → now recommending Service Keys (public beta Feb 2026). Create at: Developer portal → Keys → Service Keys. Use as Bearer token identically to old private app tokens.

### [PRE] Future automation (write capabilities) must go through a single boundary

Any future system that writes to HubSpot (creates notes, moves stages, creates deals/contacts) must ONLY do so through `src/lib/hubspot/actions.ts`. This file does not exist yet. Creating it requires Mo's explicit approval. Phase 1 is strictly read-only.

The three automation boundaries in the architecture:
1. **Read** — `client.ts` (exists)
2. **Write** — `actions.ts` (does not exist — future)
3. **Approval** — `internal_tasks.source = 'ai_detected'` (M6)

Do not build around these. Do not create write infrastructure speculatively.

### [PRE] HubSpot Service Keys scope UI may not show all scope strings

Confirmed available in UI: `crm.objects.deals.read`, `crm.objects.contacts.read`, `crm.schemas.*.read`, `sales-email-read`. Scopes for notes/calls/tasks may not appear — they may be covered implicitly or not yet exposed in the beta UI. Test what endpoints are accessible after getting the token; if a 403 appears, add scopes.

---

---

## M1 Discoveries (2026-06-06)

### [M1] Pipeline name is wrong in all docs

Pipeline is **"Cases – Surplus Funds"** (ID: `2172337854`), not "KSR Plus Funds". All doc references updated.

### [M1] 16 pipeline stages, not 9

Six previously unknown stages: More Research Need, F (unknown meaning — ask Mo), DNC, Blocked Missing Info, Exhausted, Letter Outreach - Final Attempt. Closed states: Dead / Not Interested, DNC, Blocked Missing Info, Exhausted. Stage IDs are in `pipeline-stages.json` and `field-mapping.md`.

### [M1] Field name corrections

- `properties_address` not `address` or `property_address`
- `parcel_id__deal` not `parcel_id` (double underscore + `_deal`)
- `phone_numbers__excess_elite` not `xs_elite`
- `phone_numbers__beenverified_fastpeople_etc` (not a guessed short name)

### [M1] Use `hs_v2_date_entered_current_stage` for staleness, not `notes_last_updated`

`hs_v2_date_entered_current_stage` tells us when the deal entered its current stage — the correct basis for "this deal has been stuck in Attempted Contact for 14 days". `notes_last_updated` = last activity date, useful but different metric. Both available in Layer 1.

### [M1] Notes are HTML-formatted

`hs_note_body` returns HTML div/p tags. Must strip HTML before sending to AI or displaying as text. Use a simple HTML stripper in the mapper or a dedicated utility.

### [M1] Deal owner field is noise

Marwa (Modelo) does all data entry — deal `hubspot_owner_id` is almost always her ID and does NOT indicate who is working the case. Use engagement-level `hubspot_owner_id` (on notes, emails, calls) to track who added activity. This IS meaningful for employee activity stats.

### [M1] Email direction: observed value is "EMAIL", not "INCOMING_EMAIL"

Sample email had `hs_email_direction: "EMAIL"`. Docs assumed `INCOMING_EMAIL | OUTGOING_EMAIL`. Confirm all possible values with more samples — do not branch on this field until confirmed.

### [M1] Phone data quality issue observed

Idella Grant has a date value "02/06/2024" in a phone field. Mapper must validate phone format (digits + allowed chars) before including in `phoneNumbers[]`. Do not strip aggressively — just reject obviously non-phone values.

### [M1] Schema drift management — deferred to future (Option B)

Current protection: `raw_payload` stores everything, mapper is the only file with property names, every read uses `?? null`. Prevents crashes but allows silent drift. Full schema registry deferred — see README.md Future Work.

### [M1] Calls endpoint not tested — sample deal had 0 calls

Cannot confirm call field names from sample. Before coding call support in M4, find a deal with calls and verify `hs_call_body`, `hs_call_direction`, `hs_call_disposition`.

---

---

## M1 Extended Research (2026-06-07) — 6-deal multi-stage sample

### [M1-EXT] `estimated_surplus` is NEVER populated — use `amount`

Checked across all 150 deals: `estimated_surplus` = null in 100% of cases. `amount` is populated for 100% of deals and matches the dollar value in deal names (e.g., "$36K" in name = 35,848.41 in `amount`). Mo stated "estimated_surplus is what matters" but the live data shows it is unused. **Use `amount` as the primary display field.** Keep `estimated_surplus` in the schema (it's in HubSpot schema) but map it as an optional field — it may be populated in future.

### [M1-EXT] County is an enumeration, not free text

25 Georgia counties + "Other". Deals outside those counties (e.g., Hillsborough, FL) get `county = "Other"`. Cannot derive actual county from this field when value is "Other" — use address string or deal name instead.

### [M1-EXT] `state` field is always null — state embedded in address

`state` field returns null across all samples. State is encoded in `properties_address` (e.g., "11916 Rhodine Rd Riverview, FL 33579") and in the deal name. Do not rely on a `state` field.

### [M1-EXT] Layer 2 API call count — confirmed from real data

**Formula per deal (on-demand "Load Full Detail"):**
- Always: 5 association calls (contacts, notes, emails, calls, tasks)
- Plus: 1 batch read call per engagement type with > 0 results
- Range: **5 minimum** (all empty) to **10 maximum** (all types have data)
- Measured: 7 calls (New Case, 6 contacts + 1 note) and 9 calls (Attempted Contact, 3 contacts + 9 notes + 1 email + 12 tasks)

**Layer 1 sync (all 150 deals at once):**
- 2 API calls (150 deals ÷ 100 per page = 2 pages)
- 4× daily cron = 8 calls/day for Layer 1

**Worst-case daily budget if Mo pulls Layer 2 on every deal:**
- 150 × 9 = 1,350 Layer 2 calls + 8 Layer 1 = 1,358 calls/day
- 1,358 ÷ 75,000 cap = **1.8%** — rate limiting is not a concern at current deal volume

### [M1-EXT] Call attempts logged as Tasks, not Calls engagement

Across 2 deals tested, `calls` engagement count = 0. The same deals had 12 `tasks` of type `CALL` (`hs_task_type = CALL`). Horizon tracks call attempts as HubSpot Tasks, not Calls engagements. Before building Layer 2 call display in M4, confirm whether any deals have actual Calls engagements (record + play back). The tasks endpoint is the primary source for call attempt data.

### [M1-EXT] Deal stage distribution (150 total deals, 2026-06-07)

Active stages (~26 deals): Attempted Contact (10), More Research Need (7), Follow-Up Needed (3), Contact Made (2), Signed/In Progress (2), Ready for Outreach (1), Engaged/Interested (1), New Case (3 — in page 2), Agreement Sent (0).

Terminal/inactive (~124 deals): Dead/Not Interested (24+), Letter Outreach-Final (21+), Exhausted (16+), Blocked Missing Info (6+), DNC (5+), Closed-Paid (2+).

About 82% of deals are in terminal stages. Dashboard staleness rules should only fire on active stages.

### [M1-EXT] Email direction confirmed as "EMAIL" (not INCOMING/OUTGOING)

Second sample confirmed: `hs_email_direction = "EMAIL"`. Not `INCOMING_EMAIL` or `OUTGOING_EMAIL`. Do not write rules that branch on incoming vs outgoing until more values are observed.

---

---

## M2 Discoveries (2026-06-06)

### [M2] Next.js 16: middleware.ts renamed to proxy.ts

Next.js 16 renamed `middleware.ts` → `proxy.ts`. The exported function is now named `proxy` (not `middleware`). The API is identical (NextRequest, NextResponse, config.matcher). The old file name still works but logs a deprecation warning.

### [M2] Prisma 7: connection URLs no longer in schema.prisma

Prisma 7 removed `url` and `directUrl` from the datasource block in `schema.prisma`. They now live in `prisma.config.ts`:
- `prisma.config.ts` → `datasource.url = DIRECT_URL` (used by Prisma CLI for migrations)
- `PrismaClient` → initialized with `@prisma/adapter-pg` using `DATABASE_URL` (pooled)

```typescript
// prisma.config.ts
import { defineConfig } from 'prisma/config'
export default defineConfig({
  schema: 'prisma/schema.prisma',
  datasource: { url: process.env.DIRECT_URL ?? '' },
})

// src/lib/db/client.ts
import { PrismaPg } from '@prisma/adapter-pg'
const adapter = new PrismaPg({ connectionString: process.env.DATABASE_URL! })
const prisma = new PrismaClient({ adapter })
```

For CLI commands (`prisma migrate dev`), env vars come from `.env.local` via `dotenv-cli`:
```
npm run db:migrate  # = dotenv -e .env.local -- prisma migrate dev
npm run db:push     # = dotenv -e .env.local -- prisma db push
```

### [M2] schema.prisma datasource with no url

With Prisma 7, `schema.prisma` datasource only needs `provider`:
```prisma
datasource db {
  provider = "postgresql"
}
```
No `url`, no `directUrl`. The connection config lives entirely in `prisma.config.ts`.

---

## Sprint Log

*(Add entries here as you build. Format: `[Mxn] What happened → What was decided`)*

[M0] HubSpot Private Apps UI was deprecated → used Service Keys instead. Token scope UI in beta — not all expected scope strings visible. Added what was available; will test coverage in M1.

[M1] Pipeline name corrected: "Cases – Surplus Funds" not "KSR Plus Funds". 16 stages confirmed (not 9). All field names verified against live API. Field mapping doc written. Owner field confirmed as noise (Marwa = data entry). HTML notes confirmed. Stage staleness: use `hs_v2_date_entered_current_stage`.

[M1-EXT] 6-deal multi-stage sample pulled. Major corrections: `estimated_surplus` never populated → use `amount`. County is an enum (25 GA counties + Other). State field always null. Layer 2 costs 7–9 API calls/deal; worst-case 150 deals = 1,358 calls/day = 1.8% of cap. Call attempts are Tasks (type=CALL), not Calls engagements. ~82% of deals in terminal stages.

[M2a] Project skeleton built. Two framework breaking changes hit: Next.js 16 uses proxy.ts (not middleware.ts), Prisma 7 uses prisma.config.ts + driver adapter (not url in schema.prisma). Both fixed and documented above.
