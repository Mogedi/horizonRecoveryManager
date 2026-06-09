# Horizon Manager — Domain Model

Business object definitions. Hermes reasons in these terms. Database table names are in parentheses where they differ.

---

## Deal
*The case.* One surplus funds recovery claim, tracked from discovery to payout.

**Key fields:** `hubspotId`, `name` (format: "COUNTY — Address — Owner Name"), `stage` (ID — resolve via stageMap), `amount` (USD surplus value), `stageEnteredAt` (when it entered current stage), `lastActivityDate` (when anything last happened), `county`, `parcelId`, `taxSaleDate`

**Relationships:** has many Contacts, DealActivities, ActivityEvents, Tasks, one Snooze (active), one AiSummary

**Note:** `stage` is always an ID. Resolve to a name via `stageMap` from `app_settings`. Never compare against raw stage name strings.

---

## Contact
*A person linked to a deal* — the property owner, an heir, a spouse, or the attorney handling the filing.

**Key fields:** `name`, `contactType` (owner / heir / attorney / spouse), `ownershipStatus`, `isDeceased`, `doNotContact`, `phoneNumbers` (E.164 array), `emailList` (array), `address`/`city`/`state`/`zip`

**DB table:** `deal_contacts`

**Note:** Phone numbers are sourced from 11 HubSpot field variants and validated in the mapper. Always use the `phoneNumbers` array, never individual raw fields.

---

## DealActivity
*A HubSpot activity* — note, email, call, or task logged in HubSpot. This is Layer 2 data (on-demand only).

**Key fields:** `type` (note/email/call/task), `body`, `authorOwnerId` (who logged it — use for employee stats), `direction` (inbound/outbound), `timestamp`, `metadata`

**DB table:** `deal_activities`

**Note:** HubSpot emails and calls stored here are separate from JustCall call events (which go to `ActivityEvent`). Both appear together in the unified case Story.

---

## ActivityEvent
*A unified event from any external source* — primarily JustCall calls and Gmail emails.

**Key fields:** `source` (JUSTCALL / GOOGLE / HUBSPOT), `externalId` (dedup key), `direction`, `happenedAt`, `fromNumber`, `toNumber`, `outcome` (answered/voicemail/no_answer/busy), `type` (call/email), `metadata` (email: from/to/subject; call: agent, recording URL)

**DB table:** `activity_events`

**Note:** JustCall calls here have transcripts in `CallTranscript`. Gmail emails here appear in the Emails tab of DealPanel, grouped by counterparty.

---

## CallTranscript
*The transcript and classification for a single JustCall call recording.*

**Key fields:** `classification` (live/voicemail/disconnected/unknown/error), `transcript` (Whisper output), `summary` (Claude 1-2 sentence summary for live calls), `durationSecs`

**Relationship:** one-to-one with ActivityEvent (JustCall calls only)

**Note:** `classification='error'` rows are permanent tombstones — they mark calls that will never be transcribed (413 audio too large, missing recording URL). They prevent infinite backfill loops.

---

## StoryDay
*One calendar day of case activity, grouped and categorized for human scanning.*

**This is a view model — not a DB table.** Built on demand by `buildStoryDays()` in `src/lib/case/story.ts`.

**Key fields:** `date` (YYYY-MM-DD in ET), `categories` (deduplicated list of CaseEventCategory), `eventCount`, `latestEventSummary`, `events` (expanded on click)

**Categories:** `attorney_activity` / `client_contact` / `document_received` / `internal_note` / `follow_up` / `outreach_attempt` / `uncategorized`

**Why it matters:** Humans and Hermes read the case through StoryDays, not raw events. "Attorney Activity · Client Contact" on a given day is more useful than "2 calls, 1 email, 1 note."

---

## CurrentState
*The operational state of a case right now — health, blockers, next action.*

**This is a view model — not a DB table.** Built on demand by `buildCurrentState()` in `src/lib/case/state.ts`, currently sourced from `AiSummary`.

**Key fields:** `status` (one-sentence summary), `health` (active/waiting/blocked/on_track/unknown), `blocker`, `nextAction`, `lastMeaningfulActivity`, `openTaskCount`, `source` (ai/human)

**Note:** Today this reads from `AiSummary`. Future: human edits and CaseFacts will also contribute.

---

## AiSummary
*A Claude-generated structured summary of a deal.* Generated on demand, never auto-regenerated.

**Key fields (summaryJson):** `current_status`, `last_meaningful_activity`, `blockers` (array), `who_needs_something`, `suggested_next_step`, `mo_action_required` (boolean), `documents_mentioned_missing` (array)

**DB table:** `ai_summaries` — one row per deal, upserted on regeneration

**Note:** `mo_action_required: true` surfaces the deal in the attention queue's top group. The AI — not keyword heuristics — makes this determination.

---

## Task
*An internal action item.* Replaced Trello. Can be linked to a deal or standalone.

**Key fields:** `title`, `notes`, `status` (open/done), `dueDate`, `category` (case/business/vendor/legal/networking/other), `dealHubspotId` (nullable)

**DB table:** `internal_tasks`

---

## Snooze
*An explicit "I'm aware, not now" state set by Mo.* While active, blocks all attention rules for that deal.

**Key fields:** `category` (waiting_on_attorney / waiting_on_county / waiting_on_client / waiting_on_documents / waiting_on_probate / filed_normal_wait / other), `freeformNote`, `snoozeUntil`

**DB table:** `deal_snoozes` — active snooze = most recent row where `snoozeUntil >= today AND wokeAt IS NULL`

---

## PhoneNumber
*E.164 normalized phone → deal mapping.* Used to match incoming JustCall calls to deals when JustCall provides no deal ID.

**Key fields:** `numberE164` (+14045551234 format), `dealHubspotId`, `status` (active/disconnected/invalid/unknown)

**DB table:** `phone_numbers` — populated from `deal_contacts.phoneNumbers` during Layer 2 sync

---

## SyncSource
*Integration registry.* One row per external data source. Gates: check `isActive` before syncing.

**Rows:** HUBSPOT (active), JUSTCALL (active), GOOGLE (active — sample done, full available)

**DB table:** `sync_sources`
