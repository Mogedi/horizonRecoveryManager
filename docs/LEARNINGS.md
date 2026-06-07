# LEARNINGS.md — Confirmed Facts and Surprises

Entries added as we discover things that contradict assumptions or are non-obvious. These should update the main docs too — LEARNINGS.md is the changelog for the docs.

---

## M1: HubSpot Research

**`estimated_surplus` is null on 100% of deals.**
`amount` is the real value and always populated. Matches the dollar figure in the deal name. Do not display `estimated_surplus`. Store it in DB for future use, but do not surface it in UI.

**Call attempts are logged as Tasks, not Calls engagements.**
The JustCall integration logs outbound call attempts as Task objects with `hs_task_body = null` and `hs_task_subject = "Follow Up Call"`. There are actual Call objects too (from completed calls), but a "no answer" attempt generates a Task, not a Call. Don't assume Task count = only scheduled tasks.

**~82% of deals are in terminal stages.**
Of 150 deals: ~17-18 in active stages, ~125 in terminal. The attention queue will only ever show 18-30 deals max. Build for that scale, not 150.

**`county` is an enumeration, `state` is always null.**
County is a dropdown with 25 GA counties + "Other". Deals outside those counties get "Other". The `state` field is always null — state info is embedded in the `properties_address` string (e.g., "Savannah, GA 31405").

**`hubspot_url` comes from `raw.url`, not constructed.**
The deal object has a `url` field at the top level of the API response. Use `raw.url` directly. The design doc's note about constructing it as `https://app.hubspot.com/contacts/{portalId}/deal/{hubspot_id}` is wrong — real URLs are `https://app-na2.hubspot.com/...`. Field confirmed in mapper.ts.

**`hs_v2_date_entered_current_stage` is the right staleness field.**
The older `hs_date_entered_dealstage` field is always null. Always use `hs_v2_date_entered_current_stage` for "how long in current stage" calculations.

**Note bodies are HTML.** `hs_note_body` returns HTML with `<div>`, `<p>`, `<strong>` tags. Always strip HTML before storing or displaying.

**Phone field `phone` contains dates.** Idella Grant's `phone` field contains `"02/06/2024"`. Validation must reject values that don't have 10+ digit characters, not just non-empty strings. All valid US phones in the data are 10–11 digits.

---

## M2: Database + Sync Engine

**Prisma 7 removed `url`/`directUrl` from `schema.prisma`.**
Use `prisma.config.ts` (CLI config, uses DIRECT_URL) and `@prisma/adapter-pg` (app runtime, uses DATABASE_URL pooled). Never instantiate PrismaClient directly — always import from `src/lib/db/client.ts`.

**Next.js 16 renamed Middleware to Proxy.**
File is `src/proxy.ts`. Exported function is `proxy`, not `middleware`. Config and API identical.

**N+1 upsert in layer1.ts is a known architectural debt.**
The current Layer 1 sync does `prisma.deal.upsert()` per deal in a for-loop — 150 DB round-trips on a full refresh. Acceptable for smart sync (5-10 changed deals). Must fix before full syncs become painful. Solution: `prisma.$executeRaw` with `INSERT ... ON CONFLICT DO UPDATE` to batch all 150 in one query. Deferred until it becomes a real problem.

**`asJson` bare cast is a correctness gap.**
`return v as Prisma.InputJsonValue` compiles but lies. If payload contains non-serializable values (Date nested in object, class instance, undefined), Prisma fails cryptically at DB write time. Correct pattern: `JSON.parse(JSON.stringify(v))` before cast. Should fix before shipping.

**Prisma `Decimal` type is not JavaScript `number`.**
`amount` and `estimatedSurplus` are stored as `Decimal @db.Decimal(12,2)`. When read from DB, Prisma returns a `Decimal` object (from `decimal.js`), not a plain number. Rules that read deals from DB must call `.toNumber()` on Decimal fields, or use a DB normalizer layer that converts before returning. The mapper correctly stores `number | null` from HubSpot strings — the mismatch only appears when reading back from DB.

**`estimateLayer2Calls()` returns a made-up number.**
The function returned `5 + contactBatch + 5` — the last 5 was a guess. Real Layer 2 cost for a deal with 50 notes and 30 calls is 85+ API calls. Removed. Show static range "5–50+ API calls" in UI. After first Layer 2 sync, show actual count from sync_log.

**`_stageMap` parameter in `mapDeal` was misleading.**
The mapper accepted stageMap but never used it. Stage IDs are stored as-is; names are resolved at display time. Passing stageMap to mapDeal implied it transforms stage — it doesn't. Parameter removed.

**Vercel Cron sends `Authorization: Bearer <CRON_SECRET>` — not `x-vercel-cron-signature`.**
The previous code checked `x-vercel-cron-signature` presence (wrong header) and treated any non-null value as authorized (not verified). Correct check: `request.headers.get('authorization') === \`Bearer ${process.env.CRON_SECRET}\``. Set `CRON_SECRET` as a Vercel environment variable with a random 16+ char string. Fixed in M3 when adding cookie-based auth for the dashboard Sync Now button.

