# CLAUDE.md — Horizon Recovery Operations Dashboard

## Module Map — Quick Reference

| Path | Entry points |
|------|-------------|
| `src/lib/db/` | All DB. No Prisma outside here. |
| `src/lib/db/deals.ts` | `getDealsForQueue`, `getDealById`, `upsertDeals` |
| `src/lib/db/activities.ts` | `getEmployeeActivitySummary`, `replaceLayer2Data` |
| `src/lib/db/activity-events.ts` | `getActivityEvents`, `upsertActivityEvent` — multi-source event log (M9+) |
| `src/lib/db/phone-numbers.ts` | `lookupDealByPhone`, `upsertPhoneNumber`, `populateFromDealContacts` (M9+) |
| `src/lib/db/tasks.ts` | `getOpenTasks`, `createTask`, `closeTask` |
| `src/lib/db/settings.ts` | `loadStageMap`, `loadOwnerMap`, `loadStaleThresholds`, `PIPELINE_GROUP` |
| `src/lib/db/transaction.ts` | `withTransaction`, `withBatchTransaction` |
| `src/lib/hubspot/client.ts` | HubSpot API — rate limited, retried, HubSpotError |
| `src/lib/hubspot/mapper.ts` | ONLY file knowing raw HubSpot property names |
| `src/lib/sync/layer1.ts` | Hourly deal list sync (2 API calls, 150 deals) |
| `src/lib/sync/layer2.ts` | On-demand full detail sync (5–50+ calls, manual only) |
| `src/lib/integrations/phone-provider.ts` | `PhoneProvider` interface + `NormalizedCallLog` type (M10+) |
| `src/lib/integrations/justcall/client.ts` | JustCall API — 18 req/min cap, JustCallError (M10+) |
| `src/lib/integrations/justcall/sync.ts` | `syncJustCallSample()`, `syncJustCallFull(since)` (M10+) |
| `src/lib/integrations/justcall/normalize.ts` | E.164 normalization + NormalizedCallLog conversion (M10+) |
| `src/lib/integrations/google/client.ts` | Google API scaffold — awaiting credentials (M13) |
| `src/lib/rules/` | Pure rule functions. `index.ts` → `evaluateAll`. |
| `src/lib/rules/call-cadence.ts` | `checkCallCadence` — outreach pipeline cadence (M11+) |
| `src/lib/rules/calls-exhausted.ts` | `checkCallsExhausted` — 7+ attempts (M11+) |
| `src/lib/rules/setup-readiness.ts` | `checkSetupReadiness` — Pipeline 1 phone check (M11+) |
| `src/lib/ai/client.ts` | Anthropic SDK singleton. `callClaude`, `callClaudeStreaming`. |
| `src/lib/ai/briefing.ts` | Morning briefing stream |
| `src/lib/ai/generate.ts` | Per-deal AI summary |
| `src/lib/errors.ts` | `IntegrationError` base + `HubSpotError`, `JustCallError`, `GoogleError` |
| `src/lib/ai/errors.ts` | `AIError` (separate hierarchy) |
| `src/lib/utils/format.ts` | `formatAmount`, `relativeDate`, `formatDate` |
| `src/lib/utils/business-days.ts` | `businessDaysElapsed` — always America/New_York |
| `src/lib/utils/rate-limiter.ts` | `TokenBucket` — in-memory, replace before AWS |
| `src/app/api/` | Next.js route handlers — thin only |
| `src/proxy.ts` | Next.js 16 Middleware (was middleware.ts) |

---

## What This Is
Owner-attention layer on top of HubSpot CRM for Horizon Recovery LLC. Answers: "What needs Mo's attention right now?" Read-only Phase 1. Single user (Mo). Shared password auth.

---

## Web Search Rule — Run Before Assuming

Third-party platforms change constantly. Before acting on any platform-specific detail below, run a web search to verify it is still current. Do this for:

| Topic | What to verify |
|---|---|
| HubSpot API scopes | Exact scope strings available in Service Keys UI |
| HubSpot API endpoints | Endpoint paths, response shapes, deprecated routes |
| HubSpot rate limits | req/s and req/day for Starter plan |
| JustCall API | Endpoint paths, auth format, rate limits per plan tier |
| JustCall rate limits | Burst and hourly limits — verify against current account settings |
| Google Workspace API | Gmail/Calendar API endpoints, OAuth scopes, quota limits |
| Vercel plan limits | Cron frequency, function timeout per plan (Hobby vs Pro) |
| Next.js version | Current stable version, create-next-app flags |
| Prisma + Neon | Current connection string pattern, adapter availability |
| Vitest | Current install command, config file format |
| Anthropic SDK | Current package name, model IDs |

When you search: mark what you confirmed, what you couldn't confirm, and what contradicts the docs. Update the docs if something has changed. Add a LEARNINGS.md entry for anything surprising.

