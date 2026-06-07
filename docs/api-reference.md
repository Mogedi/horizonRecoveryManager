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
| HubSpot Objects — Notes | Layer 2: fetch note body + metadata | 100 req/10s |
| HubSpot Objects — Calls | Layer 2: fetch call notes + direction | 100 req/10s |
| HubSpot Objects — Emails | Layer 2: fetch email body + direction | 100 req/10s |
| HubSpot Objects — Tasks | Layer 2: fetch task content + status | 100 req/10s |
| HubSpot Contacts Batch Read | Layer 2: fetch all contacts for a deal in one call | 100 req/10s |
| Anthropic Messages | Generate deal summaries and daily briefings | per-token pricing |
| Vercel Cron | Schedule Layer 1 sync 4x/day | N/A |

---

## Rate Limiter Specification

All HubSpot calls go through `/src/lib/hubspot/client.ts`. Implementation:

```
Algorithm:        Token bucket
Capacity:         3 tokens
Refill rate:      3 tokens/second (30% of 10 req/s Starter limit)
On empty bucket:  Queue request, wait for next token
Retry on 429:     Exponential backoff — 1s, 2s, 4s, 8s, max 3 retries
Jitter:           ±100ms on each refill to avoid synchronized bursts

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
Layer 2: returns IDs of all objects associated with a deal. Does NOT return object content — content requires separate fetches per ID.

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
- Returns IDs only — each object must be fetched separately (or batch-fetched for contacts)
- Large deals may have many associations — log count before fetching all

---

### 7. Objects — Notes
**Endpoint:** `GET https://api.hubapi.com/crm/v3/objects/notes/{noteId}`

**Query params:** `properties=hs_note_body,hs_timestamp,hubspot_owner_id`

**Output:**
```json
{
  "id": "note_id",
  "properties": {
    "hs_note_body": "Called Alexis Wright — she said she'd forward info.",
    "hs_timestamp": "2026-05-21T14:30:00.000Z",
    "hubspot_owner_id": "67890"
  }
}
```

**CONFIRM IN M1:** Whether `hs_note_body` returns full text or is truncated on Starter plan.

---

### 8. Objects — Calls
**Endpoint:** `GET https://api.hubapi.com/crm/v3/objects/calls/{callId}`

**Query params:** `properties=hs_call_body,hs_call_direction,hs_call_disposition,hs_timestamp,hubspot_owner_id`

**Output:**
```json
{
  "id": "call_id",
  "properties": {
    "hs_call_body": "Left voicemail. Call back requested.",
    "hs_call_direction": "OUTBOUND",
    "hs_call_disposition": "9d9162e7-6cf3-4944-bf63-4dff82258764",
    "hs_timestamp": "2026-05-21T14:00:00.000Z",
    "hubspot_owner_id": "67890"
  }
}
```

**Known behavior:**
- `hs_call_direction`: `INBOUND` | `OUTBOUND`
- `hs_call_disposition` is a UUID that maps to an outcome label (Left voicemail, Connected, No Answer, etc.). Map these during M1 by reading the call property schema options.
- JustCall syncs call recordings and notes into HubSpot as call objects

**CONFIRM IN M1:** Exact disposition UUID → label mapping.

---

### 9. Objects — Emails
**Endpoint:** `GET https://api.hubapi.com/crm/v3/objects/emails/{emailId}`

**Query params:** `properties=hs_email_subject,hs_email_text,hs_email_direction,hs_timestamp,hs_email_from_email`

**Output:**
```json
{
  "id": "email_id",
  "properties": {
    "hs_email_subject": "Re: Your Property Surplus",
    "hs_email_text": "Thank you for reaching out...",
    "hs_email_direction": "INCOMING_EMAIL",
    "hs_timestamp": "2026-05-20T09:00:00.000Z",
    "hs_email_from_email": "client@gmail.com"
  }
}
```

**Known behavior:**
- `hs_email_direction`: `INCOMING_EMAIL` | `OUTGOING_EMAIL` (not INBOUND/OUTBOUND)
- `hs_email_text` may NOT be accessible on Starter plan — **CONFIRM IN M1**
- If email body is not accessible: fall back to subject-only display, mark as limitation

**CONFIRM IN M1:** Whether email body text is accessible. Whether direction is reliably populated.

---

### 10. Objects — Tasks
**Endpoint:** `GET https://api.hubapi.com/crm/v3/objects/tasks/{taskId}`

**Query params:** `properties=hs_task_subject,hs_task_status,hs_task_body,hs_timestamp,hubspot_owner_id`

**Output:**
```json
{
  "id": "task_id",
  "properties": {
    "hs_task_subject": "Follow up with Alexis Wright",
    "hs_task_status": "NOT_STARTED",
    "hs_task_body": "Reference 5/21 voicemail. Ask about heirship docs.",
    "hs_timestamp": "2026-05-22T00:00:00.000Z",
    "hubspot_owner_id": "67890"
  }
}
```

**Known behavior:**
- `hs_task_status`: `NOT_STARTED` | `COMPLETED` | `DEFERRED` | `IN_PROGRESS`

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
    { "type": "text", "text": "CURRENT STATUS\n..." }
  ],
  "model": "claude-sonnet-4-6",
  "stop_reason": "end_turn",
  "usage": {
    "input_tokens": 450,
    "output_tokens": 280
  }
}
```

**Known behavior:**
- `content[0].text` contains the response text
- `usage.input_tokens` + `usage.output_tokens` = total tokens billed
- No streaming in v1 (add if response latency becomes a problem)
- `stop_reason: "max_tokens"` means the response was cut off — increase `max_tokens` if this happens

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
