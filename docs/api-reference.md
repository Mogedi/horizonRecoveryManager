# API Reference — Horizon Recovery Operations Dashboard

## Vision

This dashboard uses three external API surfaces:
1. **HubSpot CRM API (v3)** — source of truth for all deal, contact, and activity data
2. **Anthropic Messages API** — generates per-deal summaries and daily briefings
3. **Vercel Cron** — triggers scheduled Layer 1 syncs

The HubSpot connector (`/src/lib/hubspot/client.ts`) wraps all HubSpot calls with rate limiting. Nothing else in the codebase calls HubSpot directly.

The mapper (`/src/lib/hubspot/mapper.ts`) translates raw API responses into internal types. Nothing downstream touches raw response shapes.

---

## APIs Used in This Project

| API | Purpose | Rate limit |
|---|---|---|
| HubSpot CRM Search — Deals | Layer 1 batch deal pull | 100 req/10s (Starter) |
| HubSpot Properties — Deals | M1: discover custom deal fields | 100 req/10s |
| HubSpot Properties — Contacts | M1: discover custom contact fields | 100 req/10s |
| HubSpot Pipelines — Deals | M1: get stage ID → name mapping | 100 req/10s |
| HubSpot Owners | M1: get owner ID → name mapping | 100 req/10s |
| HubSpot Associations | Layer 2: get contact/note/call/email/task IDs per deal | 100 req/10s |
| HubSpot Objects Batch Read — Notes | Layer 2: batch fetch all notes for a deal | 100 req/10s |
| HubSpot Objects Batch Read — Calls | Layer 2: batch fetch all calls for a deal | 100 req/10s |
| HubSpot Objects Batch Read — Emails | Layer 2: batch fetch all emails for a deal | 100 req/10s |
| HubSpot Objects Batch Read — Tasks | Layer 2: batch fetch all tasks for a deal | 100 req/10s |
| HubSpot Contacts Batch Read | Layer 2: batch fetch all contacts for a deal | 100 req/10s |
| Anthropic Messages | Generate deal summaries and daily briefings | per-token pricing |
| Vercel Cron | Schedule Layer 1 sync once daily — see vercel.json | N/A |

---

## Rate Limiter Specification

All HubSpot calls go through `/src/lib/hubspot/client.ts`. Implementation:

```
Library:          bottleneck — per-service limiters in src/lib/rate-limiters.ts
Rate:             ~3 req/s (30% of the 10 req/s Starter limit)
On limit:         Queue request, release at the next available slot
Retry on 429:     Exponential backoff with retry (see rate-limiters.ts)

Daily tracking:   Increment sync_log.api_calls_made on every request
Warning trigger:  If daily total > 60,000 → log warning, disable scheduled syncs
Hard stop:        If daily total > 75,000 → refuse all API calls, require manual override
```

---

## APIs NOT Used (Do Not Hallucinate These)

| API | Why not used |
|---|---|
| HubSpot Files API (`/files/v3`) | Manages HubSpot-hosted files only — NOT Google Drive files |
| HubSpot Engagements V1 API | Deprecated — use V3 objects API instead |
| HubSpot Timeline API | Not needed |
| HubSpot Conversations API | Not needed for Phase 1 |
| Google Drive API directly | Not in scope (Phase 1 uses manual document checklist) |

**Google Drive files linked in HubSpot:** These are shown via the Google Drive HubSpot sidebar integration and are NOT accessible through any HubSpot API endpoint. The Files API (`/files/v3`) manages files uploaded directly to HubSpot, not externally linked Drive files. Confirm this limitation in M1 by testing associations and file endpoints — if this assumption is wrong, update this doc.

---

## HubSpot API Reference

### Auth Header (all requests)
```
Authorization: Bearer {HUBSPOT_ACCESS_TOKEN}
Content-Type: application/json
```

---

### 1. CRM Search — Deals
Layer 1 batch pull. Single call returns up to 100 deals. Paginate until `paging.next` is absent.

**Endpoint:** `POST https://api.hubapi.com/crm/v3/objects/deals/search`

