# Horizon Intelligence Dashboard — Technical Design Document

## Purpose

**Horizon Recovery Operations Dashboard** — An owner-attention dashboard that reads from HubSpot and provides operational clarity across 150+ deals. Phase 1 is read-only. Internal state (snooze, tasks, AI summaries) lives in our own database.

**Design philosophy:** Build the smallest useful thing. Refactor later. A future hub linking multiple Horizon tools is a P3 consideration — this codebase does not need to anticipate it.

---

## Build Philosophy

Build in proof-of-concept layers. Do not one-shot the full app. Each layer must work and be manually reviewed before the next is built.

Order:
1. Create HubSpot Private App and pull property schemas
2. Pull one sample deal + contacts + activities — save raw JSON
3. Mo reviews the output and confirms which fields matter
4. Design the database schema based on real data
5. Build Layer 1 sync + attention queue UI
6. Add Layer 2 (on-demand, per deal) only after Layer 1 works
7. Add AI summaries only after Layer 2 works

Never build the database schema until real HubSpot data has been reviewed. Never build the UI before the data shape is confirmed.

---

## Tech Stack

| Layer | Decision | Rationale |
|---|---|---|
| Framework | Next.js 16+ (App Router) | Aligns with existing projects, excellent Vercel integration |
| Language | TypeScript | Type safety across full stack |
| Styling | Tailwind CSS | Rapid UI development |
| Database | Neon PostgreSQL | Serverless Postgres, native Vercel integration, free tier |
| ORM | Prisma | Type-safe queries, easy migrations |
| Testing | **Vitest** | ESM-native, 2.1× faster than Jest, works with App Router without ESM config pain |
| Deployment | Vercel | Preferred platform |
| DNS/CDN | Cloudflare | Already available |
| Source control | GitHub | Already in use |
| AI | Anthropic Claude API | claude-sonnet-4-6 for summaries |
| Auth | Middleware password check | Single user, Phase 1 — check cookie vs. env var |

### Prisma + Neon Serverless Rules

Neon provides two connection strings — use both. Neon handles pooling via PgBouncer; do not rely on `?connection_limit=1` alone.

```
DATABASE_URL=postgresql://user:pass@host/db?pgbouncer=true&connect_timeout=15  # pooled (PgBouncer) — app traffic
DIRECT_URL=postgresql://user:pass@host/db                                        # direct — Prisma migrate only
```

**Prisma 7 breaking change (confirmed in M2a):** `url`/`directUrl` are removed from `schema.prisma`. Use `prisma.config.ts` for CLI config and `@prisma/adapter-pg` for the app client.

`prisma/schema.prisma` datasource (no url/directUrl):
```prisma
datasource db {
  provider = "postgresql"
  // URLs configured in prisma.config.ts (CLI) and PrismaPg adapter (app)
}
```

`prisma.config.ts` (CLI uses DIRECT_URL):
```typescript
import { defineConfig } from 'prisma/config'
export default defineConfig({
  schema: 'prisma/schema.prisma',
  datasource: { url: process.env.DIRECT_URL ?? '' },
})
```

`src/lib/db/client.ts` (app uses DATABASE_URL pooled via adapter):
```typescript
import { PrismaClient } from '@prisma/client'
import { PrismaPg } from '@prisma/adapter-pg'

const globalForPrisma = globalThis as unknown as { prisma: PrismaClient }

function createPrismaClient() {
  const adapter = new PrismaPg({ connectionString: process.env.DATABASE_URL! })
  return new PrismaClient({ adapter, log: process.env.NODE_ENV === 'development' ? ['error'] : [] })
}

export const prisma = globalForPrisma.prisma ?? createPrismaClient()
if (process.env.NODE_ENV !== 'production') globalForPrisma.prisma = prisma
```

All DB access imports `prisma` from this singleton. Never instantiate `PrismaClient` directly. CLI commands use npm scripts that load `.env.local` via `dotenv-cli`.

### stageMap and ownerMap Loading

Seeded into `app_settings` after M1 research is complete (`loadStageMap()` / `loadOwnerMap()` in `src/lib/db/settings.ts`). Loaded fresh on each sync run and each `/api/deals` request — one DB query each, no in-memory caching needed (serverless functions have no persistent memory across invocations).

```typescript
// In /api/deals and sync runs — loaded once, passed down
const stageMap = await loadStageMap()   // app_settings where key = 'stage_map'
const ownerMap = await loadOwnerMap()   // app_settings where key = 'owner_map'
```

---

## CRM Abstraction Layer

The HubSpot connector is the only place that knows about raw HubSpot response shapes. The rest of the application works with stable internal contracts. If HubSpot is ever replaced, only the connector changes.

**Internal type contracts:**

```typescript
interface Deal {
  id: string
  name: string
  stage: string            // stage ID — resolve to name via stageMap
  pipeline: string         // pipeline ID
  ownerId: string | null   // hubspot_owner_id — mostly Marwa/data entry, not used for routing
  amount: number | null            // PRIMARY display value — confirmed populated 100% of deals
  estimatedSurplus: number | null  // Custom field — confirmed null on all 150 deals (2026-06-07); store but do not display
  closeDate: Date | null
  lastActivityDate: Date | null    // notes_last_updated — use for "no recent activity" rules
  stageEnteredAt: Date | null      // hs_v2_date_entered_current_stage — use for "stuck in stage" rules
  lastModified: Date | null        // hs_lastmodifieddate — delta sync filter
  contactCount: number             // num_associated_contacts
  propertyAddress: string | null   // properties_address
  county: string | null            // enumeration: 25 GA counties + "Other"
  parcelId: string | null          // parcel_id__deal
  taxSaleDate: Date | null
  hubspotUrl: string
}

interface Contact {
  id: string
  name: string
  contactType: string | null       // contact_type1: owner, heir, attorney, spouse, etc.
  ownershipStatus: string | null   // ownership_contact_status1
  isDeceased: boolean              // is_deceased
  doNotContact: boolean            // do_not_contact
  phoneNumbers: string[]           // merged + validated from all 11 phone field variants
  emails: string[]
}

interface Activity {
  id: string
  type: 'note' | 'email' | 'call' | 'task'
  body: string | null           // notes: strip HTML from hs_note_body before storing
  authorOwnerId: string | null  // hubspot_owner_id on engagement — use for employee activity stats
  direction: 'inbound' | 'outbound' | null  // OPEN: email direction values not fully confirmed
  timestamp: Date
  metadata: Record<string, unknown>
}
```

**Key rule:** Phone numbers must be collected from every known phone field variant (standard HubSpot, `phone_1`–`phone_7`, `phone_numbers__excess_elite`, `phone_numbers__beenverified_fastpeople_etc`). The mapper merges all non-null values into a single `phoneNumbers` array and validates each entry (reject obviously non-phone values like dates). New phone field sources can be added to the mapper without changing downstream code.

**Raw payload storage:** The database stores both normalized fields and the original `raw_payload jsonb` column on each table. This allows the schema to evolve as new HubSpot fields are discovered without requiring migrations.

### Schema Flexibility — Current Approach (Option A)

HubSpot is Mo's source of truth. Property names change — fields get renamed, added, or deleted. The architecture handles this with three rules enforced from day one:

1. **`raw_payload` is the safety net.** Every sync stores the full HubSpot API response verbatim. Data is never lost due to a missing mapper field.

2. **The mapper is the only file that knows raw HubSpot property names.** No route handler, rule file, or query reaches a HubSpot property name directly. If a property is renamed, only `mapper.ts` changes.

3. **Every property read uses `?? null`.** Never assume a property key exists in the response. `const val = props?.phone_1 ?? null` — returns null gracefully if deleted, renamed, or simply empty.

Normalized typed columns exist only for the ~12 fields that drive rules and queries (stage, dates, amounts, counts). Everything else is read from `raw_payload` at display time.

**What this does NOT solve:** Silent drift. If Mo deletes `phone_1` from HubSpot, the column goes null on next sync. Nothing alerts you. This is acceptable for now. See README.md Future Work section for the longer-term upgrade path.

### Future Automation Readiness

The architecture is designed around three explicit boundaries. Phase 1 only implements the first.

**Observe → Suggest → Act**

1. **Read boundary** *(exists now)* — `src/lib/hubspot/client.ts` is the only file that calls HubSpot. All reads go through it. Nothing else touches the HubSpot API.

2. **Write boundary** *(future — does not exist yet)* — When Phase 2 write capabilities are added (creating notes, moving stages, sending emails), they go in `src/lib/hubspot/actions.ts` and NOWHERE else. No write calls anywhere in the current codebase. If you see a HubSpot write call outside this file, it is a bug.