---

## Doc Map

| File | Contains |
|---|---|
| `docs/design-doc.md` | Architecture, internal types, DB schema, file structure, rate limiter, caching, API routes, multi-source architecture (M9+) |
| `docs/gameplan.md` | Active milestones M9–M13 with checklists and agent protocols |
| `docs/product-roadmap.md` | P1/P2/P3 priority system, current milestone status |
| `docs/business-context.md` | Business domain, pipeline stages, deal health rules, stage definitions |
| `docs/hubspot-api-research.md` | M1 research scripts + field mapping template |
| `docs/api-reference.md` | API inputs/outputs — read before writing any API call code |
| `docs/research/field-mapping.md` | Confirmed HubSpot property name → internal field mapping (filled in during M1) |
| `docs/research/pipeline-stages.json` | Pipeline ID and all stage ID → name mappings |
| `docs/archive/milestones-m0-m8.md` | Historical milestone checklists (M0–M8 complete) |

---

## Determine Current Milestone

Check `docs/gameplan.md`. Find the first milestone with unchecked items. Read its preconditions before starting any work.

---

## Autonomous Work Loop

```
1. Read current milestone preconditions from docs/gameplan.md
2. If preconditions NOT met → STOP, report exactly what is missing and what Mo needs to do
3. Work through checklist items autonomously
4. After each logical chunk (sub-milestone or named section):
   a. Run tests: npm test
   b. If tests PASS → git commit "[Mxn] description"
   c. If tests FAIL → STOP, report: which test failed, what was returned, what was expected
5. When milestone complete → run full test suite, report summary, wait for Mo before starting next milestone
```

---

## Stop and Wait for Mo When

- A required credential is missing (`HUBSPOT_ACCESS_TOKEN`, `ANTHROPIC_API_KEY`, `DATABASE_URL`)
- `docs/research/field-mapping.md` is not filled in but a field name is needed
- Tests fail and root cause is unclear after one fix attempt
- HubSpot returns a data shape not documented in `docs/api-reference.md`
- A decision is needed that docs do not cover
- About to make a destructive or hard-to-reverse change (schema drop, file delete, etc.)
- Approaching rate limit (daily call count > 60,000)
- **About to add any HubSpot write capability** (creating notes, moving stages, creating deals, creating contacts, sending anything). Permanently read-only. Write capabilities belong in `src/lib/hubspot/actions.ts` which does not exist — creating it requires Mo's explicit approval.
- **About to run JustCall sync in full mode** — must run sample mode (last 24h, max 20 records) first and wait for Mo's explicit approval before pulling full history.
- **About to run Google sync for the first time** — must run sample mode (last 7 days, max 50 emails) first and wait for Mo's explicit approval before pulling full history.

---

## Never Assume

| What | Source of truth |
|---|---|
| HubSpot property names | `docs/research/field-mapping.md` (filled in M1) |
| Stage names / IDs | `docs/research/pipeline-stages.json` — never compare against raw string names |
| Phone field names | `docs/research/contact-properties.json` |
| Total deal count | Query HubSpot, do not hardcode |
| API response shape | `docs/api-reference.md` — never guess what a field contains |
| Mo Action Required keywords | Placeholder until validated with real note data after M1 |
| Business hours / timezone | America/New_York |

---

## Key Constants

```
Pipeline name:     Cases – Surplus Funds (pipeline ID from pipeline-stages.json)
Total deals:       150 (2 pages of 100 in CRM search)
Timezone:          America/New_York

--- HubSpot ---
HubSpot plan:      Starter — 100 req/10s, 250,000 req/day
HubSpot cap:       30% = 3 req/s max, 75,000 req/day max, warn at 60,000
Daily warn:        If sync_log daily call count > 60,000, stop auto syncs, allow manual only
Layer 1 sync:      2 API calls for all 150 deals (2 pages)
Layer 2 per deal:  7–9 API calls (5 association + 1 batch per non-empty type)
Worst case/day:    ~1,360 calls if all 150 deals get Layer 2 = 1.8% of daily cap
Surplus field:     amount (NOT estimated_surplus — confirmed null on 100% of deals)

--- JustCall ---
JustCall API:      https://api.justcall.io/v2.1
JustCall auth:     Authorization: <api_key>:<api_secret> header
JustCall burst:    60 req/min → 30% cap = 18 req/min
JustCall hourly:   3600 req/hr → 30% cap = 1,080 req/hr
JustCall sample:   Last 24h, max 20 records — Mo must approve before full pull
JustCall full:     Last 90 days on first run; since last_synced_at thereafter
Phone format:      E.164 (e.g., +14045551234) — normalize all numbers before storing

--- AI ---
AI model:          claude-sonnet-4-6
AI lookback:       28 days of activity history per summary

--- Architecture ---
Staleness source:  app_settings table (was thresholds.ts in M3; moved to DB in M7)
Pipeline groups:   setup | outreach | case_mgmt | terminal (see PIPELINE_GROUP in settings.ts)
JustCall key:      .env.local only — never in code or git (key visible in JustCall dashboard)
```

