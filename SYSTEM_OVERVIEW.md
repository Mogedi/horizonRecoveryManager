# Horizon Manager — System Overview

## Start Here (Reading Order)

1. **SYSTEM_OVERVIEW.md** ← you are here — what this is, major systems, sources of truth
2. **CURRENT_STATE.md** — what's running, what's deferred, active priorities
3. **docs/DOMAIN_MODEL.md** — business object definitions (Deal, Contact, StoryDay, etc.)
4. **CLAUDE.md** — module map, code boundaries, key constants

---

## What Horizon Manager Is

Horizon Manager is the internal operating system for Horizon Recovery LLC's surplus funds recovery practice. It aggregates case data from HubSpot, JustCall, Gmail, and Google Drive into a unified platform — and surfaces what needs Mo's attention right now.

It is not a CRM. HubSpot is the CRM. Horizon Manager is the intelligence layer on top.

**Read-only for HubSpot.** The dashboard reads from HubSpot but never writes to it. HubSpot is the source of truth for deal and contact data.

---

## What the Business Does

Horizon Recovery identifies individuals who are owed surplus funds after tax sales and unclaimed property processes, then helps them recover those funds.

**Primary practices:**
- Georgia tax sale surplus recovery
- Georgia unclaimed property
- Florida tax overage (expanding)

**Typical case lifecycle:**
```
New Case → Ready for Outreach → Attempted Contact → Contact Made
    → Agreement Sent → Signed / In Progress
    → [Attorney files] → [County responds] → Closed – Paid
```

**Active pipeline:** ~150 total cases, ~18–30 active at any time (majority in terminal stages).

---

## Major Systems

| System | Role | Source of Truth For |
|---|---|---|
| HubSpot | CRM | Deal stage, contact info, case amounts, activity notes |
| JustCall | Phone calls | All outbound call history, call outcomes |
| Google Drive | Case documents | Tax sale deeds, probate docs, certificates |
| Gmail | Email threads | Attorney correspondence, contact communication |
| Horizon Manager | Unified data layer | Aggregated timeline, attention queue, transcripts, tasks |
| Hermes | Agentic execution layer | Research, drafts, recommendations |

---

## Sources of Truth

When data conflicts between systems, trust these:

| Data type | Trust this system |
|---|---|
| Deal stage, contact names, amounts | HubSpot |
| Call history, call outcomes, durations | JustCall → `activity_events` table |
| Case documents | Google Drive |
| Email threads | Gmail → `activity_events` table |
| Unified case timeline | Horizon Manager DB (`activity_events` + `deal_activities`) |
| Call transcripts and classifications | Horizon Manager DB (`call_transcripts` table) |
| Mo's tasks and snoozes | Horizon Manager DB (internal — not in HubSpot) |
| Case operational state (status, health, blockers, next action) | Horizon Manager DB (`case_analyses` — append-only AI-interpretation layer; latest `triage` row wins) |

---

## Team

| Person | Role |
|---|---|
| Mo | Owner — primary Horizon Manager user, decision-maker |
| Marwa Yasmeen | Research, outreach, data entry (HubSpot deal owner ≠ who works case) |
| Ma Kathleen Dabu | Phone calls, contact attempts, case notes |

---

## Hermes — Agentic Layer

External Discord-driven agent on a separate VPS. **Hybrid access:** read-only Neon role for reads;
HTTP API with a scoped `HERMES_TOKEN` for writes. Every agent write is audited (before/after),
idempotent (`Idempotency-Key` header), and revocable via a kill switch
(`app_settings.agent_writes_enabled` → 423 when off).

**Hermes can (Phase 1, wired):**
- Read all case data (direct read-only DB)
- Write AI **interpretation** to the append-only `case_analyses` layer (drives `CurrentState`)
- Create/complete/delete internal tasks; snooze/unsnooze cases
- Trigger the server-side summary regeneration

**Hermes can (later phases):**
- Trigger syncs / cron jobs (Phase 3 — sync routes not agent-enabled yet)
- Make code/UI changes shipped to Vercel via git push (Phase 4 — behind a Discord confirm)

**Hermes cannot (hard boundaries):**
- Write to HubSpot (read-only permanently — no `src/lib/hubspot/actions.ts`)
- Write business facts (deals, contacts, activities) — interpretation only
- Overwrite a prior analysis (`case_analyses` is append-only)
- Send emails or deploy code without Mo's Discord confirm
- Move money or initiate financial transactions

---

## High-Level Architecture

```
HubSpot    JustCall    Gmail    Google Drive
    \          |          |         /
     \         ↓          ↓        /
      ──── Horizon Manager ────────
           (Unified Case Model)
                   ↓
                Hermes
         (Reasoning + Actions)
                   ↓
     Emails / Research / Tasks / Workflows
```
