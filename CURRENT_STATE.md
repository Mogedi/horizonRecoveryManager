# Current State
*Last Updated: June 2026 — update this file when priorities shift or systems change*

---

## Active Systems

| System | Status |
|---|---|
| HubSpot sync | Layer 1 active (4× daily, weekdays); Layer 2 on-demand |
| Attention queue | Running — 8 flag groups, snooze system |
| JustCall integration | Full history loaded; call transcription pipeline active |
| Google Workspace | Gmail sample complete; full sync available via Settings |
| AI summaries | On-demand, per deal |
| Analytics | Portfolio + contact quality pages live |
| Deal Workspace | 7-tab DealPanel with case Story, Calls, Emails, Notes, Contacts, Documents, Tasks |

---

## Deferred (Will Not Build)

- `call_due_today` attention rule
- Outreach staleness rule refactor (call-cadence scoring)
- `pipeline_states` table population (PIPELINE_GROUP constant is sufficient)
- Call cadence settings UI

---

## Active Priorities

*Mo fills this in before pointing Hermes at a task.*

---

## What Hermes Can Rely On

- All 150 deals in DB with Layer 1 data current (syncs weekday mornings/afternoons)
- Full JustCall call history with Whisper transcripts and Claude classifications
- Contact phone registry (E.164, populated from HubSpot contacts)
- Gmail emails matched to deal contacts (sample complete; full available via Settings)
- Per-deal AI summaries — generate on demand: `POST /api/deals/[hubspotId]/summary`
- Internal tasks: `GET /api/tasks`, `POST /api/tasks`, `PATCH /api/tasks/[id]`
- Case story (StoryDay[]): `GET /api/deals/[hubspotId]/story`
- Outreach matrix (calls per contact): `GET /api/deals/[hubspotId]/outreach`
- Deal list with attention flags: `GET /api/deals`
