# CLAUDE.md — Horizon Recovery Operations Dashboard

## Module Map — Quick Reference

| Path | Entry points |
|------|-------------|
| `src/lib/db/` | All DB. No Prisma outside here. |
| `src/lib/db/deals.ts` | `getDealsForQueue`, `getDealById`, `upsertDeals` |
| `src/lib/db/activities.ts` | `getEmployeeActivitySummary`, `replaceLayer2Data` |
| `src/lib/db/activity-events.ts` | `getActivityEvents`, `upsertActivityEvent` |
| `src/lib/db/phone-numbers.ts` | `lookupDealByPhone`, `upsertPhoneNumber`, `populateFromDealContacts` |
| `src/lib/db/tasks.ts` | `getOpenTasks`, `createTask`, `closeTask` |
| `src/lib/db/settings.ts` | `loadStageMap`, `loadOwnerMap`, `loadStaleThresholds`, `PIPELINE_GROUP` |
| `src/lib/db/transaction.ts` | `withTransaction`, `withBatchTransaction` |
| `src/lib/db/analytics.ts` | `getPortfolioAnalytics`, `getDealEnrichedById` |
| `src/lib/db/pipeline-stats.ts` | `computePipelineStats`, `getWeeklyCallStats` |
| `src/lib/db/contact-quality.ts` | contact quality queries |
| `src/lib/db/outreach.ts` | outreach matrix builder |
| `src/lib/db/call-transcripts.ts` | transcript queries, upsert |
| `src/lib/db/snoozes.ts` | snooze reads/writes |
| `src/lib/db/summaries.ts` | AI summary reads/writes |
| `src/lib/hubspot/client.ts` | HubSpot API — rate limited, retried, HubSpotError |
| `src/lib/hubspot/mapper.ts` | ONLY file knowing raw HubSpot property names |
| `src/lib/sync/layer1.ts` | Daily deal list sync (2 API calls, 150 deals); manual anytime |
| `src/lib/sync/layer2.ts` | On-demand full detail sync (5–50+ calls, manual only) |
| `src/lib/integrations/phone-provider.ts` | `PhoneProvider` interface + `NormalizedCallLog` type |
| `src/lib/integrations/justcall/client.ts` | JustCall API — 18 req/min cap, JustCallError |
| `src/lib/integrations/justcall/sync.ts` | `syncJustCallSample()`, `syncJustCallFull(since)` |
| `src/lib/integrations/justcall/normalize.ts` | E.164 normalization + NormalizedCallLog conversion |
| `src/lib/integrations/google/client.ts` | Google API client — Gmail + Drive |
| `src/lib/integrations/google/sync.ts` | `syncGmailSample()`, `syncGmailFull()` |
| `src/lib/integrations/google/drive-index.ts` | `indexDriveFolder` |
| `src/lib/integrations/google/doc-classifier.ts` | document classification |
| `src/lib/integrations/call-classifier/` | `processCall`, `batchProcessCalls` — Whisper + Claude pipeline |
| `src/lib/integrations/hubspot-browser/` | HubSpot Drive file linking validation via browser |
| `src/lib/browser/client.ts` | Playwright browser client |
| `src/lib/browser/screenshot.ts` | screenshot capture utility |
| `src/lib/case/` | Business object layer — view models only, no DB writes |
| `src/lib/case/types.ts` | `CaseEvent`, `StoryDay`, `CurrentState`, `CaseEventCategory` types |
| `src/lib/case/classifier.ts` | `categorizeEvent()` — 7 categories, priority-ordered, pure function |
| `src/lib/case/events.ts` | `buildCaseEvents()` — merges DealActivity + ActivityEvent into CaseEvent[] |
| `src/lib/case/story.ts` | `buildStoryDays()` — ET-timezone day grouping; `CATEGORY_LABELS` map |
| `src/lib/case/state.ts` | `buildCurrentState()` — health inference from AiSummary JSON |
| `src/lib/rules/` | Pure rule functions. `index.ts` → `evaluateAll`. |
| `src/lib/rules/staleness.ts` | `checkStaleness` — stage stale by business days |
| `src/lib/rules/agreement.ts` | `checkAgreement` — Agreement Sent no follow-up |
| `src/lib/rules/signed.ts` | `checkSigned` — Signed/In Progress no activity |
| `src/lib/rules/contacts.ts` | `checkContacts` — missing contact info |
| `src/lib/rules/calls-exhausted.ts` | `checkCallsExhausted` — 7+ unique call days |
| `src/lib/rules/snooze.ts` | snooze check — runs first, short-circuits all other rules |
| `src/lib/rules/ctx.ts` | `buildRuleCtx()` — assembles RuleContext |
| `src/lib/ai/client.ts` | Anthropic SDK singleton. `callClaude`, `callClaudeStreaming`. |
| `src/lib/ai/briefing.ts` | Morning briefing stream |
| `src/lib/ai/generate.ts` | Per-deal AI summary |
| `src/lib/errors.ts` | `IntegrationError` base + `HubSpotError`, `JustCallError`, `GoogleError` |
| `src/lib/ai/errors.ts` | `AIError` (separate hierarchy) |
| `src/lib/utils/format.ts` | `formatAmount`, `relativeDate`, `formatDate` |
| `src/lib/utils/business-days.ts` | `businessDaysElapsed` — always America/New_York |
| `src/lib/utils/rate-limiter.ts` | `TokenBucket` — in-memory, replace before AWS |
| `src/lib/utils/pipeline-group.ts` | `getPipelineGroup()` — stage ID → setup/outreach/case_mgmt/terminal |
| `src/app/api/` | Next.js route handlers — thin only |
| `src/app/dashboard/pipeline/` | Portfolio analytics page |
| `src/app/dashboard/contacts/` | Contact quality page |
| `src/components/DealSearch.tsx` | global deal search |
| `src/components/analytics/` | DealBadges, SegmentBar, StatCard |
| `src/proxy.ts` | Next.js 16 Middleware (was middleware.ts) |

