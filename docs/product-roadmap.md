# Horizon Recovery Operations Dashboard — Product Roadmap

*This document is designed to be edited by Mo and fed back to an AI to plan future versions.*
*Format: Update status, add new ideas, export from the dashboard, paste into Claude.*

---

## North Star

The dashboard answers one question: **"What needs Mo's attention right now?"**

HubSpot remains the source of truth. This tool adds an attention intelligence layer on top — not a CRM replacement, not a reporting tool, not a data warehouse. Just owner attention management.

---

## Milestone 3 — Shipped ✅

**What shipped:** Attention queue with real-time flag evaluation. Collapsible groups (Agreement No Follow-Up, Stage Stale, Signed No Activity, No Contacts, Snoozed, Healthy). Refresh / Sync Now / Force Refresh buttons. Last synced timestamp. 59 tests passing.

**What M3 does NOT include:** Deal detail panel, Layer 2, snooze UI, AI summaries. Those are M4–M5.

## Milestone 4 Target — The First Usable Tool

The first version Mo can actually use daily.

**New in M4:** Deal detail panel (slide-in), Layer 2 on-demand pull, snooze UI.

**User actions added:**
1. Click any deal → Layer 1 detail panel opens instantly (name, stage, amount, address, county, parcel, tax sale date)
2. "Open in HubSpot" link from panel
3. "Load Full Detail" → timeline (calls, notes, emails, tasks) + contacts appear
4. Snooze a deal: category + date + optional note → deal disappears from queue

**Success criteria:** Mo can open any deal and see its full history without leaving the dashboard. He can snooze cases in normal attorney wait time so they stop polluting the queue.

---

## P0 — Must Build (Core Dashboard)

| Feature | Milestone | Status | Notes |
|---|---|---|---|
| HubSpot Layer 1 sync (all deals, scheduled) | M2c | ✅ Done | 4x daily + manual refresh |
| Attention queue by issue type | M3 | ✅ Done | Grouped, color-coded, collapsible |
| Password authentication | M2a | ✅ Done | Shared password |
| Deal detail panel with activity timeline | M4 | Planned | Slide-in, Layer 1 instant + Layer 2 on-demand |
| Layer 2 on-demand pull (per deal) | M4 | Planned | Activities + contacts |
| Snooze with structured categories | M4 | Planned | Removes deal from queue until wake date |
| Per-deal AI summary (bullet format) | M5 | Planned | 7 structured fields via Claude API |
| Internal task list (Trello replacement) | M6 | Planned | Case-linked + general tasks |
| Daily Briefing | M6 | Planned | AI-generated morning summary |
| Configurable staleness thresholds | M7 | Planned | Settings page — no code deploy needed |
| Vercel deployment | M8 | Planned | Custom domain via Cloudflare |

---

## P1 — High Value

Build after P0 is stable and Mo is using it daily.

| Feature | Status | Notes |
|---|---|---|
| Mo Action Required surfacing | Planned | Read from AI summary JSON — no keyword heuristics |
| Waiting on Attorney visibility | Planned | Snooze category already exists; display in UI |
| Accountability tracking | Idea | Employee activity counts in Daily Briefing (needs deal_activities data) |
| HubSpot write-back (notes, stage moves) | Idea | Phase 2 capability — `src/lib/hubspot/actions.ts` |

---

## P2 — Nice To Have

Meaningful extensions, defer until P0 + P1 are proven.

| Feature | Status | Notes |
|---|---|---|
| Document checklist | Idea | AI-inferred from notes/emails — complex, Google Drive already exists for this |
| Google Drive integration | Idea | Pull file list from linked Drive folder per deal (API not available via standard HubSpot integration) |
| Attorney workflow enhancements | Idea | Filing status, county deadlines, attorney contact DB |
| Email notification delivery | Idea | Snooze expired / Mo Action Required via email |
| In-app Product Roadmap page | Idea | An in-app editor for this file — the markdown file is sufficient |

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

*Last updated: 2026-06-07*
*To update: Edit this file or use the in-app Roadmap page, then export and feed back to Claude.*