3. **Approval boundary** *(partial — M6)* — When an AI summary flags `mo_action_required: true`, Mo is prompted to create a task (pre-filled with `suggested_next_step`). Mo decides to create it or skip. No action is taken without explicit Mo input. All tasks in `internal_tasks` have `source: 'manual'` in v1 — there is no auto-creation.

These three boundaries are sufficient to integrate any future automation layer. Do not add infrastructure beyond this until the automation system's actual shape is known.

---

## Environment Variables

```
DATABASE_URL=                  # Neon connection string (pooled via PgBouncer)
DIRECT_URL=                    # Neon direct connection (Prisma CLI only)
HUBSPOT_ACCESS_TOKEN=          # HubSpot Private App token
DASHBOARD_PASSWORD=            # Simple shared password auth
ANTHROPIC_API_KEY=             # Claude API key
JUSTCALL_API_KEY=              # JustCall API key
JUSTCALL_API_SECRET=           # JustCall API secret
GOOGLE_CLIENT_ID=              # Google OAuth client ID (gmail.readonly)
GOOGLE_CLIENT_SECRET=          # Google OAuth client secret
GOOGLE_REFRESH_TOKEN=          # Google OAuth refresh token
CRON_SECRET=                   # Vercel cron auth header (Bearer token)
```

---

## Authentication

Simple password middleware. On first visit, redirect to `/login`. On successful password submission, set an HTTP-only cookie. Middleware checks cookie on every request and redirects to `/dashboard` on success. No user management needed in Phase 1. Single shared password stored in `DASHBOARD_PASSWORD` env var.

---

## Architecture: Two-Layer Data Model

### Layer 1 — Broad & Cheap (All Deals)

Pulled on schedule (4x daily default) and on manual refresh. Single batch API call to HubSpot CRM Search.

Fields per deal (internal name → HubSpot property name — confirmed in M1):
- `hubspot_id` → `hs_object_id`
- `name` → `dealname`
- `stage` → `dealstage` (stage ID — resolve to name via stageMap; never compare raw strings)
- `pipeline` → `pipeline` (pipeline ID)
- `owner_id` → `hubspot_owner_id` (**NOTE:** Almost always Marwa who does data entry — not meaningful for routing)
- `amount` → `amount` (**USE THIS for display** — populated 100% of deals; matches deal name dollar figure)
- `estimated_surplus` → `estimated_surplus` (custom — confirmed null on all 150 deals as of 2026-06-07; store but do not display)
- `close_date` → `closedate`
- `last_activity_date` → `notes_last_updated` ✅ confirmed
- `stage_entered_at` → `hs_v2_date_entered_current_stage` ✅ **USE THIS for staleness rules** (when did deal enter current stage)
- `last_modified` → `hs_lastmodifieddate` (use as delta filter in smart sync)
- `contact_count` → `num_associated_contacts` ✅ confirmed available in CRM Search batch
- `task_count`, `open_task_count` — **not confirmed available in Layer 1 CRM Search; may require Layer 2**
- `property_address` → `properties_address` ✅ (not `address` or `property_address`)
- `county` → `county` ✅
- `parcel_id` → `parcel_id__deal` ✅ (double underscore + `_deal` suffix)
- `tax_sale_date` → `tax_sale_date` ✅
- `hubspot_url` — from `raw.url` field in API response (confirmed M1 — URLs are `https://app-na2.hubspot.com/...`, NOT constructed from portal ID)

This is sufficient to render the full attention queue without any Layer 2 data, once field names are confirmed.

### Layer 2 — Deep & Expensive (Per Deal, On Demand)

Only triggered when Mo explicitly clicks **"Load Full Detail"** in the deal detail panel. The panel always shows Layer 1 data first. Mo decides whether to pull Layer 2 for a given deal.

Before pulling, show: *"This will use 5–50+ HubSpot API calls depending on deal activity. Continue?"* Do NOT estimate the exact number — the estimate itself requires making the association calls. After the first Layer 2 sync for a deal, the actual call count is available in sync_log and should be displayed instead.

Pulls:
- Notes (full text, author, timestamp)
- Emails (subject, body, sender, direction, timestamp)
- Calls (outcome, notes, timestamp)
- Tasks (title, status, due date, assigned to)
- Contacts (all linked, full custom properties + all phone field variants merged)

**Note:** Google Drive documents linked in HubSpot are NOT accessible via any HubSpot API endpoint (confirmed M1). Files appear in HubSpot's sidebar via the Google Drive integration but cannot be retrieved programmatically.

**No auto-pull.** Even for high-value stages (Engaged/Interested, Agreement Sent, Signed/In Progress), Layer 2 is always on-demand.

---

## Database Schema

### `deals` — Layer 1 cache

**Note:** Do not finalize column list until real HubSpot data is reviewed in Milestone 1. The `raw_payload` column stores the original HubSpot response and allows schema evolution without migrations.

```sql
CREATE TABLE deals (
  id                  SERIAL PRIMARY KEY,
  hubspot_id          TEXT UNIQUE NOT NULL,
  name                TEXT,
  stage               TEXT,           -- stage ID from HubSpot — resolve via stageMap
  pipeline            TEXT,           -- pipeline ID from HubSpot
  owner_id            TEXT,           -- hubspot_owner_id (mostly Marwa/data entry — not used for routing)
  amount              DECIMAL,        -- USE for display — populated 100% of deals
  estimated_surplus   DECIMAL,        -- custom field — null on all current deals; store for future
  close_date          DATE,
  last_activity_date  TIMESTAMPTZ,    -- notes_last_updated — "no recent activity" rules
  stage_entered_at    TIMESTAMPTZ,    -- hs_v2_date_entered_current_stage — "stuck in stage" rules
  last_modified       TIMESTAMPTZ,    -- hs_lastmodifieddate — use for delta sync
  contact_count       INT DEFAULT 0,  -- num_associated_contacts
  property_address    TEXT,           -- properties_address
  county              TEXT,
  parcel_id           TEXT,           -- parcel_id__deal
  tax_sale_date       DATE,
  hubspot_url         TEXT,
  raw_payload         JSONB,          -- full HubSpot deal response
  synced_at           TIMESTAMPTZ DEFAULT NOW()
);
```

### `deal_activities` — Layer 2 activity cache

```sql
CREATE TABLE deal_activities (
  id               SERIAL PRIMARY KEY,
  deal_hubspot_id  TEXT REFERENCES deals(hubspot_id),
  type             TEXT, -- note | email | call | task
  body             TEXT,
  author_owner_id  TEXT, -- hubspot_owner_id on engagement (use for employee activity stats)
  direction        TEXT, -- inbound | outbound
  timestamp        TIMESTAMPTZ,
  metadata         JSONB,
  raw_payload      JSONB,
  synced_at        TIMESTAMPTZ DEFAULT NOW()
);
```

### `deal_contacts` — Layer 2 contact cache

```sql
CREATE TABLE deal_contacts (
  id                  SERIAL PRIMARY KEY,
  deal_hubspot_id     TEXT REFERENCES deals(hubspot_id),
  contact_hubspot_id  TEXT,
  name                TEXT,
  contact_type        TEXT,    -- contact_type1: owner, heir, attorney, spouse, etc.
  ownership_status    TEXT,    -- ownership_contact_status1
  is_deceased         BOOLEAN DEFAULT FALSE,  -- is_deceased
  do_not_contact      BOOLEAN DEFAULT FALSE,  -- do_not_contact
  phone_numbers       JSONB,   -- merged from all 11 phone field variants (validated)
  email_list          JSONB,
  raw_payload         JSONB,   -- full HubSpot contact response
  synced_at           TIMESTAMPTZ DEFAULT NOW()
);
```

### `deal_snoozes` — Internal state

```sql
CREATE TYPE snooze_category AS ENUM (
  'waiting_on_attorney',
  'waiting_on_county',
  'waiting_on_client',
  'waiting_on_documents',
  'waiting_on_probate',
  'filed_normal_wait',
  'other'
);

CREATE TABLE deal_snoozes (
  id              SERIAL PRIMARY KEY,
  deal_hubspot_id TEXT REFERENCES deals(hubspot_id),
  category        snooze_category NOT NULL,
  freeform_note   TEXT,
  snooze_until    DATE NOT NULL,
  created_at      TIMESTAMPTZ DEFAULT NOW(),
  woke_at         TIMESTAMPTZ -- null until expired
);
```

Active snooze = most recent row where `snooze_until >= today AND woke_at IS NULL`.

### `ai_summaries` — Cached AI output

```sql
CREATE TABLE ai_summaries (
  id               SERIAL PRIMARY KEY,
  deal_hubspot_id  TEXT UNIQUE REFERENCES deals(hubspot_id), -- one row per deal (upsert pattern)
  summary_json     JSONB NOT NULL,
  generated_at     TIMESTAMPTZ DEFAULT NOW()
);
```

