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

## Milestone 4 — Shipped ✅

**What shipped:** Deal detail panel (slide-in from right). Layer 2 on-demand pull with call range confirmation. Activity timeline (calls, notes, emails, tasks). Contacts with phone/email/DNC/deceased. Snooze UI (7 categories, date picker, optional note). Snooze history. "Remove snooze" button. Property address in panel header. 62 tests passing.

## Milestone 5 — Shipped ✅

**What shipped:** Per-deal AI summary via Claude API. 7-field JSON structure (status, last activity, blockers, who needs something, suggested next step, mo_action_required, missing documents). Stale badge when new activity arrives after summary generation. Mo Action Required group on dashboard home (reads from AI summary — no keyword heuristics). 72 tests passing.

## Milestone 6 — Shipped ✅

**What shipped:** Internal task list replacing Trello. Tasks grouped by category (case/business/vendor/legal/networking/other). Case-linked tasks with one-click deal navigation. Daily Briefing modal — AI-generated prose covering attention queue, open tasks, employee activity. Task prompt after AI summary when `mo_action_required: true` (pre-fills suggested next step). Sidebar task count badge. 76 tests passing.

## Milestone 7 — Shipped ✅

**What shipped:** Configurable staleness thresholds via Settings page. Stage Staleness (6 stages), Activity Rules (Agreement Sent, Signed/In Progress), AI Settings (lookback window). Per-group Save buttons with dirty-check. Sync log (last 10 syncs with call counts, duration, status). Thresholds load from `app_settings` DB — changing a threshold takes effect immediately on next dashboard refresh with no code deploy. 76 tests passing.

## Milestone 8 — Shipped ✅

**What shipped:** Error boundaries on all routes. Stale data banner when last sync failed. Mobile warning overlay. "Summary unavailable" language on Anthropic failures. All empty/loading states confirmed complete. Production setup checklist (4 items remaining for Mo to complete manually).

---

## P0 — Must Build (Core Dashboard)

| Feature | Milestone | Status | Notes |
|---|---|---|---|
| HubSpot Layer 1 sync (all deals, scheduled) | M2c | ✅ Done | 4x daily + manual refresh |
| Attention queue by issue type | M3 | ✅ Done | Grouped, color-coded, collapsible |
| Password authentication | M2a | ✅ Done | Shared password |
| Deal detail panel with activity timeline | M4 | ✅ Done | Slide-in, Layer 1 instant + Layer 2 on-demand |
| Layer 2 on-demand pull (per deal) | M4 | ✅ Done | Activities + contacts, batch API reads |
| Snooze with structured categories | M4 | ✅ Done | Removes deal from queue until wake date |
| Per-deal AI summary | M5 | ✅ Done | 7 structured fields via Claude API |
| Mo Action Required surfacing | M5 | ✅ Done | Read from AI summary JSON — no keyword heuristics |
| Internal task list (Trello replacement) | M6 | ✅ Done | Case-linked + general tasks, 6 categories |
| Daily Briefing | M6 | ✅ Done | AI-generated morning summary (attention queue + tasks + employee activity) |
| Configurable staleness thresholds | M7 | ✅ Done | Settings page — no code deploy needed |
| Vercel deployment + production polish | M8 | ✅ Done (code) | Error boundaries, stale data banner, mobile warning — domain/env vars pending Mo |

---

## P1 — High Value

Build after P0 is stable and Mo is using it daily.

| Feature | Status | Notes |
|---|---|---|
| Auto-follow-up task creation | Idea | If Agreement Sent and no activity in 2 days, auto-create a `case` task on next sync — no AI needed, just a sync hook |
| Snooze category summary on dashboard | Idea | Show "3 waiting on attorney, 2 waiting on county" below the snoozed group header without expanding |
| Accountability tracking | ✅ Done in M6 | Employee activity counts in Daily Briefing |
| Waiting on Attorney visibility | ✅ Done in M4 | Visible via snooze categories in deal panel and Daily Briefing |
| HubSpot write-back (notes, stage moves) | Idea | Phase 2 capability — `src/lib/hubspot/actions.ts` — requires Mo's explicit approval before any write calls are added |

---

## P2 — Nice To Have

Meaningful extensions, defer until P0 + P1 are proven.

| Feature | Status | Notes |
|---|---|---|
| Suggested follow-up questions | Idea | Claude-generated questions based on deal context — useful but not essential for v1 |
| Document checklist | Idea | AI-inferred from notes/emails — complex, Google Drive already exists for this |
| Google Drive integration | Idea | Pull file list from linked Drive folder per deal (API not available via standard HubSpot integration) |
| Attorney workflow enhancements | Idea | Filing status, county deadlines, attorney contact DB |
| Email notification delivery | Idea | Snooze expired / Mo Action Required via email; Daily Briefing at 8am if dashboard not opened |
| Skip trace integration | Idea | Pull phone numbers from BeenVerified or FastPeople API instead of manual |

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
| Attorney email template generator | Idea | AI drafts attorney outreach based on deal context |
| Case type field in HubSpot | Idea | Custom property: living_owner, deceased_owner, heir_case, probate, spouse_claim |
| Surplus amount vs fee tracking | Idea | Track expected fee separately from surplus amount |

---

## Growth Ideas (Unversioned)

Observations and ideas captured during day-to-day use. Review periodically.

| Idea | Captured | Notes |
|---|---|---|
| A2P texting fix | 2026-06 | Submit support ticket to fix text messaging |
| Website update needed | 2026-06 | Track as internal task |

---

*Last updated: 2026-06-07 (M8 complete — all milestones shipped)*
*To update: Edit this file directly, then paste into Claude for planning next features.*