---

## What This Is
Owner-attention layer on top of HubSpot CRM for Horizon Recovery LLC. Answers: "What needs Mo's attention right now?" Read-only. Single user (Mo). Shared password auth. See `SYSTEM_OVERVIEW.md` for full architecture and `DOMAIN_MODEL.md` for business object definitions.

---

## Doc Map

| File | Contains |
|---|---|
| `SYSTEM_OVERVIEW.md` | Architecture, systems, sources of truth, Hermes boundaries |
| `CURRENT_STATE.md` | What's running, what's deferred, active priorities |
| `docs/DOMAIN_MODEL.md` | Business object definitions — Deal, Contact, StoryDay, etc. |
| `docs/design-doc.md` | Technical architecture, DB schema, rate limiter, API routes |
| `docs/product-roadmap.md` | P1/P2/P3 priority backlog |
| `docs/business-context.md` | Business domain, pipeline stages, deal health rules |
| `docs/api-reference.md` | API inputs/outputs — read before writing any API call code |
| `docs/research/field-mapping.md` | Confirmed HubSpot property name → internal field mapping |
| `docs/research/pipeline-stages.json` | Pipeline ID and all stage ID → name mappings |
| `docs/archive/` | Historical milestone checklists (M0–M13 complete) |

---

## Web Search Rule — Run Before Assuming

Before acting on any platform-specific detail, run a web search to verify it is still current:

| Topic | What to verify |
|---|---|
| HubSpot API scopes/endpoints/rate limits | Starter plan: 100 req/10s, 250,000 req/day |
| JustCall API | Endpoint paths, auth format, rate limits per plan tier |
| Google Workspace API | Gmail/Calendar API endpoints, OAuth scopes, quota limits |
| Vercel plan limits | Cron frequency, function timeout (Hobby vs Pro) |
| Next.js version | Current stable version, create-next-app flags |
| Prisma + Neon | Connection string pattern, adapter availability |
| Anthropic SDK | Current package name, model IDs |

When you search: mark what you confirmed, what you couldn't confirm, and what contradicts the docs. Add a `docs/LEARNINGS.md` entry for anything surprising.

---

## Stop and Wait for Mo When