**Input:**
```json
{
  "filterGroups": [
    {
      "filters": [
        { "propertyName": "pipeline", "operator": "EQ", "value": "2172337854" }
      ]
    }
  ],
  "properties": [
    "dealname", "dealstage", "pipeline", "amount", "estimated_surplus",
    "hubspot_owner_id", "closedate", "notes_last_updated",
    "hs_v2_date_entered_current_stage", "hs_lastmodifieddate",
    "num_associated_contacts", "hs_is_stalled", "hs_is_closed_won", "hs_is_closed_lost",
    "properties_address", "county", "parcel_id__deal", "tax_sale_date"
  ],
  "sorts": [{ "propertyName": "hs_lastmodifieddate", "direction": "DESCENDING" }],
  "limit": 100,
  "after": "{cursor}"
}
```

**Output:**
```json
{
  "results": [
    {
      "id": "12345",
      "properties": {
        "dealname": "BREVARD - 123 Main St - JOHN DOE",
        "dealstage": "abc123def",
        "pipeline": "pipeline_id_string",
        "amount": "33000",
        "closedate": "2026-09-01T00:00:00.000Z",
        "hubspot_owner_id": "67890",
        "hs_lastmodifieddate": "2026-06-01T14:00:00.000Z"
      },
      "createdAt": "2026-01-15T00:00:00Z",
      "updatedAt": "2026-06-01T14:00:00Z",
      "archived": false
    }
  ],
  "paging": {
    "next": {
      "after": "next_cursor_value",
      "link": "https://api.hubapi.com/..."
    }
  }
}
```

**Known behavior (confirmed 2026-06-07):**
- `dealstage` is an internal UUID — map to name using pipeline-stages.json
- `hubspot_owner_id` is a numeric string — map to name using owners.json
- Properties NOT in the `properties` array are NOT returned
- `paging.next` is absent when all results are fetched
- `amount` is a string, not a number — parse before storing
- `amount` is the **primary surplus value** — populated on 100% of deals. Matches dollar figure in deal name.
- `estimated_surplus` is null on 100% of deals (as of 2026-06-07) — include in request but do not display
- `county` is an enumeration — 25 GA counties + "Other". Deals outside those counties get "Other"
- `state` field is always null — state is embedded in `properties_address` string
- Total deal count: exactly 150 (2 pages of 100)

**Smart sync filter (for incremental updates):**
```json
{
  "filters": [
    { "propertyName": "pipeline", "operator": "EQ", "value": "{pipeline_id}" },
    { "propertyName": "hs_lastmodifieddate", "operator": "GTE", "value": "{last_synced_at_timestamp_ms}" }
  ]
}
```

---

### 2. Properties — Deals
M1 schema discovery. Run once during M1 research, save output to `docs/research/deal-properties.json`.

**Endpoint:** `GET https://api.hubapi.com/crm/v3/properties/deals`

**Output (one item from results array):**
```json
{
  "name": "dealname",
  "label": "Deal Name",
  "type": "string",
  "fieldType": "text",
  "groupName": "dealinformation",
  "options": []
}
```

---

### 3. Properties — Contacts
M1 schema discovery. Run once, save to `docs/research/contact-properties.json`. Use to find all phone field variants.

**Endpoint:** `GET https://api.hubapi.com/crm/v3/properties/contacts`

Output shape: same as deal properties above.

**Filter for phone fields after saving:**
```bash
cat docs/research/contact-properties.json | jq '.results[] | select(.name | test("phone|xs_elite|beenverified|fastpeople"; "i")) | {name, label}'
```

---

### 4. Pipelines — Deals
M1: get pipeline ID and all stage ID → name mappings. Run once, save to `docs/research/pipeline-stages.json`.

**Endpoint:** `GET https://api.hubapi.com/crm/v3/pipelines/deals`

**Output:**
```json
{
  "results": [
    {
      "id": "pipeline_id_string",
      "label": "Cases – Surplus Funds",
      "displayOrder": 0,
      "stages": [
        {
          "id": "stage_id_string",
          "label": "New Case",
          "displayOrder": 0,
          "metadata": { "probability": "0.2" }
        }
      ]
    }
  ]
}
```

**Usage:** Build a `stageMap: Record<stageId, stageName>` from this output. Use stageMap everywhere stage comparisons are needed. Never hardcode stage names as string literals.

---

### 5. Owners
M1: get owner ID → name mapping. Run once, save to `docs/research/owners.json`.

**Endpoint:** `GET https://api.hubapi.com/crm/v3/owners`

**Output (one item):**
```json
{
  "id": "67890",
  "email": "marwa@horizonrecovery.com",
  "firstName": "Marwa",
  "lastName": "Yasmeen",
  "userId": 12345
}
```