**No `is_stale` column:** staleness is computed at read time by comparing `deal.last_activity_date > ai_summaries.generated_at`. No sync coupling needed, always accurate.

Summary JSON shape (Claude returns this as a JSON object — see prompt template):
```json
{
  "current_status": "...",
  "last_meaningful_activity": "...",
  "blockers": ["...", "..."],
  "who_needs_something": "...",
  "suggested_next_step": "...",
  "mo_action_required": true or false,
  "documents_mentioned_missing": ["death_certificate", "probate_records"]
}
```

### `internal_tasks` — Mo's task list (replaces Trello)

```sql
CREATE TYPE task_category AS ENUM (
  'case', 'business', 'vendor', 'legal', 'networking', 'other'
);

CREATE TABLE internal_tasks (
  id              SERIAL PRIMARY KEY,
  deal_hubspot_id TEXT REFERENCES deals(hubspot_id), -- nullable: general tasks have no linked deal
  title           TEXT NOT NULL,
  notes           TEXT,
  status          TEXT DEFAULT 'open', -- open | done
  due_date        DATE,
  category        task_category DEFAULT 'other',
  source          TEXT DEFAULT 'manual', -- always 'manual' in v1; ai_detected not used
  created_at      TIMESTAMPTZ DEFAULT NOW(),
  completed_at    TIMESTAMPTZ
);
```

### `app_settings` — Configurable thresholds

```sql
CREATE TABLE app_settings (
  key         TEXT PRIMARY KEY,
  value       TEXT NOT NULL,
  updated_at  TIMESTAMPTZ DEFAULT NOW()
);
```

Default settings to seed:
```
stage_stale_ready_for_outreach    = 5        (business days, from stage_entered_at)
stage_stale_attempted_contact     = 7
stage_stale_contact_made          = 5
stage_stale_follow_up_needed      = 5
stage_stale_engaged_interested    = 3
stage_stale_letter_outreach       = 14
agreement_sent_no_followup_days   = 2        (business days, from last_activity_date — NOT stage_entered_at)
signed_no_activity_days           = 5        (business days, from last_activity_date — NOT stage_entered_at)
ai_summary_lookback_days          = 28
```

**Omissions are intentional:**
- `stage_stale_new_case` — no staleness rule for New Case; document check rule applies instead (future)
- `stage_stale_agreement_sent` / `stage_stale_signed_in_progress` — these stages have their own rules using `last_activity_date` (not `stage_entered_at`). Adding them to stage_stale_* would create duplicate flags with different semantics. Their thresholds live under separate keys.
- Sync schedule: not in app_settings — lives in `vercel.json` (static, requires redeploy to change)

### `sync_log` — API usage tracking

```sql
CREATE TABLE sync_log (
  id              SERIAL PRIMARY KEY,
  sync_type       TEXT, -- layer1_all | layer2_deal | manual
  api_calls_made  INT,
  deals_synced    INT,
  started_at      TIMESTAMPTZ DEFAULT NOW(),
  completed_at    TIMESTAMPTZ,
  error           TEXT
);
```

### `activity_events` — Multi-source event log ✅ (M9+)

Unified log for all external call/email activity. Replaces `deal_activities` for non-HubSpot sources going forward. HubSpot notes/calls still live in `deal_activities` (Layer 2).

```sql
CREATE TABLE activity_events (
  id               SERIAL PRIMARY KEY,
  deal_hubspot_id  TEXT REFERENCES deals(hubspot_id), -- null = unmatched (phone not in registry)
  source           activity_source NOT NULL,           -- JUSTCALL | GOOGLE | HUBSPOT | USER | AI
  external_id      TEXT NOT NULL,                      -- source-specific ID (JustCall call ID)
  direction        TEXT,                               -- inbound | outbound
  happened_at      TIMESTAMPTZ NOT NULL,
  duration_secs    INT,
  from_number      TEXT,
  to_number        TEXT,
  outcome          TEXT,                               -- answered | voicemail | no_answer | busy
  agent_id         TEXT,                               -- JustCall agent ID
  recording_url    TEXT,
  raw_payload      JSONB,
  UNIQUE (source, external_id)                        -- dedup on re-sync
);
-- Indexes: (deal_hubspot_id, happened_at), (source, happened_at)
```

Current data: 7,110 rows — all JUSTCALL (6,928 outbound, 182 inbound).

### `call_transcripts` — Whisper + Claude classification ✅ (M10+)

One row per activity_event that has an audio recording. Populated by the call classifier pipeline (Whisper → Claude).

```sql
CREATE TABLE call_transcripts (
  id                  SERIAL PRIMARY KEY,
  activity_event_id   INT UNIQUE REFERENCES activity_events(id),
  classification      TEXT,   -- live | voicemail | disconnected | unknown | error
  transcript          TEXT,
  summary             TEXT,   -- Claude-generated 1-2 sentence summary
  duration_secs       INT,
  processed_at        TIMESTAMPTZ DEFAULT NOW()
);
```

Current data: 2,432 rows — all classified. 5,000+ activity_events have no transcript (no recording URL, or classification='error' for 413s).

Classification='error' rows are intentional tombstones — they permanently evict calls that will never be transcribed (413 audio too large, missing recording URL) from the backfill queue.

### `phone_numbers` — E.164 phone registry ✅ (M9+)

Normalized phone-to-deal index. Populated from `deal_contacts.phone_numbers` during Layer 2 sync. Used to match incoming JustCall calls to deals when JustCall provides no deal ID.

```sql
CREATE TABLE phone_numbers (
  id            SERIAL PRIMARY KEY,
  number_e164   TEXT NOT NULL,                    -- +14045551234 format, always
  deal_hubspot_id TEXT REFERENCES deals(hubspot_id),
  status        phone_status DEFAULT 'unknown',   -- active | disconnected | invalid | unknown
  created_at    TIMESTAMPTZ DEFAULT NOW()
);
-- Indexes: (number_e164), (deal_hubspot_id)
```

Current data: 2,543 rows.

### `sync_sources` — Integration registry ✅ (M9+)

One row per external data source. Seeded with HUBSPOT (active), JUSTCALL (active), GOOGLE (inactive).

### `pipeline_states` — Pipeline group status ⚠️ (M9 — created, never populated)

Intended to track which pipeline group (setup/outreach/case_mgmt) each deal is currently in. Created in M9 but never written to. Currently 0 rows. May be removed if `PIPELINE_GROUP` constant + `deal.stage` lookup proves sufficient.

### `deal_enriched` — PostgreSQL view ✅ (M11+)

Always-fresh derived layer. No sync step — always computed from the `deals` table on read.

Columns: `state` (GA/FL from address), `normalized_county` (from deal name), `owner_name` (third name segment), `tax_sale_year`, `case_age_months`, `amount_bucket` (small/mid/large/xlarge), `unique_call_days` (LEFT JOIN on activity_events), `call_intensity` (never_called/light/working/exhausted).

**Scale note:** At 150 deals this view is fast. Above ~5,000 deals, convert to `CREATE MATERIALIZED VIEW` refreshed on Layer 1 sync completion.

---

## UI Structure

### Visual Style
- Desktop only (large screen optimized)
- Clean executive: white background, generous spacing, minimal noise
- Color system: Red = urgent action, Yellow = warning, Green = healthy, Blue = informational, Gray = snoozed/inactive

### Navigation

All routes are password-protected. `/` redirects to `/login` if unauthenticated.

- `/login` — Password gate, redirects to `/dashboard` on success
- `/dashboard` (Queue) — Attention queue home ✅
- `/dashboard/pipeline` — Portfolio analytics (deal_enriched view) ✅ (unplanned, shipped M11+)
- `/dashboard/contacts` — Contact quality + owner tracking ✅ (unplanned, shipped M11+)
- `/dashboard/tasks` — Mo's internal task list ✅
- `/dashboard/settings` — Configurable thresholds + sync log ✅

### Dashboard Home

**Header:**
```
Attention Queue
X deals need attention · 150 total · Synced 5 minutes ago
[Refresh]  [Sync Now]  [Force Refresh]
```

**Attention groups (each collapsible — urgent first, healthy/snoozed collapsed at bottom):**
- 🔴 Agreement Sent — No Follow-Up *(urgent)*
- 🟡 Stage Stale *(warning)*
- 🟡 Signed — No Activity *(warning)*
- 🟡 No Contacts *(warning)*
- ⬜ Snoozed *(collapsed by default — deals with active snooze)*
- ⬜ Healthy *(collapsed by default — all deals with no active issues)*