- A required credential is missing (`HUBSPOT_ACCESS_TOKEN`, `ANTHROPIC_API_KEY`, `DATABASE_URL`)
- Tests fail and root cause is unclear after one fix attempt
- HubSpot returns a data shape not documented in `docs/api-reference.md`
- A decision is needed that docs do not cover
- About to make a destructive or hard-to-reverse change (schema drop, file delete, etc.)
- Approaching rate limit (daily call count > 60,000)
- **About to add any HubSpot write capability.** Permanently read-only. Write capabilities belong in `src/lib/hubspot/actions.ts` which does not exist — creating it requires Mo's explicit approval.

---

## Never Assume

| What | Source of truth |
|---|---|
| HubSpot property names | `docs/research/field-mapping.md` |
| Stage names / IDs | `docs/research/pipeline-stages.json` — never compare against raw string names |
| Phone field names | `docs/research/contact-properties.json` |
| Total deal count | Query HubSpot, do not hardcode |
| API response shape | `docs/api-reference.md` — never guess what a field contains |
| Business hours / timezone | America/New_York |

---

## Key Constants

```
Pipeline name:     Cases – Surplus Funds (pipeline ID from pipeline-stages.json)
Total deals:       150 (2 pages of 100 in CRM search)
Timezone:          America/New_York
Tests:             606 passing

--- HubSpot ---
HubSpot plan:      Starter — 100 req/10s, 250,000 req/day
HubSpot cap:       30% = 3 req/s max, 75,000 req/day max, warn at 60,000
Daily warn:        If sync_log daily call count > 60,000, stop auto syncs, allow manual only
Layer 1 sync:      2 API calls for all 150 deals (2 pages)
Layer 2 per deal:  7–9 API calls (5 association + 1 batch per non-empty type)
Surplus field:     amount (NOT estimated_surplus — confirmed null on 100% of deals)

--- JustCall ---
JustCall API:      https://api.justcall.io/v2.1
JustCall auth:     Authorization: <api_key>:<api_secret> header
JustCall burst:    60 req/min → 30% cap = 18 req/min
JustCall hourly:   3600 req/hr → 30% cap = 1,080 req/hr
JustCall sample:   Last 72h — re-run anytime via Settings
JustCall full:     Last 90 days on first run; since last_synced_at thereafter
Phone format:      E.164 (e.g., +14045551234) — normalize all numbers before storing

--- Google ---
Google sample:     Last 7 days, max 50 emails — re-run anytime via Settings
Google full:       Last 90 days on first run; since last_synced_at thereafter
                   Full sync available in Settings after reviewing sample

--- AI ---
AI model:          claude-sonnet-4-6
AI lookback:       28 days of activity history per summary

--- Schema ---
CallTranscript:    one per ActivityEvent with recording; classification: live|voicemail|disconnected|unknown|error

--- Architecture ---
Staleness source:  app_settings table
Pipeline groups:   setup | outreach | case_mgmt | terminal (see PIPELINE_GROUP in settings.ts)
JustCall key:      .env.local only — never in code or git
```

---

## Prisma 7 — Breaking Changes

Always import `prisma` from `/src/lib/db/client.ts`. Never instantiate `PrismaClient` directly anywhere else.

- `prisma/schema.prisma` datasource has NO `url` or `directUrl` — only `provider = "postgresql"`
- `prisma.config.ts` (project root) — configures Prisma CLI using `DIRECT_URL`
- `src/lib/db/client.ts` — instantiates `PrismaClient` with `@prisma/adapter-pg` using `DATABASE_URL` (pooled)

```
npm run db:migrate    # = dotenv -e .env.local -- prisma migrate dev
npm run db:push       # = dotenv -e .env.local -- prisma db push
npm run db:generate   # = prisma generate
```

## Next.js 16 — Breaking Changes

- File is `src/proxy.ts` (not `src/middleware.ts`)
- Exported function is `proxy` (not `middleware`)

## stageMap and ownerMap

Loaded from `app_settings`. Load once per sync invocation and pass to mapper. Never hardcode stage names. Never compare `deal.stage` against a raw string — always use `stageMap[deal.stage]`.

## Staleness Rules — Two Separate Signals

`stage_entered_at` (→ `hs_v2_date_entered_current_stage`) = how long deal has been in current stage → use for **Stage Stale** rule.

`last_activity_date` (→ `notes_last_updated`) = when anything last happened → use for **No Recent Activity** rules (Agreement Sent, Signed/In Progress).

Never use `last_activity_date` for Stage Stale. Never fire staleness rules on terminal stages.

