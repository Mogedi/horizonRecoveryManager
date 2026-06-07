# Horizon Recovery Operations Dashboard — Product Roadmap

*This document tracks what has shipped and what is coming next.*
*To update: Edit this file directly, then paste into Claude for planning.*

---

## North Star

The dashboard answers one question: **"What needs Mo's attention right now?"**

HubSpot remains the source of truth. This tool adds an attention intelligence layer on top — not a CRM replacement, not a reporting tool, not a data warehouse.

**Read-only permanently.** No HubSpot writes without explicit approval. `src/lib/hubspot/actions.ts` does not exist and must not be created.

---

## Phase 1 — Complete ✅

All M0–M8 milestones shipped.

| Milestone | Status | What Shipped |
|---|---|---|
| M0 — HubSpot Setup | ✅ Done | Private App token, CRM Objects scope |
| M1 — API Research | ✅ Done | 10 raw JSON files, confirmed field names, 16 pipeline stages |
| M2 — Skeleton + DB + Sync | ✅ Done | Next.js 16, Prisma 7, Layer 1 smart sync, Layer 2 on-demand |
| M3 — Attention Queue | ✅ Done | Flagged deals grouped by issue type, business-day rules |
| M4 — Deal Detail Panel | ✅ Done | Slide-in panel, Layer 2 contacts/activities, snooze system |
| M5 — AI Summary | ✅ Done | Per-deal Claude summary, Mo Action Required surfacing |
| M6 — Tasks + Briefing | ✅ Done | Internal task list (Trello replacement), daily briefing modal |
| M7 — Settings | ✅ Done | Configurable staleness thresholds, sync log |
| M8 — Production Polish | ✅ Done | Error boundaries, stale data banner, mobile warning, 175 tests |

---

## Phase 2 — Active

### M9: Three-Pipeline DB Foundation

*Goal: Database infrastructure for multi-source event tracking.*

| Item | Status |
|---|---|
| `activity_events` table (multi-source event log) | Pending |
| `phone_numbers` table (E.164 phone registry) | Pending |
| `pipeline_states` table | Pending |
| `sync_sources` table + seed (HUBSPOT, JUSTCALL, GOOGLE) | Pending |
| `callAttemptCount` + `lastCallAttemptAt` on `deals` | Pending |
| `PIPELINE_GROUP` constant in settings.ts | Pending |
| DB layer: `activity-events.ts`, `phone-numbers.ts` | Pending |
| Migration + tests | Pending |

### M10: JustCall Sample Integration

*Goal: Pull a small sample of JustCall call records. Mo approves before full pull.*

| Item | Status |
|---|---|
| `PhoneProvider` interface | Pending |
| JustCall client (18 req/min cap) | Pending |
| E.164 phone normalizer | Pending |
| Sample sync (last 24h, max 20 records) | Pending |
| Match report (matched vs unmatched calls) | Pending |
| Settings page: JustCall sync status | Pending |
| **Mo reviews sample → approves full pull** | Blocked on sample |

### M11: JustCall Full Pull + Rules Refactor

*Goal: Full JustCall history. Replace time-based outreach rules with call cadence rules.*

| Item | Status |
|---|---|
| Phone number population from deal_contacts | Pending |
| Full JustCall historical pull (90 days) | Blocked on M10 approval |
| Phone → deal matching via phone_numbers table | Pending |
| `call_due_today` rule | Pending |
| `calls_exhausted` rule | Pending |
| `setup_incomplete` rule | Pending |
| Remove time-based staleness for outreach stages | Pending |
| New cadence settings in app_settings | Pending |
| Settings page: cadence controls replace stale controls | Pending |
| Attention queue: new flag groups | Pending |

### M12: Deal Workspace Redesign

*Goal: Replace organically grown DealPanel with principled three-pipeline layout.*

| Item | Status |
|---|---|
| Design layout (discuss with Mo first) | Pending |
| Pipeline status track (Setup → Outreach → Case Mgmt) | Pending |
| Pipeline 2 panel: JustCall call history, next call due | Pending |
| Pipeline 3 panel: agreement status, attorney status | Pending |
| Unified timeline (HubSpot + JustCall + Google) | Pending |

### M13: Google Workspace Integration

*Goal: Pull emails and calendar events into unified timeline.*

| Item | Status |
|---|---|
| Mo provides Google OAuth credentials | Blocked on Mo |
| Google client (gmail.readonly, calendar.readonly) | Pending |
| Email → deal matching via contact email | Pending |
| Populate activity_events with email events | Pending |
| Sample sync first (last 7 days, max 50 emails) | Pending |

---

## P1 — High Value (After M11 stable)

| Feature | Notes |
|---|---|
| Deal scoring / weighted priority | $45K deal stuck 14 days ≠ $3K deal stuck 14 days; weight by amount within attention groups |
| Portfolio health view | Aggregate view: how many in each stage, total value at each stage, trend vs. last week |
| Auto-follow-up task creation | If Agreement Sent + no activity 2 days → auto-create a `case` task on next sync |
| Snooze category summary | "3 waiting on attorney, 2 waiting on county" below Snoozed group header |
| Dead number detection | Mark phone_numbers.status = disconnected when JustCall logs repeated failed attempts |
| Call coverage dashboard | % of calls matched to deals, % unmatched (unknown callers or unregistered phones) |
| Employee call analytics | Calls per agent, outcomes (answered vs voicemail), busiest hours |

---

## P2 — Nice To Have

| Feature | Notes |
|---|---|
| Skip trace integration | Scaffold exists at src/lib/integrations/skip-tracing/. Pull phone numbers from BeenVerified or FastPeople |
| Document checklist | AI-inferred from notes/emails — complex, Google Drive already exists for this |
| Attorney workflow enhancements | Filing status, county deadlines, attorney contact registry |
| Email notification delivery | Snooze expired / Mo Action Required via email; Daily Briefing at 8am if dashboard not opened |
| A2P texting | SMS outreach via JustCall API (separate from call sync) |

---

## P3 — Future

| Feature | Notes |
|---|---|
| Employee portal | Scoped views for Marwa, Kathleen — call their own deals, log notes |
| User accounts | Individual logins per employee, permissions per route |
| Analytics & reporting | Pipeline trends, win rates, revenue by county, time-to-close |
| Browser automation | Puppeteer/Playwright to fill HubSpot API gaps |
| Hub landing page | Link this dashboard from tools.horizonrecovery.com |
| Multi-pipeline support | Mortgage Foreclosures pipeline, any future pipelines |
| Attorney email template generator | AI drafts attorney outreach based on deal context |

---

## Out of Scope (Permanent)

| Feature | Reason |
|---|---|
| HubSpot write-back | Read-only permanently. HubSpot is source of truth. Corrupting it is unrecoverable. |
| Auto-generated AI summaries | Manual only, forever. Cost + noise don't justify it. |
| Scheduled AI summary regeneration | Same as above. |
| In-app Product Roadmap editor | This file IS the roadmap. An in-app editor adds no value. |
| `document_checklist` table | Deferred indefinitely. Google Drive already handles this for 18 active deals. |

---

## Growth Ideas (Unversioned)

| Idea | Captured | Notes |
|---|---|---|
| A2P texting fix | 2026-06 | Submit support ticket to fix text messaging |
| Website update needed | 2026-06 | Track as internal task |
| JustCall webhook (vs polling) | 2026-06 | Webhook would give real-time call events; polling is good enough for daily cadence checks |

---

*Last updated: 2026-06-07 (M8 complete, M9 starting)*
*Strategic direction: multi-source communications intelligence via JustCall + Google Workspace*
