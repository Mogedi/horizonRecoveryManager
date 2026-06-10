# Horizon Intelligence Dashboard — Build History & Architecture

## North Star

The dashboard answers one question: **"What needs Mo's attention right now?"**

HubSpot is the source of truth. The dashboard adds an intelligence layer on top — not a CRM replacement.

**Read-only permanently.** No HubSpot writes — ever. No `src/lib/hubspot/actions.ts` without Mo's explicit approval.

---

## What's Running (All Complete ✅)

### Phase 1 — Foundation (M0–M8)

Layer 1 sync (all 150 deals, once daily on the Vercel Hobby plan; manual anytime), Layer 2 on-demand, attention queue with 8 flag groups, deal detail panel, per-deal AI summaries, internal task list, daily briefing modal, settings page with configurable staleness thresholds.

See `docs/archive/milestones-m0-m8.md` for full history.

---

### M9 — Multi-Source DB Foundation ✅

**What it built:** `activity_events` (unified multi-source event log), `phone_numbers` (E.164 registry), `sync_sources` (integration registry), `pipeline_states` (created but unused — PIPELINE_GROUP constant proved sufficient), `PIPELINE_GROUP` constant mapping stage IDs to setup/outreach/case_mgmt/terminal.

---

### M10 — JustCall Integration ✅

**What it built:** JustCall API client (18 req/min cap), E.164 normalizer, `PhoneProvider` interface, `syncJustCallSample()` + `syncJustCallFull()`, `/api/sync/justcall` route, JustCall status card in Settings.

---

### M11 — JustCall Full Pull + Call Transcription + Analytics ✅

**What it built:** Full JustCall history loaded (7,110 call events, 2,543 phone numbers). Call transcription pipeline: Whisper → Claude classification → `call_transcripts` table (2,432 calls classified). `checkCallsExhausted` rule (7+ unique call days). Analytics layer: `deal_enriched` PostgreSQL view, portfolio analytics page (`/dashboard/pipeline`), contact quality page (`/dashboard/contacts`).

**Deferred (will not build):** `call_due_today` rule, outreach staleness rule refactor, call cadence settings UI.

---

### M12 — Deal Workspace Redesign ✅

**What it built:** Business object layer (`src/lib/case/`): `CaseEvent`, `StoryDay`, `CurrentState`, `categorizeEvent()`, `buildStoryDays()`, `buildCurrentState()`. DealPanel redesigned into 7-tab workspace: Story, Contacts, Calls, Emails, Notes, Documents, Tasks. `LayerTwoGate` component. Tab count badges. DealPanel reduced from 1,277 → ~310 lines. 606 tests passing.

---

### M13 — Google Workspace Integration ✅

**What it built:** Google OAuth client, `syncGmailSample()` + `syncGmailFull()`, email → deal matching via `deal_contacts.emailList`, 50 Gmail emails stored (sample complete). Google sync card in Settings with two-step full sync confirmation. Drive indexing (`drive-index.ts`), document classification (`doc-classifier.ts`).

---

## Agent Protocol

When working on new features:

1. Check `CURRENT_STATE.md` for active priorities
2. Check `CLAUDE.md` for module map, boundaries, and key constants
3. Run `npm test` before every commit — never commit if tests fail
4. Stop and report to Mo: missing credentials, unclear requirements, destructive changes, failing tests with unclear root cause

---

## Dependencies (Complete Chain)

```
M0–M8 ✅ → M9 ✅ → M10 ✅ → M11 ✅ → M12 ✅ → M13 ✅
```

**Stage-to-Pipeline Mapping** (still accurate — do not hardcode):

| Stage | Pipeline Group |
|---|---|
| New Case, Ready for Outreach | `setup` |
| Attempted Contact, Contact Made, Follow-Up Needed, Engaged/Interested, Letter Outreach | `outreach` |
| Agreement Sent, Signed / In Progress | `case_mgmt` |
| Dead, DNC, Blocked, Exhausted, Closed-Paid, F, More Research Need | `terminal` |

Stage IDs → `docs/research/pipeline-stages.json`. Never compare against raw stage name strings.