## Test Framework — Vitest

Use Vitest, not Jest. Config in `vitest.config.mts`. Run with `npm test`.

Test fixtures for mapper tests: load `docs/research/sample-deal.json` with `fs.readFileSync`. Never call real HubSpot in unit tests.

## Rate Limiting — Enforced Rule

ALL HubSpot API calls MUST go through `/src/lib/hubspot/client.ts`. Never call the HubSpot API directly anywhere else. The client enforces a token bucket at 3 req/s. Daily call count is read from `sync_log` (not in-memory).

## Error Handling Rule

- HubSpot 429: handled in client.ts (backoff + retry)
- HubSpot 5xx: throw `HubSpotError` — caller shows stale data banner, does not crash
- Anthropic error: throw `AIError` — UI shows "Summary unavailable"
- Partial sync: log to sync_log with deals_synced count, do not throw

## Sync Schedule

The cron schedule lives in `vercel.json`. It is static and cannot be changed at runtime. Do not add sync schedule to the settings UI.

## Layer 2 Rule

Layer 2 is NEVER pulled automatically. Only triggered by Mo clicking "Load Full Detail" in the UI. Show static range "5–50+ API calls depending on deal activity" before pulling.

## AI Rule

AI summaries are NEVER auto-generated. Manual button only. No scheduled regeneration.

## Git Commit Rules

- Run `npm test` before every commit — never commit if tests fail
- Never commit `.env.local` or any secrets
- `docs/research/` is in `.gitignore` (raw JSON contains real deal data)

## DB Rules

- Schema: `prisma/schema.prisma`
- Every table has a `raw_payload JSONB` column
- After any schema change: `npm run db:migrate`
- Use a singleton Prisma client (import from `src/lib/db/client.ts`)
- All `$transaction` calls go through `withTransaction()` or `withBatchTransaction()` in `src/lib/db/transaction.ts`

## Rules Engine Architecture

Each attention rule (`/src/lib/rules/*.ts`) is a pure function:
```typescript
type Rule = (deal: NormalizedDeal, ctx: RuleContext) => AttentionFlag | null
```
- No rule file imports from `@prisma/client` or `src/lib/db/`
- Adding a rule = new file + one line in `rules/index.ts`

`NormalizedDeal` has `amount: number` (never Prisma Decimal — converted in `db/deals.ts`)
`snoozedDealIds` is preloaded once per request as a Set — never query DB per deal

## Business Days — Timezone Rule

`business-days.ts` MUST convert timestamps to `America/New_York` before counting business days. `stageEnteredAt` is stored as UTC — counting in UTC gives wrong results at timezone boundaries.

## JSON Serialization — Safe Cast Rule

```typescript
// Wrong — bare cast hides runtime serialization errors:
return v as Prisma.InputJsonValue

// Right — surfaces non-serializable content immediately:
return JSON.parse(JSON.stringify(v)) as Prisma.InputJsonValue
```

## Mapper Contract

`/src/lib/hubspot/mapper.ts` is the only file that knows raw HubSpot property names. Every property read must use `?? null` — never assume a key exists in the HubSpot response.

## Prisma Decimal — DB Read Rule

`amount` and `estimatedSurplus` are `Decimal` objects when read from DB. Always call `.toNumber()` before comparisons, or use `db/deals.ts` which handles conversion.

## Service Layer — Three Enforced Boundaries

**Boundary 1 — DB:** All DB reads/writes go through `src/lib/db/` functions. No direct `prisma` imports outside `src/lib/db/`. All `$transaction` calls go through `withTransaction()` / `withBatchTransaction()`.

**Boundary 2 — External APIs:** All HubSpot calls through `src/lib/hubspot/client.ts`. All Anthropic calls through `src/lib/ai/client.ts`. New integrations go in `src/lib/integrations/<service-name>/` — one `request()` method, per-service TokenBucket, service-specific error class.

**Boundary 3 — Errors:** `src/lib/errors.ts` for IntegrationError hierarchy. `src/lib/ai/errors.ts` for AIError. Never import AIError from errors.ts.

**AWS gate:** `TokenBucket` is in-memory and per-invocation — correct for Vercel serverless. Before AWS multi-instance: replace with DB-backed leaky bucket.