**Note on Snooze Expired:** When a snooze expires, the deal naturally reappears in its appropriate flag group (Stage Stale, Agreement Sent, etc.). There is no separate "Snooze Expired" group — expired snoozes dissolve automatically. The deal's actual state determines where it lands.

**Mo Action Required (M5 ✅):** Deals where `ai_summaries.summary_json.mo_action_required = true` are surfaced as a top-priority group. This is NOT a Layer 1 rule — it requires a generated AI summary. Snooze always wins: a snoozed deal stays in the Snoozed group even if its summary has `mo_action_required: true`.

**Deal card (within each group):**
```
BREVARD - 2671 San Filippo Dr SE - JOHN THOMPSON        $33K
Follow-Up Needed · Activity 12 days ago
● No activity for 12 days (threshold: 7 days)          3d overdue
```

### Deal Detail Panel (slide-in from right)

```
[← Back]                                    [Open in HubSpot ↗]

BREVARD - 2671 San Filippo Dr SE - JOHN THOMPSON ($33K)
Stage: Follow-Up Needed  •  Owner: Marwa Yasmeen
County: Brevard  •  Parcel: 29 3732-GU-1181-4  •  Tax Sale: 02/19/2026

[Snooze this case]

─────────────────────────────────────────────────────────
[Load Full Detail]  ← triggers Layer 2 pull with API call count confirmation
─────────────────────────────────────────────────────────
AI SUMMARY  (generated 2 hours ago)  [↻ Regenerate]    ← visible after Layer 2 loaded (M5 ✅)
⚠ Mo Action Required

• Status: Waiting for Carlton Wright to return call
• Last Activity: Voicemail left 5/21 — also reached Alexis Wright (niece)
• Blockers: Niece said she'd forward info to heirs; no response since
• Who Needs Something: Client family needs to provide heirship documentation
• Suggested Next Step: Follow up with Alexis Wright, reference 5/21 conversation
[⚠ New activity since summary — consider regenerating]
─────────────────────────────────────────────────────────
CONTACTS (2)
• Earnest Wright Jr. — Owner — ☠ Deceased — Phones: (229) 560-4088, (229) 630-6147
• Alexis Wright — Heir? — Phone: (229) 611-4447
─────────────────────────────────────────────────────────
ACTIVITY TIMELINE
May 22, 2026  Note by Ma Kathleen Dabu
  Follow up call to Alexis Wright — got VM, left message

May 21, 2026  Call - Connected (Ma Kathleen Dabu)
  Spoke to Alexis Wright — Niece. Said she'll forward info to Earnest's children.

May 21, 2026  Note by Ma Kathleen Dabu
  Tried Carlton Wright — VM, full.
...
```

### Tasks Page

Sections:
- Open tasks (sorted by due date)
- Completed tasks (last 30 days)

Add task form: title, due date, category, deal link (optional), notes.

When a deal summary shows `mo_action_required: true`, a "Create task" prompt appears below the summary pre-filled with `suggested_next_step`. Mo clicks to create or dismisses it. All tasks are manual source in v1 — no auto-creation.

### Settings Page

- Stage staleness thresholds (one row per stage, editable)
- AI summary lookback window (days)
- Sync log: last 10 syncs, call counts, errors

**Not in settings:** Sync schedule (lives in `vercel.json` — static, requires redeploy to change. Not a UI concern).

---

## Attention Queue Logic

### Attention Trigger Checklist

Run on every Layer 1 sync. Each deal is evaluated against all rules. Triggered deals appear in attention queue under the appropriate group.

**Stage comparisons:** Never compare against raw stage name strings. Always use normalized stage names via `stageMap`. Example:
```typescript
// Wrong:  deal.stage === "Agreement Sent"
// Right:  stageMap[deal.stage] === "Agreement Sent"
```

### Rules Architecture — Pure Functions with Injected Context

Every rule has this exact shape. No DB calls inside rules.

```typescript
type Rule = (deal: NormalizedDeal, ctx: RuleContext) => AttentionFlag | null

// NormalizedDeal: DB read with Decimal→number conversion applied.
// Rules never import from Prisma or see Decimal objects.
type NormalizedDeal = {
  hubspotId: string
  name: string | null
  stage: string | null         // stage ID — resolve to name via ctx.stageMap
  amount: number | null        // number, not Prisma Decimal — converted in db/deals.ts
  stageEnteredAt: Date | null  // use for Stage Stale rules (time stuck in stage)
  lastActivityDate: Date | null // use for Agreement/Signed rules (no recent activity)
  contactCount: number
  hasValidPhone: boolean | null // null=Layer2 not loaded; false=no phones; true=has phones
  syncedAt: Date
}

// RuleContext: loaded once per /api/deals request, passed to every rule.
// Snoozes are a Set for O(1) lookup — never query DB per deal.
// All thresholds are passed via context so rules import nothing from thresholds.ts —
// makes M7 (replacing hardcoded thresholds with app_settings) a one-call-site change.
type RuleContext = {
  today: Date                              // injected — freezable in tests
  timezone: 'America/New_York'
  stageMap: Record<string, string>         // stage ID → name
  staleThresholds: Record<string, number>  // stage ID → business days (thresholds.ts in M3, app_settings in M7)
  agreementNoFollowupDays: number          // default 2 — business days before Agreement Sent fires
  signedNoActivityDays: number             // default 5 — business days before Signed fires
  terminalStageIds: Set<string>            // stages where no staleness rules fire
  snoozedDealIds: Set<string>              // pre-loaded once in db/deals.ts — O(1) per deal
}
```

All DB loading (deals query, snooze pre-load, stageMap) happens in `db/deals.ts` before rules run. The rules directory (`src/lib/rules/`) imports nothing from `@prisma/client` or `db/`. Adding a rule = new file + one line in `index.ts`. Changing thresholds = update context, not code.

### Layer 1-Only Rules (M3 — run against `deals` table alone)

These run on every deal using only data from the `deals` table. No Layer 2 required.

**Snooze Expired:**
- Active snooze record exists where `snooze_until < today AND woke_at IS NULL`

**Agreement Sent — No Follow-Up:**
- `stageMap[deal.stage]` = "Agreement Sent"
- `last_activity_date` > 2 business days ago

**Signed/In Progress — No Recent Activity:**
- `stageMap[deal.stage]` = "Signed / In Progress"
- `last_activity_date` > 5 business days ago

**Missing Contact Info (Layer 1 version):**
- `contact_count = 0` only — no phone check in M3 (phone data requires Layer 2)

**Stage Stale — uses `stage_entered_at`, NOT `last_activity_date`:**
- `stage_entered_at` beyond configured threshold for that stage (in business days)
- Thresholds from `thresholds.ts` (M3) or `app_settings` (M7+)
- Applied to: Ready for Outreach, Attempted Contact, Contact Made, Follow-Up Needed, Engaged/Interested, Letter Outreach
- **Why `stage_entered_at`:** A deal could have a note added yesterday while stuck in "Attempted Contact" for 30 days. `last_activity_date` would miss it. `stage_entered_at` catches it. The Agreement Sent and Signed rules above already use `last_activity_date` for activity recency — Stage Stale is about pipeline progression.
- **Explicit exclusions:** Never fire on Dead/Not Interested, DNC, Blocked Missing Info, Exhausted, Closed-Paid, F (Mortgage Foreclosures), More Research Need. Check `stageMap[deal.stage]` against terminal set before evaluating threshold.

### Layer 2-Dependent Rules (M4+ — require deal_activities and deal_contacts)

These run only when Layer 2 data exists for a deal. Added after M4.

**Mo Action Required (M5 — not a rule file, not heuristics):**
Mo Action Required is NOT implemented as a keyword heuristic rule. Instead, the AI summary (M5) returns `mo_action_required: true/false` as part of its structured output. After M5 ships, the `/api/deals` route can check `ai_summaries.summary_json.mo_action_required` and surface those deals as a group. No `mo-action.ts` rule file will be created.

Rationale: keyword heuristics will be wrong, will need constant tuning, and duplicate what the AI already does. The AI has full context; a keyword scanner doesn't.

**Missing Contact Info (Layer 2 upgrade, M4):**
- All `deal_contacts` for this deal have empty `phone_numbers`
- OR all `deal_contacts` have `do_not_contact = true`
- OR all contacts `is_deceased = true` AND no other contacts
- Note: this changes the semantics of `contacts.ts` (not just the implementation) — update tests when upgrading.

**Missing Setup Documents — DEFERRED (not building):**
AI inference of document presence from unstructured notes is complex and error-prone. Mo's team already tracks documents in Google Drive, and with ~18 active deals the value does not justify the complexity. Deferred indefinitely. If Mo explicitly asks for this, implement it then. No `document_checklist` table exists in the schema.

