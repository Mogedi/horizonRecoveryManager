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

---

## Team

| Person | Role |
|---|---|
| Mo | Owner — primary Horizon Manager user, decision-maker |
| Marwa Yasmeen | Research, outreach, data entry (HubSpot deal owner ≠ who works case) |
| Ma Kathleen Dabu | Phone calls, contact attempts, case notes |

---

## Hermes — Agentic Layer

**Hermes can:**
- Research probate requirements and county-specific filing rules
- Draft attorney outreach emails
- Recommend attorneys for specific counties
- Review case files and summarize status
- Suggest next actions for stuck cases
- Create internal tasks
- Update Horizon Manager's internal records (tasks, notes)

**Hermes cannot:**
- Write to HubSpot (read-only permanently)
- Send emails or messages without Mo's approval
- Modify legal documents without review
- Move money or initiate financial transactions
- Change case status without approval

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
