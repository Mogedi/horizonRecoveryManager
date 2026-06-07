# Horizon Intelligence Dashboard — Technical Design Document

## Purpose

**Horizon Recovery Operations Dashboard** — An owner-attention dashboard that reads from HubSpot and provides operational clarity across 150+ deals. Phase 1 is read-only. Internal state (snooze, tasks, AI summaries, document checklist) lives in our own database.

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

In `prisma/schema.prisma`:
```prisma
datasource db {
  provider  = "postgresql"
  url       = env("DATABASE_URL")   // pooled
  directUrl = env("DIRECT_URL")     // direct for migrations
}
```

Singleton pattern (still required to prevent connection exhaustion on warm invocations):
```typescript
// src/lib/db/client.ts
import { PrismaClient } from '@prisma/client'

const globalForPrisma = globalThis as unknown as { prisma: PrismaClient }

export const prisma =
  globalForPrisma.prisma ??
  new PrismaClient({ log: process.env.NODE_ENV === 'development' ? ['error'] : [] })

if (process.env.NODE_ENV !== 'production') globalForPrisma.prisma = prisma
```

All DB access imports `prisma` from this singleton. Never instantiate `PrismaClient` directly. Get both connection strings from Neon dashboard (pooled + direct).

### stageMap and ownerMap Loading

No persistent startup in serverless. Strategy: seed `stageMap` and `ownerMap` into the `app_settings` table as JSON after M1 research is complete. On each sync run, load from DB once and pass to mapper. Cache in the invocation scope (module-level variable), not globally.

```typescript
// Loaded once per sync invocation, passed to mapper
const stageMap = await loadStageMap()   // queries app_settings where key = 'stage_map'
const ownerMap = await loadOwnerMap()   // queries app_settings where key = 'owner_map'
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
  estimatedSurplus: number | null  // PRIMARY display value — Mo's custom field
  amount: number | null            // HubSpot standard field — stored but not displayed
  closeDate: Date | null
  lastActivityDate: Date | null    // notes_last_updated
  stageEnteredAt: Date | null      // hs_v2_date_entered_current_stage — staleness basis
  lastModified: Date | null        // hs_lastmodifieddate — delta sync filter
  contactCount: number             // num_associated_contacts
  openTaskCount: number | null     // may require Layer 2 — TBD
  propertyAddress: string | null   // properties_address
  county: string | null
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

3. **Approval boundary** *(partial — M6)* — AI and automation suggestions surface as rows in `internal_tasks` with `source: 'ai_detected'`. Mo accepts or dismisses them. No action is taken without explicit approval.

These three boundaries are sufficient to integrate any future automation layer. Do not add infrastructure beyond this until the automation system's actual shape is known.

---

## Environment Variables

```
DATABASE_URL=             # Neon connection string
HUBSPOT_ACCESS_TOKEN=     # HubSpot Private App token
DASHBOARD_PASSWORD=       # Simple password auth
ANTHROPIC_API_KEY=        # Claude API key
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
- `hubspot_url` — constructed as `https://app.hubspot.com/contacts/{portalId}/deal/{hubspot_id}`

This is sufficient to render the full attention queue without any Layer 2 data, once field names are confirmed.

### Layer 2 — Deep & Expensive (Per Deal, On Demand)

Only triggered when Mo explicitly clicks **"Load Full Detail"** in the deal detail panel. The panel always shows Layer 1 data first. Mo decides whether to pull Layer 2 for a given deal.

Before pulling, show a warning: *"This will use approximately 30–50 HubSpot API calls. Continue?"*