---

## AI Integration

### Per-Deal Summary Prompt

The prompt requests **JSON output** — not markdown sections. This makes parsing reliable and testable.

```
You are analyzing a surplus funds recovery case for Horizon Recovery LLC.
Goal: help the owner understand what is blocking this case and what should happen next.

Return ONLY a valid JSON object with exactly these keys. No other text, no markdown, no code fences.

{
  "current_status": "One sentence on where this case stands right now",
  "last_meaningful_activity": "Most recent significant event — not just any log entry",
  "blockers": ["Array of strings — what is preventing progress"],
  "who_needs_something": "Is the client, attorney, employee, or owner (Mo) waiting on someone? Who specifically?",
  "suggested_next_step": "The single most important action to take, and who should take it",
  "mo_action_required": true or false,
  "documents_mentioned_missing": ["Array of document types mentioned as missing or not yet received"]
}

Rules:
- mo_action_required must be a boolean (true/false), not a string
- blockers and documents_mentioned_missing must be arrays (empty array [] if nothing to report)
- If no documents are mentioned as missing, documents_mentioned_missing = []
- Be specific and direct. Short bullets over long prose.

---
Deal: {name}
Stage: {stage}
County: {county}
Amount: {amount}

Contacts:
{contact list — name, type (owner/heir/attorney), deceased flag, DNC flag}

Activity history (last {lookbackDays} days, most recent first):
{notes, emails, calls, tasks — each with: type, author, date, body}
```

**Parsing:** `JSON.parse(response.content[0].text)` — throw `AIError` if the response is not valid JSON or is missing required keys. Tests must cover: valid JSON, missing key, non-boolean `mo_action_required`.

### Daily Briefing Prompt

Generated in `src/lib/ai/briefing.ts` (`runBriefingGeneration()`). Output is prose, not JSON. Uses `callClaude(prompt, BRIEFING_SYSTEM, 2048)` — separate system prompt and higher token limit than deal summaries.

**System prompt (prose mode):** "You are a business analyst for Horizon Recovery LLC. Write a concise, action-oriented morning briefing in plain text. Be specific — name deals, name tasks, call out overdue items. No markdown headers."

**Prompt structure built dynamically:**
```
DAILY BRIEFING — {weekday}, {month} {day}, {year}

ATTENTION QUEUE ({N} deals):
- {deal name} [{stage}] ⚠ Mo Action Required: {flag message}
- ...

OPEN TASKS ({N}):
- [case] {title} — {deal name} (due {date})
- ...

EMPLOYEE ACTIVITY (last 7 days):        ← silently omitted if no deal_activities exist
- {owner name}: {N} notes, {N} calls

Write a concise morning briefing for Mo (2–3 short paragraphs).
Start with the most urgent items. Then cover open tasks.
If employee activity is included, close with a brief comment on team activity.
Be specific and actionable. No generic advice.
```

Rule context for briefing uses `buildRuleCtx()` — same as `/api/deals`, so thresholds stay consistent. Both update automatically when M7 moves thresholds to `app_settings`.

### Cache Invalidation Strategy

- Cache per deal, stored in `ai_summaries` (one row per deal — upsert on regenerate)
- Staleness computed at read time: `deal.last_activity_date > ai_summaries.generated_at` — no `is_stale` column
- Show "New activity since last summary" badge — do not auto-regenerate
- Mo manually clicks "↻ Regenerate" to refresh — no automatic triggers
- Daily Briefing always generates fresh (uses cached deal summaries where available)
- AI summaries are always manual in v1. Auto-generation may be considered in a future version if cost and workflow justify it.

---

## Testing Strategy

**Framework: Vitest.** Install with `npm install -D vitest @vitest/coverage-v8`. Configure in `vitest.config.ts`. Run with `npm test`. ESM-native, works with App Router without additional config.

**TDD loop:** write test → confirm it fails (red) → implement → confirm it passes (green) → commit. Never skip the red phase — it validates the test is actually testing something.

**Test fixtures:** Never call real HubSpot in unit tests. The `docs/research/*.json` files saved during M1 are the test fixtures. Load with `fs.readFileSync` in test setup.

```typescript
// Example: mapper test using M1 fixture
const rawDeal = JSON.parse(fs.readFileSync('docs/research/sample-deal.json', 'utf8'))
const deal = mapDeal(rawDeal.results[0])  // stageMap not needed at map time — stage IDs stored as-is
expect(deal.name).toBe('BREVARD - 123 Main St - ...')
```

| Layer | What to test | When |
|---|---|---|
| `rate-limiter.ts` | Token bucket: dequeues at correct rate, blocks when empty | M2c (write first) |
| `client.ts` | Retry on 429 with backoff, propagates non-429 errors | M2c |
| `mapper.ts` | Normalizes raw deal fields, merges all phone variants, resolves stageMap + ownerMap | M2c — uses M1 JSON fixtures |
| `business-days.ts` | Correct count across weekends, holidays not needed for v1 | M3 (write first) |
| Each `rules/*.ts` | Returns correct AttentionFlag for threshold breach; returns empty for healthy deal | M3 (write first) |
| `layer2.ts` | Upsert inserts new, updates existing, stores raw_payload | M2c |
| `prompts.ts` | Prompt contains deal name, stage, contacts, activities, JSON instruction string; activities outside lookback window excluded | M5 ✅ |
| `summary.ts` | `parseSummaryResponse()` returns valid shape; throws `AIError` on missing field, wrong type, bad JSON | M5 ✅ |

**Error handling contract:**
- HubSpot 429: retry with exponential backoff (handled in client.ts)
- HubSpot 5xx: throw `HubSpotError` with status code; caller shows stale data warning
- HubSpot timeout (>10s): throw `HubSpotTimeoutError`; layer1.ts logs to sync_log with error field
- Partial sync: log completed count in sync_log.deals_synced; do not throw; show "partial sync" in UI
- Anthropic error: throw `AIError`; UI shows "Summary unavailable" without crashing
- DB error: throw normally; Next.js error boundary catches for UI; log to console

Business days calculation must have thorough test coverage — it drives all staleness rules.

---

## HubSpot API Design

### Private App Setup (Required Before Build)

Scopes to request:
- `crm.objects.deals.read`
- `crm.objects.contacts.read`
- `crm.objects.notes.read`
- `crm.objects.tasks.read`
- `crm.objects.calls.read`
- `crm.objects.emails.read`
- `crm.schemas.deals.read`
- `crm.schemas.contacts.read`

### Key Endpoints

**Layer 1 sync (all deals):**
```
POST /crm/v3/objects/deals/search
{
  "filterGroups": [{ "filters": [{ "propertyName": "pipeline", "operator": "EQ", "value": "2172337854" }] }],
  "properties": ["dealname", "dealstage", "amount", "closedate", "hubspot_owner_id", ...],
  "limit": 100
}
```
Paginate with `after` cursor until all deals fetched.

**Layer 2 sync (activities for one deal):**
```
GET /crm/v3/objects/deals/{dealId}/associations/notes
GET /crm/v3/objects/deals/{dealId}/associations/calls
GET /crm/v3/objects/deals/{dealId}/associations/emails
GET /crm/v3/objects/deals/{dealId}/associations/tasks
GET /crm/v3/objects/deals/{dealId}/associations/contacts
```
Then fetch each associated object for full content.

**Property schemas:**
```
GET /crm/v3/properties/deals
GET /crm/v3/properties/contacts
```
Run these first during Milestone 1 to discover all custom fields.

**Owners:**
```
GET /crm/v3/owners
```

### Rate Limiting

All HubSpot calls go through `/src/lib/hubspot/client.ts`. Nothing else calls the HubSpot API directly.

```
Plan:             Starter — 100 req/10s, 250,000 req/day
Cap:              30% = 3 req/s max, 75,000 req/day max
Algorithm:        Token bucket — capacity 3, refill 3/second
On empty:         Queue request, wait for next token (do not throw)
On 429:           Exponential backoff — 1s, 2s, 4s, 8s — max 3 retries, then throw
Jitter:           ±100ms per refill to prevent synchronized bursts
Daily tracking:   Increment counter in sync_log on every API call
Warning:          If daily count > 60,000 → log warning, disable scheduled syncs
Hard stop:        If daily count > 75,000 → refuse all API calls until next day
```

---

## Caching Strategy

The database is the cache. No Redis or in-memory cache needed in v1.