**Usage:** Build an `ownerMap: Record<ownerId, fullName>`. Use to resolve `hubspot_owner_id` to a display name.

---

### 6. Associations — Get IDs for a Deal
Layer 2 step 1: returns IDs of all objects associated with a deal. 5 calls per deal (one per type). Does NOT return object content — content requires batch fetches (endpoints 7–11).

**Endpoint:** `GET https://api.hubapi.com/crm/v3/objects/deals/{dealId}/associations/{objectType}`

`objectType`: `contacts` | `notes` | `calls` | `emails` | `tasks`

**Output:**
```json
{
  "results": [
    { "id": "obj_id_string", "type": "deal_to_contact" }
  ]
}
```

**Known behavior:**
- Returns IDs only — use batch read endpoints (7–11) to fetch content in one call per type
- Run all 5 association calls with `Promise.all` — they are independent

---

### 7–10. Activity Batch Read (Notes / Calls / Emails / Tasks)
Layer 2 step 2: fetch all activity objects of one type in a single call. One call per non-empty type (max 4 calls total for activities). Do NOT use individual GET endpoints — batch read is the implementation.

**Endpoint:** `POST https://api.hubapi.com/crm/v3/objects/{objectType}/batch/read`

`objectType`: `notes` | `calls` | `emails` | `tasks`

**Input:**
```json
{
  "inputs": [
    { "id": "obj_id_1" },
    { "id": "obj_id_2" }
  ],
  "properties": ["property_name_1", "property_name_2"]
}
```

**Properties by type:**

| Type | Properties |
|---|---|
| notes | `hs_note_body`, `hs_timestamp`, `hubspot_owner_id` |
| calls | `hs_call_body`, `hs_call_direction`, `hs_call_disposition`, `hs_timestamp`, `hubspot_owner_id` |
| emails | `hs_email_subject`, `hs_email_text`, `hs_email_direction`, `hs_timestamp`, `hs_email_from_email` |
| tasks | `hs_task_subject`, `hs_task_status`, `hs_task_body`, `hs_timestamp`, `hubspot_owner_id` |

**Output:**
```json
{
  "status": "COMPLETE",
  "results": [
    {
      "id": "obj_id_1",
      "properties": {
        "hs_note_body": "Called Alexis Wright — she said she'd forward info.",
        "hs_timestamp": "2026-05-21T14:30:00.000Z",
        "hubspot_owner_id": "67890"
      }
    }
  ]
}
```

**Known behavior (confirmed in M1/M4):**
- `hs_note_body` returns full HTML text on Starter plan — always strip HTML before storing
- `hs_call_direction`: `INBOUND` | `OUTBOUND`
- `hs_call_disposition` is a UUID — map to label using call property schema options (confirmed M1)
- JustCall logs "no answer" call attempts as Task objects (subject: "Follow Up Call"), not Call objects
- `hs_email_direction`: observed value is `"EMAIL"` in fixtures; full enum unconfirmed — do not branch on direction (see docs/research/field-mapping.md)
- `hs_email_text` is accessible on Starter plan (confirmed M1)
- `hs_task_status`: `NOT_STARTED` | `COMPLETED` | `DEFERRED` | `IN_PROGRESS`
- Skip the batch call if IDs array is empty — `Promise.resolve({ results: [] })` instead
- Max 100 objects per batch request

---

### 11. Contacts — Batch Read
Fetch multiple contacts in a single call. Use this instead of individual fetches.

**Endpoint:** `POST https://api.hubapi.com/crm/v3/objects/contacts/batch/read`

**Input:**
```json
{
  "inputs": [
    { "id": "contact_id_1" },
    { "id": "contact_id_2" }
  ],
  "properties": [
    "firstname", "lastname", "email",
    "phone", "mobilephone",
    "phone_1", "phone_2", "phone_3", "phone_4", "phone_5", "phone_6", "phone_7",
    "phone_numbers__excess_elite", "phone_numbers__beenverified_fastpeople_etc",
    "is_deceased", "do_not_contact",
    "contact_type1", "ownership_contact_status1", "attorney1"
  ]
}
```

**Output:**
```json
{
  "status": "COMPLETE",
  "results": [
    {
      "id": "contact_id_1",
      "properties": {
        "firstname": "Alexis",
        "lastname": "Wright",
        "phone": "(229) 611-4447"
      }
    }
  ]
}
```

