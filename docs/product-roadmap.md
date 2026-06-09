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

## Phase 2 — Complete ✅

### M9–M13: Multi-Source Intelligence Layer

All shipped. See `docs/gameplan.md` for full build history.

| What shipped | Status |
|---|---|
| Multi-source DB (`activity_events`, `phone_numbers`, `sync_sources`, `PIPELINE_GROUP`) | ✅ Done |
| JustCall integration — full history, phone registry, sample + full sync | ✅ Done |
| Call transcription pipeline (Whisper → Claude, `call_transcripts` table) | ✅ Done (unplanned) |
| Analytics layer (`deal_enriched` view, `/dashboard/pipeline`, `/dashboard/contacts`) | ✅ Done (unplanned) |
| Deal Workspace Redesign — 7-tab DealPanel, case business object layer | ✅ Done |
| Google Workspace — Gmail sync, email → deal matching, Settings UI | ✅ Done |

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
| Cross-source deal reconciliation / AI Case Manager | 2026-06 | See vision below |

### Vision: AI Case Manager

The idea is a per-deal "source of truth" reconciliation that continuously checks whether all data sources agree.

**Sources to compare:**
- HubSpot deal record (address, parcel ID, contact names, sale date, stage)
- Tax Sale Deed (extracted via doc verification)
- PropertyRadar profile (extracted via doc verification)
- HubSpot activity notes (case manager updates, attorney correspondence)

**What it produces:**
- A side-by-side field comparison table: "HubSpot says parcel 123 — Deed says 123 ✓ — PropertyRadar says 123 ✓"
- A list of discrepancies: "HubSpot contact is Linda Brown, deed lists Linda J Brown AND Isaac S Monroe — Isaac not tracked"
- A one-paragraph case health summary: what's confirmed, what's unresolved, what needs attention next
- An "untracked parties" alert: any person named in the deed who is not a HubSpot contact

**When to run:**
- On-demand (button in deal panel) — no auto-regeneration, same rule as AI summaries
- Possibly triggered when new notes come in with certain keywords (attorney update, filing, etc.) — deferred

**Why it's close:**
- Doc verification already extracts deed + PropertyRadar fields and compares them
- HubSpot deal fields are already in the DB
- The missing piece is a comparison pass between `consolidatedData` and `deal.*` fields, surfaced as a structured table rather than free-text mismatches
- Owner tracking check (tax lien debtors vs. contacts) is already built as of 2026-06

**Estimated effort:** ~4 hours to add cross-source field comparison table + case health summary. Notes-triggered re-check is larger (needs event listener on HubSpot notes sync).

---

*Last updated: 2026-06-09 (M9–M13 complete, Hermes integration active)*
*Strategic direction: AI-first case operating system — Hermes as reasoning + action layer on top of Horizon Manager*