| Data | Cache location | Staleness signal |
|---|---|---|
| Layer 1 deal data | `deals` table | `deals.synced_at` |
| Layer 2 activities | `deal_activities` table | `deal_activities.synced_at` |
| Layer 2 contacts | `deal_contacts` table | `deal_contacts.synced_at` |
| AI summaries | `ai_summaries` table | Computed at read time: `deal.last_activity_date > summary.generated_at` (no is_stale column) |
| Stage → name map | Loaded from `app_settings` table per sync invocation (seeded from pipeline-stages.json after M1) | Re-seed after pipeline changes |
| Owner → name map | Loaded from `app_settings` table per sync invocation (seeded from owners.json after M1) | Re-seed after team changes |

Layer 2 cache invalidation: if Mo clicks "Load Full Detail" and `deal_activities.synced_at < deal.last_activity_date`, show a "May be outdated" badge. Re-pull only if Mo confirms.

AI summary cache: never auto-regenerate. Show "New activity since last summary" badge. Mo clicks "↻ Regenerate" to refresh.

---

## File Structure

```
/
├── CLAUDE.md                          # Agent operating manual
├── docs/
│   ├── api-reference.md               # API inputs/outputs (read before writing API calls)
│   ├── business-context.md
│   ├── design-doc.md
│   ├── gameplan.md
│   ├── hubspot-api-research.md
│   ├── product-roadmap.md
│   └── research/                      # M1 output — gitignored (contains real deal data)
│       ├── deal-properties.json
│       ├── contact-properties.json
│       ├── pipeline-stages.json
│       ├── owners.json
│       ├── sample-deal.json
│       ├── sample-deal-contacts.json
│       ├── sample-deal-notes.json
│       ├── sample-deal-calls.json
│       ├── sample-deal-emails.json
│       ├── sample-deal-tasks.json
│       └── field-mapping.md           # Filled in after Mo reviews M1 output
├── prisma/
│   └── schema.prisma                  # Do not write until field-mapping.md is filled in
├── src/
│   ├── proxy.ts                       # Auth cookie check — all /dashboard/* routes (Next.js 16: renamed from middleware.ts)
│   ├── app/
│   │   ├── page.tsx                   # Redirects to /login
│   │   ├── login/page.tsx
│   │   ├── dashboard/
│   │   │   ├── layout.tsx             # Sidebar layout (desktop-only warning on mobile)
│   │   │   ├── error.tsx              # Route-level error boundary
│   │   │   ├── page.tsx               # Attention queue ✅
│   │   │   ├── tasks/
│   │   │   │   ├── page.tsx           # Task list ✅
│   │   │   │   └── error.tsx          # Route-level error boundary
│   │   │   └── settings/
│   │   │       ├── page.tsx           # Configurable thresholds + sync log ✅
│   │   │       └── error.tsx          # Route-level error boundary
│   │   └── api/
│   │       ├── auth/login/route.ts
│   │       ├── auth/logout/route.ts
│   │       ├── sync/layer1/route.ts   # (M2c ✅)
│   │       ├── sync/layer2/[id]/route.ts  # (M2c ✅)
│   │       ├── deals/route.ts         # (M3 ✅)
│   │       ├── deals/[id]/route.ts    # Single deal + Layer 2 data (M4)
│   │       ├── deals/[id]/snooze/route.ts  # (M4)
│   │       ├── deals/[id]/summary/route.ts # (M5)
│   │       ├── tasks/route.ts         # (M6)
│   │       ├── tasks/[id]/route.ts    # (M6)
│   │       ├── settings/route.ts      # (M7)
│   │       └── briefing/route.ts      # Daily Briefing (M6)
│   └── lib/
│       ├── hubspot/
│       │   ├── client.ts              # Rate-limited HTTP client (3 req/s cap, exponential backoff, batchReadObjects)
│       │   └── mapper.ts              # Raw HubSpot → internal Deal/Contact/Activity types
│       ├── sync/
│       │   ├── layer1.ts              # Batch deal sync (smart + full refresh modes)
│       │   └── layer2.ts              # Per-deal sync (on demand only)
│       ├── rules/                     # Each rule = one file = one exported function
│       │   ├── index.ts               # applyRules + evaluateAll — snooze first, then all others; re-exports buildRuleCtx
│       │   ├── ctx.ts                 # buildRuleCtx() — single place where RuleContext is built from thresholds (M7: becomes async, reads app_settings)
│       │   ├── types.ts               # NormalizedDeal, RuleContext, AttentionFlag, Rule types
│       │   ├── staleness.ts           # Stage Stale (stage_entered_at, skips terminals)
│       │   ├── contacts.ts            # No Contacts (Layer 1: contactCount=0; Layer 2 upgrade in M4)
│       │   ├── agreement.ts           # Agreement Sent — No Follow-Up (last_activity_date)
│       │   ├── signed.ts              # Signed/In Progress — No Activity (last_activity_date)
│       │   └── snooze.ts              # Active snooze — suppresses all other flags
│       │   # NOTE: no mo-action.ts — Mo Action Required comes from AI summary (M5), not heuristics
│       │   # NOTE: no documents.ts — Document checklist deferred; not worth building for 18 deals
│       ├── ai/
│       │   ├── errors.ts              # AIError class — isolated so tests don't import SDK (M5 ✅)
│       │   ├── client.ts              # callClaude(prompt, systemPrompt?, maxTokens?) — 1024 default, 2048 for briefing (M5 ✅)
│       │   ├── prompts.ts             # buildSummaryPrompt() — lookback filter + JSON instruction (M5 ✅)
│       │   ├── summary.ts             # parseSummaryResponse() + SummaryJson type (M5 ✅)
│       │   ├── generate.ts            # runSummaryGeneration() — orchestrates prompt+call+parse+upsert (M5 ✅)
│       │   └── briefing.ts            # runBriefingGeneration() — flagged deals + tasks + employee activity → prose (M6 ✅)
│       ├── db/
│       │   ├── client.ts              # Prisma singleton — always import from here
│       │   ├── deals.ts               # getDealsForQueue() — NormalizedDeal[] + snoozedDealIds Set
│       │   ├── settings.ts            # loadStageMap(), loadOwnerMap() from app_settings
│       │   ├── activities.ts          # Activity queries (M4+)
│       │   ├── contacts.ts            # Contact queries (M4+)
│       │   ├── snoozes.ts             # Snooze create/remove queries (M4+)
│       │   ├── summaries.ts           # AI summary queries (M5+)
│       │   ├── tasks.ts               # Internal task queries (M6+)
│       │   └── sync-log.ts            # Sync log queries + daily call count tracker
│       └── utils/
│           ├── business-days.ts       # Business days calc — America/New_York, fully unit tested
│           ├── json.ts                # asJson() — safe JSON cast for Prisma InputJsonValue
│           ├── rate-limiter.ts        # Token bucket — used only by hubspot/client.ts
│           └── thresholds.ts          # Deleted after M7 — TERMINAL_STAGE_IDS inlined to settings.ts, all other constants replaced by app_settings
└── vercel.json                        # Cron config
```

**Modular rule:** Each `/src/lib/rules/*.ts` file exports one function. No rule imports from another rule. Adding a rule = new file + register in `index.ts`. Removing = delete + unregister. The actual types (from `src/lib/rules/types.ts`):

```typescript
export type AttentionFlagType = 'stage_stale' | 'agreement_no_followup' | 'signed_no_activity' | 'no_contacts' | 'snoozed'
export type AttentionFlag = {
  type: AttentionFlagType
  severity: 'urgent' | 'warning' | 'info'
  message: string
  daysOverdue?: number
}
export type Rule = (deal: NormalizedDeal, ctx: RuleContext) => AttentionFlag | null
// index.ts: applyRules(deal, ctx): AttentionFlag[] — snooze runs first, suppresses all other flags
// index.ts: evaluateAll(deals, ctx): DealWithFlags[]
```

---

## Sync Engine Design

### Refresh Strategy

**Smart sync (default):** Pull only deals with `hs_lastmodifieddate >= last_synced_at`. Faster and cheaper. Most refreshes will touch only a few deals.

**Full Refresh:** Forces re-pull of all deals regardless of modified date. Use after major HubSpot changes or when data looks wrong.

Before any Layer 2 pull, show the static range and require confirmation from Mo: *"This will use 5–50+ HubSpot API calls depending on deal activity. Continue?"* After the first Layer 2 sync for a deal, show the actual count from sync_log.

**Vercel plan required for 4x daily sync: Pro ($20/mo).**
Hobby plan: once per day max, ±59 min precision. Pro plan: once per minute, per-minute precision.

Vercel Cron configuration (`vercel.json`) — **Pro plan only**:
```json
{
  "crons": [
    { "path": "/api/sync/layer1", "schedule": "0 13,15,17,19 * * 1-5" }
  ]
}
```
*(UTC — 9am/11am/1pm/3pm EDT. Winter: change to `0 14,16,18,20`. Cron does not auto-adjust for DST.)*