**Dashboard sync button must use cookie auth, not password header.**
The browser cannot safely read `DASHBOARD_PASSWORD` from env vars. Solution: the proxy already validates the `horizon_auth=1` cookie for all `/api/*` requests. Route handlers can additionally check `cookies().get('horizon_auth')?.value === '1'` via `next/headers`. Cron uses Bearer token; browser uses cookie; direct API calls can still use `x-dashboard-token` header.

**Layer 2 has no concurrency protection.**
Double-click "Load Full Detail" within 1 second creates two concurrent delete+reinsert transactions. One will corrupt the other's work. Acceptable risk for single-user tool. Fix if multiple users are ever added.

---

## Rules Engine Architecture (M3 Design Decision)

**Rules must be pure functions. No DB calls inside rules.**
Each rule: `(deal: NormalizedDeal, ctx: RuleContext) => AttentionFlag | null`. All DB loading (deals, active snoozes) happens in `db/deals.ts` before rules run. Rules are testable without any DB or mocking.

**RuleContext makes thresholds injectable.**
Thresholds live in `thresholds.ts` (M3) and eventually `app_settings` (M7). By passing them as `ctx.staleThresholds`, the rules never import thresholds directly. Swapping the source (hardcoded → DB) means only one call site changes.

**Snooze lookup must be pre-loaded as a Set.**
If each rule queries the DB for snooze status, 150 deals = 150+ DB queries. Load all active snoozes once in `db/deals.ts`, pass as `Set<string>` in context.

**Business days must be counted in `America/New_York`.**
`stageEnteredAt` is stored as UTC. A deal entered a stage at 11pm ET Friday = Saturday UTC. Business-day counting in UTC gives wrong results. `business-days.ts` must convert to `America/New_York` before counting. Use `Intl.DateTimeFormat` or `date-fns-tz`.

**`rawPayload` is the escape hatch for future fields.**
Normalized columns exist only for the ~12 fields that drive rules or sort order. Any future rule that needs a field not yet normalized can read from `rawPayload` — no migration needed. The rule is: if it drives a rule or query, normalize it; otherwise, read from rawPayload.

---

## Feature Priority Learnings

**~18 active deals means the attention queue is small.**
With ~82% terminal deals, the queue shows 18-30 deals at most. Don't over-engineer grouping, pagination, or sorting for 150 items. Simple works.

**Snooze data model ships in M3; snooze UI ships in M4.**
The DB table, the active-snooze preload, and the `snoozed` rule all exist in M3. The button/modal for creating snoozes is in M4 (requires the deal detail panel). This split is intentional — M3 infrastructure supports M4 UI.

**Expired snoozes don't need a separate attention group.**
When a snooze expires, the deal reappears in its normal flag group (Stage Stale, Agreement Sent, etc.). A "Snooze Expired" group adds confusion without adding clarity — Mo still needs to evaluate the deal's actual state. Let expired snoozes dissolve naturally.

**Layer 2 detail panel (M4) is where the real daily workflow happens.**
The M3 attention queue tells Mo what to look at. The M4 panel tells him what's actually going on. Both are necessary for the tool to replace Trello + HubSpot scanning. Don't skip M4 for AI features.

**AI summary (M5) is valuable but has a correct prerequisite order.**
AI needs Layer 2 activity data to generate useful summaries. The sequence rules → detail → AI is not arbitrary — breaking it produces bad summaries (no context). Keep the order.

**Do not build Mo Action Required as a keyword heuristic rule.**
The AI summary already returns `mo_action_required: true/false` as part of its structured output. Keyword heuristics will be wrong, tuned constantly, and duplicate what Claude already does with full context. In M5, surface `mo_action_required` from the AI summary JSON — no `mo-action.ts` rule file.

**Document Checklist deferred indefinitely.**
AI inference of document presence from unstructured notes is complex and error-prone. Mo's team already tracks documents in Google Drive. With ~18 active deals, the cost/benefit doesn't justify building it. If Mo asks for it later, implement then. The `document_checklist` table exists in the schema as a placeholder.

**In-app Product Roadmap page: not worth building.**
The markdown file (`docs/product-roadmap.md`) is the roadmap. An in-app editor to produce a markdown file you feed back to Claude is pure overhead. Edit the file directly or ask Claude to update it.

**Daily Briefing belongs in M6, not M5.**
Per-deal AI summaries are complex enough to be their own milestone. Daily Briefing requires Layer 2 data, cached summaries, and employee activity stats. Shipping both in one milestone increases risk of shipping neither well. Split them.

---

## M4 Retrospective Findings (Post-M4 Audit)

**Layer 2 individual `getObject()` calls are N+1 — use batch reads.**
The original Layer 2 sync fetched each note/task/call/email with a separate API call: `Promise.all(noteIds.map(id => getObject(...)))`. A deal with 30 notes = 30 API calls. HubSpot's batch read endpoint (`POST /crm/v3/objects/{type}/batch/read`) exists for all CRM object types and accepts an array of IDs, returning all objects in one call. Added `batchReadObjects()` to `client.ts` and updated `layer2.ts` to use it. Now a deal with 30 notes, 20 tasks, 10 calls = 3 API calls instead of 60. Same pattern we already used for contacts.