**Known behavior:**
- Max 100 contacts per batch request
- All property names confirmed in M1 — see `docs/research/field-mapping.md`
- Phone field merging is done in mapper.ts, not here

---

## Anthropic API Reference

### Messages — Chat Completion
Used for: per-deal AI summaries, daily briefings, follow-up question responses.

**Endpoint:** `POST https://api.anthropic.com/v1/messages`

**Headers:**
```
x-api-key: {ANTHROPIC_API_KEY}
anthropic-version: 2023-06-01
content-type: application/json
```

**Input:**
```json
{
  "model": "claude-sonnet-4-6",
  "max_tokens": 1024,
  "system": "You are analyzing a surplus funds recovery case for Horizon Recovery...",
  "messages": [
    {
      "role": "user",
      "content": "Deal: {name}\nStage: {stage}\n\nActivity history:\n{activities}"
    }
  ]
}
```

**Output:**
```json
{
  "id": "msg_...",
  "type": "message",
  "role": "assistant",
  "content": [
    { "type": "text", "text": "{...JSON object...}" }
  ],
  "model": "claude-sonnet-4-6",
  "stop_reason": "end_turn",
  "usage": {
    "input_tokens": 450,
    "output_tokens": 280
  }
}
```

**Parsed content shape (M5 — per-deal summary):**

The prompt instructs Claude to return ONLY a JSON object (no markdown, no code fences). Parse with `JSON.parse(content[0].text)`:

```json
{
  "current_status": "string — one sentence on where the deal stands",
  "last_meaningful_activity": "string — what happened and when",
  "blockers": ["string", "string"],
  "who_needs_something": "string or null",
  "suggested_next_step": "string",
  "mo_action_required": true,
  "documents_mentioned_missing": ["string"]
}
```

**Known behavior:**
- `content[0].text` is the raw response string — `JSON.parse()` it for structured data
- Prompt must explicitly say "Return ONLY valid JSON. No markdown. No code fences." or Claude may wrap in backticks
- `stop_reason: "max_tokens"` means response was cut off — increase `max_tokens` if this happens
- `usage.input_tokens` + `usage.output_tokens` = total tokens billed
- No streaming in v1 (add if response latency is a problem)

**Links:**
- Anthropic API docs: https://docs.anthropic.com/en/api/messages
- Model list: https://docs.anthropic.com/en/docs/models-overview

---

## Vercel Cron Reference

Configured in `vercel.json` at project root. The cron runner sends a POST request to the specified path on schedule.

**Config:**
```json
{
  "crons": [
    {
      "path": "/api/sync/layer1",
      "schedule": "0 14,16,18,20 * * 1-5"
    }
  ]
}
```

**Note:** Vercel cron uses UTC. EST = UTC-5, EDT = UTC-4.
- 9am EDT = 13:00 UTC
- 11am EDT = 15:00 UTC
- 1pm EDT = 17:00 UTC
- 3pm EDT = 19:00 UTC
- Summer schedule (EDT): `0 13,15,17,19 * * 1-5`
- Winter schedule (EST): `0 14,16,18,20 * * 1-5`

**Known behavior:**
- Cron does NOT automatically adjust for daylight saving — pick one offset or handle in code
- Vercel sends a `GET` or `POST` depending on your route handler — use `POST`
- Cron invocations have a 10-second default timeout on Hobby plan, 60 seconds on Pro

**Link:** https://vercel.com/docs/cron-jobs

---

## HubSpot API Links

| Resource | URL |
|---|---|
| CRM Search | https://developers.hubspot.com/docs/api/crm/search |
| Properties API | https://developers.hubspot.com/docs/api/crm/properties |
| Pipelines API | https://developers.hubspot.com/docs/api/crm/pipelines |
| Owners API | https://developers.hubspot.com/docs/api/crm/owners |
| Associations API | https://developers.hubspot.com/docs/api/crm/associations |
| Engagements (Notes/Calls/Emails/Tasks) | https://developers.hubspot.com/docs/api/crm/engagements |
| Contacts API | https://developers.hubspot.com/docs/api/crm/contacts |
| Rate limits | https://developers.hubspot.com/docs/api/usage-details |
| Private Apps | https://developers.hubspot.com/docs/api/private-apps |