---

## Prisma 7 — Breaking Changes (confirmed in M2a)

Always import `prisma` from `/src/lib/db/client.ts`. Never instantiate `PrismaClient` directly anywhere else.

**Prisma 7 changed the connection URL pattern:**
- `prisma/schema.prisma` datasource has NO `url` or `directUrl` — only `provider = "postgresql"`
- `prisma.config.ts` (project root) — configures Prisma CLI using `DIRECT_URL`
- `src/lib/db/client.ts` — instantiates `PrismaClient` with `@prisma/adapter-pg` using `DATABASE_URL` (pooled)

For Prisma CLI commands, use npm scripts that load `.env.local` via `dotenv-cli`:
```
npm run db:migrate    # = dotenv -e .env.local -- prisma migrate dev
npm run db:push       # = dotenv -e .env.local -- prisma db push
npm run db:generate   # = prisma generate
```

## Next.js 16 — Breaking Changes (confirmed in M2a)

**Next.js 16 renamed Middleware to Proxy:**
- File is now `src/proxy.ts` (not `src/middleware.ts`)
- Exported function is `proxy` (not `middleware`)
- API is otherwise identical (NextRequest, NextResponse, config.matcher)

## stageMap and ownerMap

These are loaded from `app_settings` (seeded after M1). Load once per sync invocation and pass to mapper. Never hardcode stage names. Never compare `deal.stage` against a raw string — always use `stageMap[deal.stage]`.

## Staleness Rules — Two Separate Signals

`stage_entered_at` (→ `hs_v2_date_entered_current_stage`) = how long deal has been in current stage → use for **Stage Stale** rule ("stuck in Attempted Contact for 14 days").

`last_activity_date` (→ `notes_last_updated`) = when anything last happened → use for **No Recent Activity** rules (Agreement Sent, Signed/In Progress).

Never use `last_activity_date` for Stage Stale — a deal can have a note yesterday but be stuck in stage for 30 days. Never fire staleness rules on terminal stages (Dead, DNC, Blocked, Exhausted, Closed-Paid, F, More Research Need).

## Test Framework — Vitest

Use Vitest, not Jest. Config in `vitest.config.mts`. Run with `npm test`.

TDD loop: write test → confirm it fails → implement → confirm it passes → commit. Never skip the red phase.

Test fixtures for mapper tests: load `docs/research/sample-deal.json` etc. with `fs.readFileSync`. Never call real HubSpot in unit tests.

## Rate Limiting — Enforced Rule

ALL HubSpot API calls MUST go through `/src/lib/hubspot/client.ts`. Never call the HubSpot API directly anywhere else. The client enforces a token bucket at 3 req/s. Daily call count is read from `sync_log` (not in-memory). See `docs/api-reference.md` for the rate limiter spec.

## Error Handling Rule

- HubSpot 429: handled in client.ts (backoff + retry)
- HubSpot 5xx: throw `HubSpotError` — caller shows stale data banner, does not crash
- Anthropic error: throw `AIError` — UI shows "Summary unavailable"
- Partial sync: log to sync_log with deals_synced count, do not throw

## Layer 1 vs Layer 2 Rules

M3 rules run on `deals` table data only. Layer 2-dependent rules (Mo Action Required, phone check) are added in M4 after Layer 2 is working. Do not implement Layer 2 rules in M3.

## Sync Schedule

The cron schedule lives in `vercel.json`. It is static and cannot be changed at runtime. Do not add sync schedule to the settings UI.

---

## Layer 2 Rule

Layer 2 is NEVER pulled automatically. Only triggered by Mo clicking "Load Full Detail" in the UI. Show static range "5–50+ API calls depending on deal activity" before pulling. Do NOT compute an estimate (the estimate itself requires making the API calls). After the first Layer 2 sync for a deal, show the actual count from sync_log.

---

## AI Rule

AI summaries are NEVER auto-generated. Manual button only. No scheduled regeneration in v1.

---

## Git Commit Rules

- Commit at every passing test gate (end of each sub-milestone: M2a, M2b, M2c, etc.)
- Format: `[M2c] layer1 sync — upsert with raw_payload`
- Never commit if tests fail
- Never commit `.env.local` or any secrets
- Add `docs/research/` to `.gitignore` (raw JSON output contains real deal data)
- Use `npm test` to verify before committing

---

## DB Rules