**Layer 2 API calls were invisible to the daily rate limiter.**
`runLayer2Sync` never called `assertDailyLimitOk()` or wrote to `sync_log`. The 75K hard stop and 60K warning only tracked Layer 1 calls. Fixed: added both to `runLayer2Sync`, using sync_type `'layer2_deal'`.

**Agreement.ts and signed.ts bypassed the injectable threshold design.**
These two rules imported constants directly from `thresholds.ts` instead of reading from `ctx`. The `staleness.ts` rule correctly read from `ctx.staleThresholds`. This inconsistency would have required code changes inside rule files when M7 replaces `thresholds.ts` with `app_settings`. Fixed: added `agreementNoFollowupDays` and `signedNoActivityDays` to `RuleContext`. All three rules now import nothing from `thresholds.ts` — M7 is a one-call-site change.

**`getLayer2SyncedAt` returned null if deal had contacts but no activities.**
The function only checked `deal_activities`. A deal with 3 contacts but no notes/calls/emails would show `layer2SyncedAt = null`, causing the panel to show "Load Full Detail" again even after a successful sync. Fixed: now checks both `deal_activities` and `deal_contacts`, returns the later timestamp.

**`propertyAddress` was fetched by the API but never displayed in DealPanel.**
The deal header showed county, parcel, tax sale date but not the street address — the most identifying information. Fixed: added address display line in the panel header.

**Panel showed `Contacts (0)` before Layer 2 was loaded, even when Layer 1 had contact count.**
When `contactCount = 3` but Layer 2 wasn't loaded, the panel header said "Contacts (0)" — misleading. Fixed: show `Contacts (N — load full detail for names)` using Layer 1's contactCount when Layer 2 isn't loaded yet.

**Known gap: DNC-only contacts not flagged.**
The upgraded `contacts.ts` rule checks for valid phone numbers when Layer 2 is loaded. It does NOT check if all contacts have `doNotContact = true`. A deal could have 3 contacts with valid phones but all DNC — rule returns null, but the deal is functionally unreachable. Low frequency, not worth fixing now, but document it. If Mo reports "no contacts to call" on flagged deals, this is why.

---

## M5 Retrospective Findings (Post-M5 Audit)

**Anthropic SDK instantiates at module load time and triggers browser-detection errors in Vitest.**
`new Anthropic({ apiKey })` runs the moment the module is imported. Vitest's jsdom environment looks like a browser, so the SDK throws. Fix: put `AIError` in its own file (`errors.ts`) with no SDK dependency. `summary.ts` (pure parsing) imports from `errors.ts`. `client.ts` (SDK) and `generate.ts` (orchestrator) are never imported by test files — they only pull in `summary.ts` and `prompts.ts`. This isolation pattern is required for any SDK that auto-detects environment. Applies to future integrations (Stripe, Twilio, etc.).

**Prisma upsert returns the full record — don't re-fetch after writing.**
`prisma.aiSummary.upsert()` returns the updated `AiSummary` row including `generatedAt`. The original `generate.ts` called `upsertSummary()` then immediately called `getLatestSummary()` for the timestamp — a wasted round-trip. Fixed: use the upsert return value directly.

**Snooze must always beat AI inference in dashboard grouping.**
The `mo_action_required` dashboard group was overriding the `snoozed` group. A deal Mo explicitly snoozed would reappear as "Mo Action Required" if its AI summary had `mo_action_required: true`. This is wrong — Mo's explicit decision (snooze) must override AI inference. Fixed: check for `snoozed` flag before checking `moActionIds` in the grouping loop.

**JSON prompt templates with example values bias the model.**
`"mo_action_required": true` in the prompt template anchors Claude toward `true`. Use `true or false` (descriptive) as the placeholder, not an actual boolean value. Same principle applies to any future prompt template with boolean or categorical fields.

**`ai_detected` task source was a design fiction.**
M5 shipped with M6 planned to show "Accept / Dismiss" buttons for tasks auto-created by AI. But M5 never created any `ai_detected` rows — and the M5 summary generation correctly doesn't auto-create tasks. The entire `ai_detected` source concept was built on a planned flow that never existed. Cut for M6: all tasks are `manual` source. When Mo generates a summary and sees `mo_action_required: true`, we offer a "Create task" prompt that pre-fills `suggested_next_step` — but all tasks created this way are still manual source.

**Prisma upsert `generatedAt` uses `new Date()` at call time, not DB server time.**
The `upsertSummary` function sets `generatedAt: new Date()` (JavaScript). If the app server and DB server clocks drift by >1 second, staleness comparisons against `lastActivityDate` (which is UTC from HubSpot) could be off. In practice, Neon and Vercel are both AWS us-east-1 and clock drift is negligible. Not worth fixing, but if stale badges appear on fresh summaries, check this first.