Pulls:
- Notes (full text, author, timestamp)
- Emails (subject, body snippet, sender, direction, timestamp)
- Calls (outcome, duration, notes, timestamp)
- Tasks (title, status, due date, assigned to)
- Contacts (all linked, full custom properties + all phone field variants merged)
- Documents/attachments (if API allows)

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
  last_activity_date  TIMESTAMPTZ,    -- notes_last_updated
  stage_entered_at    TIMESTAMPTZ,    -- hs_v2_date_entered_current_stage — USE for staleness rules
  last_modified       TIMESTAMPTZ,    -- hs_lastmodifieddate — use for delta sync
  contact_count       INT DEFAULT 0,  -- num_associated_contacts
  task_count          INT DEFAULT 0,  -- may require Layer 2 — TBD
  open_task_count     INT DEFAULT 0,  -- may require Layer 2 — TBD
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
  id             SERIAL PRIMARY KEY,
  deal_hubspot_id TEXT REFERENCES deals(hubspot_id),
  type           TEXT, -- note | email | call | task
  body           TEXT,
  sender         TEXT,
  direction      TEXT, -- inbound | outbound
  timestamp      TIMESTAMPTZ,
  metadata       JSONB,
  raw_payload    JSONB,          -- full HubSpot engagement response
  synced_at      TIMESTAMPTZ DEFAULT NOW()
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
  id                   SERIAL PRIMARY KEY,
  deal_hubspot_id      TEXT REFERENCES deals(hubspot_id),
  summary_json         JSONB NOT NULL,
  generated_at         TIMESTAMPTZ DEFAULT NOW(),
  activity_count_at_gen INT,
  is_stale             BOOLEAN DEFAULT FALSE
);
```

Summary JSON shape:
```json
{
  "current_status": "...",
  "last_meaningful_activity": "...",
  "blockers": ["...", "..."],
  "who_needs_something": "...",
  "suggested_next_step": "...",
  "mo_action_required": true,
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
  deal_hubspot_id TEXT REFERENCES deals(hubspot_id), -- nullable
  title           TEXT NOT NULL,
  notes           TEXT,
  status          TEXT DEFAULT 'open', -- open | done
  due_date        DATE,
  category        task_category DEFAULT 'other',
  source          TEXT, -- manual | ai_detected
  created_at      TIMESTAMPTZ DEFAULT NOW(),
  completed_at    TIMESTAMPTZ
);
```

### `document_checklist` — Per-deal document tracking

```sql
CREATE TYPE document_type AS ENUM (
  'property_profile', 'tax_sale_deed', 'recovery_agreement',
  'government_id', 'death_certificate', 'marriage_certificate',
  'probate_records', 'will', 'heirship_docs', 'attorney_packet', 'other'
);