- Schema: `prisma/schema.prisma`
- Do NOT write the Prisma schema until `docs/research/field-mapping.md` is filled in
- Every table has a `raw_payload JSONB` column
- After any schema change: `npx prisma migrate dev --name <description>`
- Use a singleton Prisma client (one instance per process, reused across requests)

---

## Rules Engine Architecture

Each attention rule (`/src/lib/rules/*.ts`) is a pure function with this signature:
```typescript
type Rule = (deal: NormalizedDeal, ctx: RuleContext) => AttentionFlag | null
```
- No rule file imports from `@prisma/client` or `src/lib/db/`
- No rule file imports from another rule file
- Adding a rule = new file + one line in `rules/index.ts`
- Removing = delete file + remove from index

`RuleContext` carries: `today`, `timezone`, `stageMap`, `staleThresholds`, `snoozedDealIds: Set<string>`
`NormalizedDeal` has `amount: number` (never Prisma Decimal — converted in `db/deals.ts`)
`snoozedDealIds` is preloaded once per request as a Set — never query DB per deal

All DB access for the rules pipeline goes through `src/lib/db/deals.ts`. Rules get clean typed data.

## Business Days — Timezone Rule

`business-days.ts` MUST convert timestamps to `America/New_York` before counting business days. `stageEnteredAt` is stored as UTC. A deal entering a stage at 11pm ET Friday = Saturday UTC — business-day counting in UTC gives wrong results. Use `Intl.DateTimeFormat` with `timeZone: 'America/New_York'` or `date-fns-tz`.

## JSON Serialization — Safe Cast Rule

When casting `unknown` values to Prisma's Json type, always clone through JSON first:
```typescript
// Wrong — bare cast hides runtime serialization errors:
return v as Prisma.InputJsonValue

// Right — surfaces non-serializable content immediately:
return JSON.parse(JSON.stringify(v)) as Prisma.InputJsonValue
```

## Mapper Contract

The mapper (`/src/lib/hubspot/mapper.ts`) is the only file that knows raw HubSpot property names. If a field name changes, only the mapper changes. Downstream code uses internal types only.

Every property read in the mapper must use `?? null`. Never assume a key exists in the HubSpot response:
```typescript
// Wrong: props.phone_1
// Right: props?.phone_1 ?? null
```
If this discipline slips and property names appear outside mapper.ts, the schema drift protection breaks entirely.

## Prisma Decimal — DB Read Rule

`amount` and `estimatedSurplus` are `Decimal` objects when read from DB (not plain numbers). Always call `.toNumber()` before comparisons, or use `db/deals.ts` which handles conversion. Never compare Decimal objects directly to numbers.

---

## Service Layer Architecture — Three Enforced Boundaries

### Boundary 1 — DB Access

**All DB reads and writes go through `src/lib/db/` functions. Never import `prisma` directly outside `src/lib/db/`.** Zero exceptions.

**All `$transaction` calls go through `withTransaction()` or `withBatchTransaction()` in `src/lib/db/transaction.ts`.** Both enforce a 30s timeout and `maxWait: 5000`. Never call `prisma.$transaction()` directly.

### Boundary 2 — External API Clients

**All HubSpot API calls go through `src/lib/hubspot/client.ts`** (existing rule, still applies).

**All Anthropic calls go through `src/lib/ai/client.ts`** — use `callClaude()` for blocking responses, `callClaudeStreaming()` for streaming. Never instantiate `new Anthropic()` outside `src/lib/ai/client.ts`.

**New external service integrations go in `src/lib/integrations/<service-name>/`.** Follow the pattern in `src/lib/hubspot/client.ts`:
- One `request()` method all calls flow through
- Per-service `TokenBucket` instance (not the shared HubSpot one)
- Service-specific error class extending `IntegrationError` from `src/lib/errors.ts`
- `log.info` on every call with service, endpoint, and duration
- Exponential backoff on 429 up to MAX_RETRIES

Scaffold clients exist for Google Workspace (`src/lib/integrations/google/client.ts`) and skip-tracing (`src/lib/integrations/skip-tracing/client.ts`).

### Boundary 3 — Errors

- `src/lib/errors.ts` — `IntegrationError` (base) + `HubSpotError`, `GoogleError`, `SkipTracingError`, `BrowserError`
- `src/lib/ai/errors.ts` — `AIError` (AI-specific, not an integration error)
- No other `AIError` definitions exist. Never import `AIError` from `src/lib/errors.ts`.

### AWS / Multi-Instance Migration Gate

The `TokenBucket` in `src/lib/utils/rate-limiter.ts` is **in-memory and per-invocation** — correct for Vercel serverless (each function invocation is isolated). **Before deploying to AWS multi-instance containers:** replace `TokenBucket` with a DB-backed leaky bucket reading from a `rate_limit` table per service. The daily call cap in Postgres already coordinates across invocations. The per-second bucket does not.