**Hobby plan fallback:** Use `"0 14 * * 1-5"` (once daily at 9am EST). Mo manually triggers Layer 1 sync for additional refreshes via the dashboard Refresh button. Acceptable for development; upgrade to Pro for production use.

---

## API Routes (Next.js App Router)

```
/api/sync/layer1          POST  -- trigger Layer 1 sync (also called by cron; force=true for full refresh)
/api/sync/layer2/[id]     GET   -- returns static call range message ("5–50+ API calls")
/api/sync/layer2/[id]     POST  -- trigger Layer 2 sync for one deal
/api/deals                GET   -- list deals with attention flags applied
/api/deals/[id]           GET   -- single deal with Layer 2 data if cached
/api/deals/[id]/snooze    POST  -- create snooze
/api/deals/[id]/snooze    DELETE -- remove snooze
/api/deals/[id]/summary   POST  -- generate/regenerate AI summary
/api/briefing             POST  -- generate Daily Briefing
/api/tasks                GET, POST
/api/tasks/count          GET  -- open task count (used by sidebar badge)
/api/tasks/[id]           PATCH, DELETE
/api/settings             GET, PATCH
/api/auth/login           POST
/api/auth/logout          POST
```

---

## Deployment

1. Push to GitHub → Vercel auto-deploys from `main`
2. Neon database: connection string in Vercel environment variables
3. Cloudflare: point custom domain DNS to Vercel
4. HubSpot Private App token: in Vercel environment variables

---

## Open Questions (Resolve During Milestone 1)

Confirmed:
- ✅ HubSpot plan: **Starter** (100 req/10s, 250,000 req/day)
- ✅ Pipeline name: **Cases – Surplus Funds** (ID: `2172337854`) — corrected from "KSR Plus Funds" in M1
- ✅ Timezone: **America/New_York**
- ✅ Deployment: Vercel autogenerated URL first, custom domain later
- ✅ Email notifications: dashboard only in v1, notifications are future work
- ✅ Layer 2: always on explicit "Load Full Detail" click — no auto-pull
- ✅ AI summary: always manual click, no auto-generate in v1

Resolved in M1:
1. ✅ **Custom deal property names** — all confirmed. See `docs/research/field-mapping.md`.
2. ✅ **Custom contact property names** — all confirmed. 11 phone field variants documented.
3. ✅ **Stage ID mapping** — confirmed. 16 stages in "Cases – Surplus Funds". See `pipeline-stages.json`.
4. ✅ **Google Drive files via API** — NOT accessible. Google Drive integration is UI-sidebar only; no API endpoint exposes linked files.
5. ✅ **Email body access** — confirmed working. `hs_email_text` accessible via `sales-email-read` scope.
6. ⚠️ **Email direction** — OPEN. Observed value is `"EMAIL"`, not `"INCOMING_EMAIL"`. Confirm all possible values.
7. ✅ **`last_activity_date`** — `notes_last_updated` confirmed. Use `hs_v2_date_entered_current_stage` for staleness.
8. ✅ **Contact count in Layer 1** — `num_associated_contacts` confirmed available in CRM Search.
9. ⚠️ **Task counts in Layer 1** — not yet confirmed. May require Layer 2.
10. ⚠️ **Calls endpoint** — sample deal had 0 calls. Need deal with calls to test `hs_call_body` etc.

---

## Multi-Source Architecture (M9+)

Phase 1 (M0–M8) pulls all data from HubSpot. Phase 2 adds JustCall as a second source, Google Workspace as a third. The architecture is designed so each new source plugs in without changing downstream rules or UI code.

### Three-Pipeline Model

Each HubSpot stage belongs to one of three operational pipelines. Rules and UI layouts change based on which pipeline a deal is in. See `docs/gameplan.md` for the full stage-to-pipeline mapping.

| Pipeline | Stages | Health Signal |
|---|---|---|
| **Setup** | New Case, Ready for Outreach | Data completeness — does this deal have phone numbers and required documents? |
| **Outreach** | Attempted Contact through Letter Outreach | Call cadence — how many attempts, what was the outcome, when is the next call due? |
| **Case Management** | Agreement Sent, Signed/In Progress | Workflow state — time-based staleness IS the right signal here |
| **Terminal** | Dead, DNC, Blocked, Exhausted, Closed-Paid, F, More Research Need | No rules fire |

The `PIPELINE_GROUP` constant in `src/lib/db/settings.ts` maps each stage ID to its pipeline group. Never compare pipeline group strings against raw stage names.

### New DB Tables (M9)

#### `activity_events` — Multi-source unified event log

Replaces `deal_activities` as the destination for new data sources. The existing `deal_activities` table stays for HubSpot Layer 2 data (backward compatible). New sources write to `activity_events`.

Key constraints:
- `@@unique([source, externalId])` — prevents duplicate inserts on re-sync
- `@@index([dealHubspotId, happenedAt])` — attention queue joins by deal + date
- `@@index([source, happenedAt])` — coverage queries by source
- `dealHubspotId` can be null for unmatched calls (JustCall phone not found in phone registry)

```sql
CREATE TABLE activity_events (
  id              SERIAL PRIMARY KEY,
  deal_hubspot_id TEXT REFERENCES deals(hubspot_id) ON DELETE CASCADE,  -- null = unmatched
  source          TEXT NOT NULL,  -- HUBSPOT | JUSTCALL | GOOGLE | USER | AI
  external_id     TEXT,           -- JustCall call ID, HubSpot engagement ID, Gmail message ID
  type            TEXT NOT NULL,  -- call | note | email | task | sms
  happened_at     TIMESTAMPTZ NOT NULL,
  duration_secs   INT,
  direction       TEXT,           -- inbound | outbound
  outcome         TEXT,           -- answered | voicemail | no_answer | busy
  from_number     TEXT,           -- E.164
  to_number       TEXT,           -- E.164
  agent_id        TEXT,           -- JustCall agent ID or HubSpot owner ID
  body            TEXT,           -- note text / email body excerpt / transcript
  metadata        JSONB,
  raw_payload     JSONB,
  created_at      TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(source, external_id)
);
CREATE INDEX idx_activity_events_deal_time ON activity_events(deal_hubspot_id, happened_at);
CREATE INDEX idx_activity_events_source_time ON activity_events(source, happened_at);
```

#### `phone_numbers` — E.164 phone registry

Normalized phone number registry. Populated from `deal_contacts.phone_numbers` during Layer 2 sync. Used to match incoming JustCall calls to deals by phone number.

```sql
CREATE TABLE phone_numbers (
  id              SERIAL PRIMARY KEY,
  number_e164     TEXT NOT NULL,   -- e.g. +14045551234
  deal_hubspot_id TEXT REFERENCES deals(hubspot_id) ON DELETE CASCADE,
  contact_name    TEXT,
  status          TEXT DEFAULT 'unknown',  -- active | disconnected | invalid | unknown
  last_seen_at    TIMESTAMPTZ,
  created_at      TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX idx_phone_numbers_e164 ON phone_numbers(number_e164);
CREATE INDEX idx_phone_numbers_deal ON phone_numbers(deal_hubspot_id);
```

#### `pipeline_states` — Per-deal pipeline group status

One row per deal per pipeline group. Tracks operational status (not_started | active | completed | blocked). Auto-computed in the future from `activity_events`; seeded manually for now.

```sql
CREATE TABLE pipeline_states (
  id              SERIAL PRIMARY KEY,
  deal_hubspot_id TEXT NOT NULL REFERENCES deals(hubspot_id) ON DELETE CASCADE,
  pipeline        TEXT NOT NULL,  -- setup | outreach | case_mgmt | terminal
  status          TEXT DEFAULT 'not_started',
  entered_at      TIMESTAMPTZ,
  completed_at    TIMESTAMPTZ,
  updated_at      TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(deal_hubspot_id, pipeline)
);
```

#### `sync_sources` — Integration registry

One row per external data source. Gate: check `is_active` before running a source's sync. `config` stores non-secret options (max records per sync, lookback days, etc.). Secrets live in environment variables only.

```sql
CREATE TABLE sync_sources (
  id            SERIAL PRIMARY KEY,
  name          TEXT UNIQUE NOT NULL,  -- HUBSPOT | JUSTCALL | GOOGLE
  is_active     BOOLEAN DEFAULT FALSE,
  last_synced_at TIMESTAMPTZ,
  config        JSONB,
  created_at    TIMESTAMPTZ DEFAULT NOW(),
  updated_at    TIMESTAMPTZ DEFAULT NOW()
);
```