CREATE TABLE document_checklist (
  id              SERIAL PRIMARY KEY,
  deal_hubspot_id TEXT REFERENCES deals(hubspot_id),
  document_type   document_type NOT NULL,
  label           TEXT, -- custom label for 'other' type
  status          TEXT DEFAULT 'unknown', -- unknown | present | missing | not_required
  ai_inferred     BOOLEAN DEFAULT FALSE,
  confirmed_by_user BOOLEAN DEFAULT FALSE,
  source_note     TEXT,
  last_checked_at TIMESTAMPTZ DEFAULT NOW()
);
```

### `product_roadmap` — In-app editable

```sql
CREATE TABLE product_roadmap (
  id          SERIAL PRIMARY KEY,
  version_tag TEXT NOT NULL, -- 'v2', 'v3', 'v4'
  title       TEXT NOT NULL,
  description TEXT,
  status      TEXT DEFAULT 'idea', -- idea | planned | in_progress | done
  created_at  TIMESTAMPTZ DEFAULT NOW(),
  updated_at  TIMESTAMPTZ DEFAULT NOW()
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
stage_stale_new_case              = 0        (no staleness rule — document check instead)
stage_stale_ready_for_outreach    = 5        (business days)
stage_stale_attempted_contact     = 7
stage_stale_contact_made          = 5
stage_stale_follow_up_needed      = 5
stage_stale_engaged_interested    = 3
stage_stale_agreement_sent        = 2
stage_stale_signed_in_progress    = 5
stage_stale_letter_outreach       = 14
sync_schedule_hours               = 13,15,17,19    (UTC — equals 9,11,13,15 Eastern)
ai_summary_lookback_days          = 28
```

Note: `layer2_auto_pull_stages` removed — Layer 2 is never auto-pulled. All Layer 2 is on-demand only.

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

---

## UI Structure

### Visual Style
- Desktop only (large screen optimized)
- Clean executive: white background, generous spacing, minimal noise
- Color system: Red = urgent action, Yellow = warning, Green = healthy, Blue = informational, Gray = snoozed/inactive

### Navigation

All routes are password-protected. `/` redirects to `/login` if unauthenticated.

- `/login` — Password gate, redirects to `/dashboard` on success
- `/dashboard` — Attention queue home
- `/dashboard/tasks` — Mo's internal task list
- `/dashboard/settings` — Configurable thresholds
- `/dashboard/roadmap` — In-app product roadmap
- `/dashboard/drift` — Schema drift monitor (future — see README.md)

### Dashboard Home

**Top bar:**
```
[Last synced: 5 minutes ago]  [↻ Refresh]  [✦ Daily Briefing]
```

**Summary cards row:**
```
[🔴 5 Need Attention]  [🟡 3 Snooze Expired]  [📋 2 Mo Action Required]  [📄 4 Docs Missing]
```

**Attention groups (each collapsible):**
- 🔴 Mo Action Required
- 🔴 Snooze Expired
- 🔴 Agreement Sent — No Follow-Up
- 🟡 Signed/In Progress — No Recent Activity
- 🟡 Missing Contact Info
- 🟡 Missing Setup Documents (New Cases)
- 🟡 Stale — [Stage Name]
- 🔵 Letter Outreach — Keep Moving
- ⬜ Healthy Deals *(collapsed by default — all deals with no active issues)*

**Deal card (within each group):**
```
[Stage badge]  BREVARD - 2671 San Filippo Dr SE - JOHN THOMPSON ($33K)
Owner: Marwa Yasmeen  •  Last activity: 12 days ago
⚠ Reason: No activity for 12 days (threshold: 7 days)
[View details]  [Snooze]
```

### Deal Detail Panel (slide-in from right)

```
[← Back]                                    [Open in HubSpot ↗]

BREVARD - 2671 San Filippo Dr SE - JOHN THOMPSON ($33K)
Stage: Follow-Up Needed  •  Owner: Marwa Yasmeen
County: Brevard  •  Parcel: 29 3732-GU-1181-4  •  Tax Sale: 02/19/2026

[Generate AI Summary]          [Snooze this case]

─────────────────────────────────────────────────────────
DOCUMENT CHECKLIST
✅ Property Profile        ✅ Tax Sale Deed         ⚠ Recovery Agreement
❓ Government ID           ❓ Death Certificate      ❌ Probate Records
─────────────────────────────────────────────────────────
AI SUMMARY  (generated 2 hours ago)  [↻ Regenerate]
• Current Status: Waiting for Carlton Wright to return call
• Last Meaningful Activity: Voicemail left 5/21 — also reached Alexis Wright (niece)
• Blockers: Niece said she'd forward info to heirs; no response since
• Who Needs Something: Client family needs to provide heirship documentation
• Suggested Next Step: Follow up with Alexis Wright, reference 5/21 conversation
[⚠ New activity since summary — consider regenerating]

Suggested questions:
[What documents are missing?]  [Who was last contacted?]  [Does Mo need to act?]
[Ask anything...                                                              →]
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

AI-detected tasks shown with "AI suggested — accept?" prompt.

### Settings Page

- Stage staleness thresholds (one row per stage, editable)
- AI summary lookback window (days)
- Sync log: last 10 syncs, call counts, errors

**Not in settings:** Sync schedule (lives in `vercel.json` — static, requires redeploy to change. Not a UI concern).

### Product Roadmap Page

- Sections: v2, v3, v4+, Ideas
- Each item: title, description, status badge
- "Export as Markdown" button (downloads .md file for feeding back to AI)

---

## Attention Queue Logic

### Attention Trigger Checklist

Run on every Layer 1 sync. Each deal is evaluated against all rules. Triggered deals appear in attention queue under the appropriate group.

**Stage comparisons:** Never compare against raw stage name strings. Always use normalized stage names via `stageMap` (built from `docs/research/pipeline-stages.json` during M1). Example:
```typescript
// Wrong:  deal.stage === "Agreement Sent"
// Right:  stageMap[deal.stage] === "Agreement Sent"
```

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

**Stage Stale:**
- `last_activity_date` beyond configured threshold for that stage (in business days)
- Thresholds from `thresholds.ts` (M3) or `app_settings` (M7+)
- Applied to: Ready for Outreach, Attempted Contact, Contact Made, Follow-Up Needed, Engaged/Interested, Letter Outreach

### Layer 2-Dependent Rules (M4+ — require deal_activities and deal_contacts)

These run only when Layer 2 data exists for a deal. Added after M4.

**Mo Action Required — PLACEHOLDER (M4):**
Keyword heuristics not yet validated against real note data. Implement after M1 sample notes reviewed.
Likely triggers (validate with real data):
- `deal_activities.body` contains phrases implying Mo needs to act
- Inbound email (`deal_activities.direction = 'inbound'`) with no subsequent outbound response in 48 hours

**Missing Contact Info (Layer 2 upgrade, M4):**
- All `deal_contacts` for this deal have empty `phone_numbers`
- OR all `deal_contacts` have `do_not_contact = true`
- OR all contacts `is_deceased = true` AND no other contacts

**Missing Setup Documents (M5):**
- `stageMap[deal.stage]` = "New Case"
- `document_checklist` table shows `property_profile` or `tax_sale_deed` as `missing` or `unknown`
- Requires `document_checklist` table (added in M5/M6)

---

## AI Integration

### Per-Deal Summary Prompt

```
You are analyzing a surplus funds recovery case for Horizon Recovery.

The goal is to help the owner understand: What is blocking this case, and what should happen next?

Answer in bullet-point format under these exact headings:

CURRENT STATUS
[One sentence on where this case stands right now]

LAST MEANINGFUL ACTIVITY
[Most recent significant event — not just any HubSpot log entry]

BLOCKERS
[What is preventing this case from moving forward — be specific]

WHO NEEDS SOMETHING
[Is the client, attorney, employee, or owner (Mo) waiting on someone? Who specifically?]

SUGGESTED NEXT STEP
[The single most important action to take, and who should take it]

MO ACTION REQUIRED
[Yes/No — does the owner personally need to act on something?]

DOCUMENTS LIKELY MISSING
[List any documents mentioned as missing, not yet received, or not yet sent — if none mentioned, write "None detected"]

---
Deal: {name}
Stage: {stage}
County: {county}
Amount: {amount}

Contacts:
{contact list with relationship status and deceased flag}

Activity history (last 28 days, most recent first):
{notes, emails, calls, tasks with timestamps and authors}
```

### Daily Briefing Prompt

```
You are generating a Monday morning briefing for Mo, the owner of Horizon Recovery.

Mo needs to know:
1. What happened since the last briefing?
2. What cases need his personal attention today?
3. What employee-level issues should he be aware of?
4. What business improvements or observations are worth noting?

Write in plain, direct language. Use short bullets. Be practical, not diplomatic.

---
Total active deals: {count} across {stages}

Deals needing attention (Layer 1 summary):
{list of flagged deals with reason}

High-value stage deals with recent activity (Layer 2 available):
{summaries of Engaged/Interested, Agreement Sent, Signed/In Progress deals}

Open Mo tasks:
{list of internal tasks assigned to Mo}

Note: Employee activity stats (notes/calls per person) require querying deal_activities by owner.
Add this section in M5 once deal_activities is populated. Do not include placeholder text.
```

### Cache Invalidation Strategy

- Cache per deal, stored in `ai_summaries`
- Mark `is_stale = true` when `deal.last_activity_date > ai_summaries.generated_at`
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
const deal = mapDeal(rawDeal.results[0], stageMap, ownerMap)
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
| `summary.ts` | Prompt construction contains required fields; parsed JSON matches expected schema | M5 |

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
| AI summaries | `ai_summaries` table | `is_stale = true` when `deal.last_activity_date > summary.generated_at` |
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
│   ├── middleware.ts                  # Auth cookie check — all /dashboard/* routes
│   ├── app/
│   │   ├── page.tsx                   # Redirects to /login
│   │   ├── login/page.tsx
│   │   ├── dashboard/
│   │   │   ├── layout.tsx             # Sidebar layout
│   │   │   ├── page.tsx               # Attention queue
│   │   │   ├── tasks/page.tsx
│   │   │   ├── settings/page.tsx
│   │   │   ├── roadmap/page.tsx
│   │   │   └── drift/page.tsx             # Schema drift monitor (future — not in v1)
│   │   └── api/
│   │       ├── auth/login/route.ts
│   │       ├── auth/logout/route.ts
│   │       ├── sync/layer1/route.ts
│   │       ├── sync/layer2/[id]/route.ts
│   │       ├── deals/route.ts
│   │       ├── deals/[id]/route.ts
│   │       ├── deals/[id]/snooze/route.ts
│   │       ├── deals/[id]/summary/route.ts
│   │       ├── tasks/route.ts
│   │       ├── tasks/[id]/route.ts
│   │       ├── settings/route.ts
│   │       ├── roadmap/route.ts
│   │       ├── briefing/route.ts
│   │       └── drift/route.ts          # Schema drift monitor (future — not in v1)
│   └── lib/
│       ├── hubspot/
│       │   ├── client.ts              # Rate-limited HTTP client (3 req/s cap, exponential backoff)
│       │   ├── mapper.ts              # Raw HubSpot → internal Deal/Contact/Activity types
│       │   ├── schema.ts              # M1: property/pipeline/owner schema fetcher
│       │   └── sampler.ts             # M1: one-deal deep pull, saves to docs/research/
│       ├── sync/
│       │   ├── layer1.ts              # Batch deal sync (smart + full refresh modes)
│       │   └── layer2.ts              # Per-deal sync (on demand only)
│       ├── rules/                     # Each rule = one file = one exported function
│       │   ├── index.ts               # Runs all rules, returns AttentionFlag[]
│       │   ├── staleness.ts           # Stage staleness (reads thresholds.ts)
│       │   ├── contacts.ts            # Missing contact info
│       │   ├── documents.ts           # Missing setup docs (New Case stage only)
│       │   ├── agreement.ts           # Agreement stage, no follow-up
│       │   ├── signed.ts              # Signed/In Progress, no recent activity
│       │   └── snooze.ts              # Snooze expired
│       ├── ai/
│       │   ├── client.ts              # Anthropic SDK wrapper
│       │   ├── prompts.ts             # Prompt templates (summary, briefing)
│       │   ├── summary.ts             # Build prompt → call → parse → cache in ai_summaries
│       │   └── briefing.ts            # Daily briefing generation
│       ├── db/
│       │   ├── deals.ts               # Deal queries
│       │   ├── activities.ts          # Activity queries
│       │   ├── contacts.ts            # Contact queries
│       │   ├── snoozes.ts             # Snooze queries
│       │   ├── summaries.ts           # AI summary queries
│       │   ├── tasks.ts               # Internal task queries
│       │   └── sync-log.ts            # Sync log queries + daily call count tracker
│       └── utils/
│           ├── business-days.ts       # Business days calc — must be fully unit tested
│           ├── rate-limiter.ts        # Token bucket — used only by hubspot/client.ts
│           └── thresholds.ts          # Hardcoded staleness values (replaced by app_settings in M7)
└── vercel.json                        # Cron config
```

**Modular rule:** Each `/src/lib/rules/*.ts` file exports one function. No rule imports from another rule. Adding a rule = new file + register in `index.ts`. Removing = delete + unregister. The index.ts type is:
```typescript
type AttentionFlag = {
  ruleId: string
  label: string
  severity: 'red' | 'yellow' | 'blue'
}
// index.ts: (deal: Deal, snoozes: Snooze[]) => AttentionFlag[]
```

---

## Sync Engine Design

### Refresh Strategy

**Smart sync (default):** Pull only deals with `hs_lastmodifieddate >= last_synced_at`. Faster and cheaper. Most refreshes will touch only a few deals.

**Full Refresh:** Forces re-pull of all deals regardless of modified date. Use after major HubSpot changes or when data looks wrong.

Before any Layer 2 pull, surface an estimated call count and require confirmation from Mo: *"This will use approximately X HubSpot API calls. Continue?"*

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
/api/sync/layer1          POST  -- trigger Layer 1 sync (also called by cron)
/api/sync/layer2/[id]     POST  -- trigger Layer 2 sync for one deal
/api/deals                GET   -- list deals with attention flags applied
/api/deals/[id]           GET   -- single deal with Layer 2 data if cached
/api/deals/[id]/snooze    POST  -- create snooze
/api/deals/[id]/snooze    DELETE -- remove snooze
/api/deals/[id]/summary   POST  -- generate/regenerate AI summary
/api/briefing             POST  -- generate Daily Briefing
/api/tasks                GET, POST
/api/tasks/[id]           PATCH, DELETE
/api/settings             GET, PATCH
/api/roadmap              GET, PATCH
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
