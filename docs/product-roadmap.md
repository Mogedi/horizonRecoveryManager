# Horizon Recovery Operations Dashboard — Product Roadmap

*This document is designed to be edited by Mo and fed back to an AI to plan future versions.*
*Format: Update status, add new ideas, export from the dashboard, paste into Claude.*

---

## North Star

The dashboard answers one question: **"What needs Mo's attention right now?"**

HubSpot remains the source of truth. This tool adds an attention intelligence layer on top — not a CRM replacement, not a reporting tool, not a data warehouse. Just owner attention management.

---

## Milestone 3 Target — The Weekend Demo

The smallest build that proves the dashboard is materially better than using HubSpot alone.

**Pages:** `/login`, `/dashboard` (attention queue), deal detail panel (slide-in)

**Database tables:** `deals`, `deal_activities`, `deal_contacts`, `deal_snoozes`, `sync_log`

**Sync jobs:** Layer 1 (all deals, scheduled + manual), Layer 2 (per deal, on-demand)

**API routes:** `/api/auth/login`, `/api/sync/layer1`, `/api/sync/layer2/[id]`, `/api/deals`, `/api/deals/[id]`, `/api/deals/[id]/snooze`, `/api/deals/[id]/summary`

**User actions:**
1. Log in with shared password
2. See all deals grouped by attention reason — no filtering required
3. Click "Refresh" to trigger Layer 1 sync manually
4. Click any deal → see contacts + full activity timeline
5. Pull Layer 2 for one deal (on demand)
6. Generate AI summary from Layer 2 data
7. Snooze a deal with category + date → deal disappears from queue

**Success criteria:** Mo opens the dashboard and within 60 seconds knows what needs his attention. He can view a deal's full history without clicking through HubSpot tabs. He can snooze a case that's in normal attorney wait time. That's it.

**Deferred from Milestone 3:** Settings UI (hardcode thresholds), internal tasks, document checklist, in-app roadmap, Daily Briefing, `ai_summaries` / `internal_tasks` / `document_checklist` / `product_roadmap` / `app_settings` tables.

---

## P0 — Must Build (Core Dashboard)

| Feature | Status | Notes |
|---|---|---|
| HubSpot Layer 1 sync (all deals, scheduled) | Planned | 4x daily + manual refresh |
| Attention queue by issue type | Planned | Grouped, color-coded, collapsible |
| Deal detail panel with activity timeline | Planned | Slide-in, no page navigation |
| Layer 2 on-demand pull (per deal) | Planned | Activities + contacts |
| Per-deal AI summary (bullet format) | Planned | 7 structured fields via Claude API |
| Snooze with structured categories | Planned | Removes deal from queue until wake date |
| Internal task list (Trello replacement) | Planned | Case-linked + general tasks |
| Password authentication | Planned | Shared password — Login → Dashboard |
| Vercel deployment | Planned | |

---

## P1 — High Value

Build after P0 is stable and Mo is using it daily.

| Feature | Status | Notes |
|---|---|---|
| Daily Briefing button | Planned | AI-generated morning summary |
| Mo Action Required detection | Planned | Keyword heuristics on activity text |
| Waiting on Attorney tracking | Planned | Snooze category + visibility |
| Accountability tracking | Idea | Employee activity visible in Daily Briefing |
| Business improvement tracker | Idea | Capture and track operational improvement ideas |
| Stage staleness thresholds (configurable) | Planned | Settings page — not in Milestone 3 |
| Document checklist (manual + AI-inferred) | Planned | Per-deal document status |
| In-app Product Roadmap page | Planned | Editable + exportable as Markdown |

---

## P2 — Nice To Have

Meaningful extensions, defer until P0 + P1 are proven.

| Feature | Status | Notes |
|---|---|---|
| Google Drive integration | Idea | Pull file list from linked Drive folder per deal |
| HubSpot write-back | Idea | Add notes, move stages, create tasks from dashboard |
| Attorney workflow enhancements | Idea | Filing status, county deadlines, attorney contact DB |
| Email notification delivery | Idea | Snooze expired / Mo Action Required via email |

---

## P3 — Future

Not in scope for this project. Captured for awareness only.

| Feature | Status | Notes |
|---|---|---|
| Browser automation | Idea | Puppeteer/Playwright to fill HubSpot API gaps |
| Employee portal | Idea | Scoped views for Marwa, Kathleen |
| Hub landing page | Idea | Future: link this dashboard from a Horizon tools hub at tools.horizonrecovery.com |
| User accounts | Idea | Individual logins per employee |
| Analytics & reporting | Idea | Pipeline trends, win rates, revenue by county |

---

## Growth Ideas (Unversioned)

Observations and ideas captured during day-to-day use. Review periodically.

| Idea | Captured | Notes |
|---|---|---|
| A2P texting fix | 2026-06 | Submit support ticket to fix text messaging |
| Website update needed | 2026-06 | Track as internal task |
| Skip trace integration | 2026-06 | Pull phone numbers from BeenVerified or FastPeople API instead of manual |
| Attorney email template generator | 2026-06 | AI drafts attorney outreach based on deal context |
| Case type field in HubSpot | 2026-06 | Custom property: living_owner, deceased_owner, heir_case, probate, spouse_claim |
| Surplus amount vs fee tracking | 2026-06 | Track expected fee separately from surplus amount |
| Auto-follow-up reminder | 2026-06 | If Agreement Sent and no activity in 2 days, auto-create a task |
| Daily Briefing email delivery | 2026-06 | Send briefing to Mo's email at 8am if dashboard isn't opened |

---

*Last updated: 2026-06-06*
*To update: Edit this file or use the in-app Roadmap page, then export and feed back to Claude.*