Seed:
```sql
INSERT INTO sync_sources (name, is_active) VALUES
  ('HUBSPOT', true),
  ('JUSTCALL', false),
  ('GOOGLE', false);
```

### Denormalized Cache Columns on `deals`

```sql
ALTER TABLE deals ADD COLUMN call_attempt_count INT DEFAULT 0;
ALTER TABLE deals ADD COLUMN last_call_attempt_at TIMESTAMPTZ;
```

Updated atomically when JustCall sync inserts call events for a deal. Avoids JOINing `activity_events` on every attention queue load. Rules read `deal.callAttemptCount` directly.

### PhoneProvider Interface

All phone call integrations implement this interface. JustCall is the first implementation. RingCentral, GoHighLevel, or any future provider implements the same interface — the sync job calls `provider.getCallLogs(since, until)` without knowing which provider it is.

```typescript
// src/lib/integrations/phone-provider.ts

export interface NormalizedCallLog {
  externalId: string           // provider-specific call ID (string — never number, IDs can be large)
  happenedAt: Date
  durationSecs: number | null
  direction: 'inbound' | 'outbound'
  outcome: 'answered' | 'voicemail' | 'no_answer' | 'busy'
  fromNumberE164: string       // normalized to E.164 before this point
  toNumberE164: string         // normalized to E.164 before this point
  agentId: string | null       // provider's agent/user identifier
  rawPayload: unknown
}

export interface PhoneProvider {
  getCallLogs(since: Date, until: Date): Promise<NormalizedCallLog[]>
}
```

### JustCall Integration

**API base:** `https://api.justcall.io/v2.1`
**Auth:** `Authorization: <api_key>:<api_secret>` header
**Endpoint:** `GET /calls` with `from_datetime`, `to_datetime`, `page`, `per_page` params

**Rate limits (from Mo's account — verified 2026-06-07):**
- Burst: 60 req/min → 30% cap = **18 req/min**
- Hourly: 3600 req/hr → 30% cap = **1,080 req/hr**
- Webhooks: not rate-limited

**File locations:**
- `src/lib/integrations/phone-provider.ts` — interface (shared)
- `src/lib/integrations/justcall/types.ts` — JustCall API response shapes
- `src/lib/integrations/justcall/normalize.ts` — E.164 normalization + `NormalizedCallLog` conversion
- `src/lib/integrations/justcall/client.ts` — `JustCallClient implements PhoneProvider`; `TokenBucket(18, 'per_minute')`; `JustCallError extends IntegrationError`
- `src/lib/integrations/justcall/sync.ts` — `syncJustCallSample()` and `syncJustCallFull(since)`

**Phone matching flow:**
1. JustCall sync runs → gets `to_number` for each call (E.164)
2. Lookup `phone_numbers` WHERE `number_e164 = to_number` → get `deal_hubspot_id`
3. If found: insert `activity_events` with matched `deal_hubspot_id` + update deal cache cols
4. If not found: insert `activity_events` with `deal_hubspot_id = null` (unmatched)
5. Coverage report: matched / total = match rate (goal: >80%)

**E.164 normalization rules (US numbers only in v1):**
- Strip all non-digit characters
- If 11 digits starting with 1: remove leading 1 → 10 digits
- If 10 digits: prepend `+1`
- If fewer than 10 digits: reject (not a valid US number)
- Store in `phone_numbers.number_e164` exactly as `+1XXXXXXXXXX`

**Sample mode:** Last 24 hours of calls, max 20 records. Mo must approve sample before full pull.

**Full mode:** All calls since `sync_sources.last_synced_at` for JUSTCALL (or last 90 days if first run). Paginated. Updates `sync_sources.last_synced_at` on completion.

### Google Workspace Integration

Scaffold exists at `src/lib/integrations/google/client.ts`. Not yet active. Mo will provide OAuth credentials when ready.

**Auth:** OAuth 2.0 refresh token flow (read-only scopes: `gmail.readonly`, `calendar.readonly`)

**Email matching flow:**
1. Gmail sync pulls emails from last N days
2. For each email: extract `from` and `to` addresses
3. Match against `deal_contacts.email_list` (normalized address)
4. If match: insert into `activity_events` with `source = GOOGLE`, `type = email`
5. Unmatched emails: skip (do not store emails not related to deals)

**Rate limits:** Verify before implementation. Gmail API: typically 250 units/second. 30% cap = 75 req/s.

**File locations:**
- `src/lib/integrations/google/client.ts` — `GoogleClient`; `GoogleError extends IntegrationError`
- `src/lib/integrations/google/sync.ts` — `syncGoogleEmails()`, `syncGoogleCalendar()`

### New Rules (M11)

After JustCall data is loaded and match rate is acceptable:

**`src/lib/rules/call-cadence.ts`**
```typescript
// Fires: deal in outreach stage + next call is due (based on callAttemptCount + lastCallAttemptAt)
// Cadence: 0 attempts → call immediately; 1–7 → every 2 biz days; 7+ → every 7 biz days
// Severity: 'warning' if due today; 'urgent' if overdue by 1+ biz days
export function checkCallCadence(deal: NormalizedDeal, ctx: RuleContext): AttentionFlag | null
```

**`src/lib/rules/calls-exhausted.ts`**
```typescript
// Fires: deal in outreach stage + callAttemptCount >= ctx.callCadenceMaxAttempts (default 7)
// + deal NOT in Letter Outreach stage
// Severity: 'urgent'
// Message: "7 call attempts — consider Letter Outreach"
export function checkCallsExhausted(deal: NormalizedDeal, ctx: RuleContext): AttentionFlag | null
```

**`src/lib/rules/setup-readiness.ts`**
```typescript
// Fires: deal in Setup pipeline (New Case, Ready for Outreach) + contactCount = 0 OR no valid phones
// Severity: 'warning'
// Message: "No valid phone numbers — not ready for outreach"
export function checkSetupReadiness(deal: NormalizedDeal, ctx: RuleContext): AttentionFlag | null
```

### Updated `NormalizedDeal` (M11)

Add to existing type:
```typescript
callAttemptCount: number      // 0 if no JustCall data loaded
lastCallAttemptAt: Date | null
pipelineGroup: 'setup' | 'outreach' | 'case_mgmt' | 'terminal'  // derived from stage via PIPELINE_GROUP
```

### Updated `RuleContext` (M11)

Add to existing type:
```typescript
pipelineGroups: Record<string, 'setup' | 'outreach' | 'case_mgmt' | 'terminal'>
callCadenceMaxAttempts: number          // default 7 (from app_settings)
callCadenceInitialSpacingDays: number   // default 2 (from app_settings)
callCadenceResurfaceDays: number        // default 7 (from app_settings, after exhaustion)
```

### New API Routes (M10–M11)

```
POST /api/sync/justcall     — trigger JustCall sync (body: { mode: 'sample' | 'full' })
POST /api/sync/google       — trigger Google sync (M13, not yet built)
```

### Rate Limit Summary — All Sources

| Source | Plan Limit | 30% Cap | Tracked In |
|---|---|---|---|
| HubSpot | 100 req/10s | 3 req/s, 75k/day | sync_log.api_calls_made |
| JustCall | 60 req/min burst, 3600/hr | 18 req/min | sync_sources.config |
| Google (Gmail) | ~250 req/s | 75 req/s | sync_sources.config |

Every external API call goes through that service's `client.ts`. Never call external APIs directly in route handlers or sync jobs.

### File Structure — New Paths (M9+)

```
src/lib/
├── integrations/
│   ├── phone-provider.ts              # PhoneProvider interface + NormalizedCallLog type
│   ├── justcall/
│   │   ├── types.ts                   # JustCall API response shapes
│   │   ├── normalize.ts               # E.164 normalization + NormalizedCallLog conversion
│   │   ├── client.ts                  # JustCallClient implements PhoneProvider
│   │   └── sync.ts                    # syncJustCallSample() + syncJustCallFull(since)
│   ├── google/
│   │   ├── client.ts                  # GoogleClient (scaffold — awaiting credentials)
│   │   └── sync.ts                    # syncGoogleEmails() + syncGoogleCalendar()
│   └── skip-tracing/
│       └── client.ts                  # Scaffold — future skip trace integration
├── db/
│   ├── activity-events.ts             # NEW: getActivityEvents(), upsertActivityEvent()
│   └── phone-numbers.ts              # NEW: lookupDealByPhone(), upsertPhoneNumber(), populateFromDealContacts()
└── rules/
    ├── call-cadence.ts               # NEW: checkCallCadence() — outreach pipeline
    ├── calls-exhausted.ts             # NEW: checkCallsExhausted() — outreach pipeline
    └── setup-readiness.ts            # NEW: checkSetupReadiness() — setup pipeline
```

