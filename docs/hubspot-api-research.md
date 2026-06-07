# HubSpot API Research

*Complete this during Milestone 1, before building any sync code.*
*Run each test manually. Save all raw output to `docs/research/` before reviewing.*
*Do not design the database schema until Mo has reviewed the sample deal output.*

---

## Account Details

- HubSpot Plan: **Starter** (confirmed)
- Rate limit: 100 requests / 10 seconds, 250,000 requests / day
- Pipeline name: **Cases – Surplus Funds** (confirmed in M1 — previously wrong as "KSR Plus Funds")
- Private App token: stored in `.env.local` as `HUBSPOT_ACCESS_TOKEN`

## API Call Log

Track calls per test session. Target: under 50 total for full M1 research run.

| Test | Calls Used | Date |
|---|---|---|
| Schema discovery (deals + contacts + pipeline + owners) | 4 | 2026-06-06 |
| Sample deal pull (search + detail) | 2 | 2026-06-06 |
| Sample deal contacts (associations + batch read ×2) | 3 | 2026-06-06 |
| Sample deal notes (associations + 5 individual) | 6 | 2026-06-06 |
| Sample deal calls (associations — 0 results) | 1 | 2026-06-06 |
| Sample deal emails (associations + 1 email) | 2 | 2026-06-06 |
| Sample deal tasks (associations + 5 individual) | 6 | 2026-06-06 |
| **Total M1** | **~24** | 2026-06-06 |
| Multi-stage sample: 6 searches + 2 full Layer 2 pulls + deal count check | 23 | 2026-06-07 |
| **Grand total** | **~47** | — |

## Output File Locations

Save all raw API responses here before reviewing:
```
docs/research/
  deal-properties.json
  contact-properties.json
  pipeline-stages.json
  owners.json
  sample-deal.json
  sample-deal-contacts.json
  sample-deal-notes.json
  sample-deal-calls.json
  sample-deal-emails.json
  sample-deal-tasks.json
  field-mapping.md       ← fill in after Mo reviews output
```

---

## Required Scopes

Add all of these when creating the Private App:

| Scope | Purpose |
|---|---|
| `crm.objects.deals.read` | Pull deal records |
| `crm.objects.contacts.read` | Pull contact records |
| `crm.objects.notes.read` | Pull note engagements |
| `crm.objects.tasks.read` | Pull task engagements |
| `crm.objects.calls.read` | Pull call engagements |
| `crm.objects.emails.read` | Pull email engagements |
| `crm.schemas.deals.read` | Pull deal property schema |
| `crm.schemas.contacts.read` | Pull contact property schema |
| `files.read` (if available) | Pull attachment metadata |

---

## Test 1: Deal Property Schema

**Goal:** Discover all custom deal properties.

**Command:**
```bash
curl -X GET "https://api.hubapi.com/crm/v3/properties/deals" \
  -H "Authorization: Bearer $HUBSPOT_ACCESS_TOKEN" \
  | jq '.results[] | {name: .name, label: .label, type: .type}'
```

**Known standard fields to map:**
| Our Field | HubSpot Property Name |
|---|---|
| Deal name | `dealname` |
| Stage | `dealstage` |
| Amount | `amount` |
| Close date | `closedate` |
| Last activity | `notes_last_updated` or `hs_lastmodifieddate` |
| Owner | `hubspot_owner_id` |

**Custom fields to find and map:**
| Our Field | HubSpot Property Name | Confirmed? |
|---|---|---|
| Property address | | |
| County | | |
| Parcel ID | | |
| Tax sale date | | |
| Google Drive folder URL (if exists) | | |
| Case type (if exists) | | |

*Fill in HubSpot property names after running the command above.*

---

## Test 2: Contact Property Schema

**Goal:** Discover all custom contact properties — especially all phone field variants.

**Command:**
```bash
curl -X GET "https://api.hubapi.com/crm/v3/properties/contacts" \
  -H "Authorization: Bearer $HUBSPOT_ACCESS_TOKEN" \
  > docs/research/contact-properties.json

# Then search for phone-related fields:
cat docs/research/contact-properties.json | jq '.results[] | select(.name | test("phone|xs_elite|beenverified|fastpeople"; "i")) | {name: .name, label: .label}'
```

**Custom fields to find and map:**
| Our Field | HubSpot Property Name | Confirmed? |
|---|---|---|
| Is Deceased | | |
| Relationship Status | | |
| Do Not Contact | | |
| Current Address (USPS) | | |
| Phone (standard) | `phone` (standard) | |
| Phone_1 through Phone_5 | | |
| XS Elite phone fields | | |
| BeenVerified phone fields | | |
| FastPeopleSearch phone fields | | |
| Email List | | |
| Age | | |

**Important:** The mapper must merge ALL phone field sources into a single `phoneNumbers: string[]` array. New phone field sources should be addable to the mapper without changing other code.

---

## Test 3: Layer 1 Batch Deal Pull

**Goal:** Confirm we can pull all Layer 1 fields in a single CRM Search call.

Note: replace `PIPELINE_ID` with the pipeline ID found in the pipeline-stages.json output from Test 1.

**Command:**
```bash
curl -X POST "https://api.hubapi.com/crm/v3/objects/deals/search" \
  -H "Authorization: Bearer $HUBSPOT_ACCESS_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "filterGroups": [{ "filters": [{ "propertyName": "pipeline", "operator": "EQ", "value": "PIPELINE_ID" }] }],
    "properties": ["dealname", "dealstage", "pipeline", "amount", "closedate",
                   "hubspot_owner_id", "notes_last_updated", "num_associated_contacts",
                   "FILL_IN_CUSTOM_PROPERTIES_FROM_STEP_1_HERE"],
    "limit": 3
  }'
```

Save output to `docs/research/sample-deal.json`.

**Questions to answer:**
- [ ] Can we get contact count in Layer 1? Property name: `num_associated_contacts` (confirm)
- [ ] Can we get task count in Layer 1? Property name: ??? (research)
- [ ] Can we get open task count in Layer 1? Property name: ??? (research)
- [ ] What is the actual `last_activity_date` property name in HubSpot?
- [ ] Does `dealstage` return the stage name or an internal ID? (if ID, need to map to name)
- [ ] What is the pipeline property name?

---

## Test 4: Engagements (Notes, Calls, Emails, Tasks)

**Goal:** Confirm we can pull activity text for Layer 2.

### Notes
```bash
curl "https://api.hubapi.com/crm/v3/objects/deals/{DEAL_ID}/associations/notes" \
  -H "Authorization: Bearer $HUBSPOT_ACCESS_TOKEN"
# Then for each note ID:
curl "https://api.hubapi.com/crm/v3/objects/notes/{NOTE_ID}?properties=hs_note_body,hs_timestamp,hubspot_owner_id" \
  -H "Authorization: Bearer $HUBSPOT_ACCESS_TOKEN"
```
- [ ] Is full note text available? (`hs_note_body`)
- [ ] Is note author (owner) available?

### Calls
```bash
curl "https://api.hubapi.com/crm/v3/objects/deals/{DEAL_ID}/associations/calls" \
  -H "Authorization: Bearer $HUBSPOT_ACCESS_TOKEN"
# Then for each call ID:
curl "https://api.hubapi.com/crm/v3/objects/calls/{CALL_ID}?properties=hs_call_body,hs_call_direction,hs_call_disposition,hs_timestamp" \
  -H "Authorization: Bearer $HUBSPOT_ACCESS_TOKEN"
```
- [ ] Is call notes/transcript available? (`hs_call_body`)
- [ ] Is call direction available (inbound vs outbound)?
- [ ] Is call outcome available? (`hs_call_disposition`)

### Emails
```bash
curl "https://api.hubapi.com/crm/v3/objects/deals/{DEAL_ID}/associations/emails" \
  -H "Authorization: Bearer $HUBSPOT_ACCESS_TOKEN"
# Then for each email ID:
curl "https://api.hubapi.com/crm/v3/objects/emails/{EMAIL_ID}?properties=hs_email_subject,hs_email_text,hs_email_direction,hs_timestamp,hs_email_from_email" \
  -H "Authorization: Bearer $HUBSPOT_ACCESS_TOKEN"
```
- [ ] Is email body text available? (`hs_email_text`)
- [ ] Is email direction available (INCOMING vs OUTGOING)? (`hs_email_direction`)
- [ ] Is sender email address available? (`hs_email_from_email`)
- [ ] **CRITICAL: Can we identify client-initiated vs employee-sent emails?**

### Tasks
```bash
curl "https://api.hubapi.com/crm/v3/objects/deals/{DEAL_ID}/associations/tasks" \
  -H "Authorization: Bearer $HUBSPOT_ACCESS_TOKEN"
# Then for each task ID:
curl "https://api.hubapi.com/crm/v3/objects/tasks/{TASK_ID}?properties=hs_task_subject,hs_task_status,hs_task_body,hs_timestamp,hubspot_owner_id" \
  -H "Authorization: Bearer $HUBSPOT_ACCESS_TOKEN"
```
- [ ] Is task title available?
- [ ] Is task status available (NOT_STARTED, COMPLETED, etc.)?
- [ ] Is task due date available?
- [ ] Is task body/notes available?

---

## Test 5: Contact Associations

**Goal:** Pull all contacts linked to a deal.

```bash
curl "https://api.hubapi.com/crm/v3/objects/deals/{DEAL_ID}/associations/contacts" \
  -H "Authorization: Bearer $HUBSPOT_ACCESS_TOKEN"
# Then batch-fetch contacts:
curl -X POST "https://api.hubapi.com/crm/v3/objects/contacts/batch/read" \
  -H "Authorization: Bearer $HUBSPOT_ACCESS_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"inputs": [{"id": "CONTACT_ID"}], "properties": ["firstname", "lastname", "CUSTOM_PROPS_HERE"]}'
```
- [ ] Can we batch-fetch multiple contacts in one call?
- [ ] Are all custom contact properties available?

---

## Test 6: Google Drive Files

**Goal:** Determine if HubSpot-linked Google Drive files appear in the API.

```bash
# Try files/attachments endpoints:
curl "https://api.hubapi.com/files/v3/files?parentPath=..." \
  -H "Authorization: Bearer $HUBSPOT_ACCESS_TOKEN"

# Try engagement/attachment associations:
curl "https://api.hubapi.com/crm/v3/objects/deals/{DEAL_ID}/associations/attachments" \
  -H "Authorization: Bearer $HUBSPOT_ACCESS_TOKEN"
```

**Result:** [ ] Available via API  [ ] Not available — use manual checklist fallback

If not available via API, design decision: implement manual document checklist in dashboard (Mo confirms documents are present).

---

## Test 7: Owners

**Goal:** Map owner IDs to names.

```bash
curl "https://api.hubapi.com/crm/v3/owners" \
  -H "Authorization: Bearer $HUBSPOT_ACCESS_TOKEN"
```
- [ ] Confirm Marwa Yasmeen and Ma Kathleen Dabu appear
- [ ] Save owner ID → name mapping to `app_settings` or hardcode in env

---

## Test 8: Pipeline and Stage Mapping

**Goal:** Map stage internal IDs to readable names.

```bash
curl "https://api.hubapi.com/crm/v3/pipelines/deals" \
  -H "Authorization: Bearer $HUBSPOT_ACCESS_TOKEN"
```
- [ ] Get pipeline ID for "Cases – Surplus Funds"
- [ ] Get stage ID → stage name mapping for all 12 stages
- [ ] Store mapping in `app_settings` or hardcode as constants

---

## Findings & Decisions

*(Fill in after running all tests and Mo has reviewed output)*

### Field Mapping (fill in after Mo reviews sample-deal.json and sample-deal-contacts.json)

**Deal fields:**
| Our Internal Field | Confirmed HubSpot Property Name |
|---|---|
| `name` | `dealname` |
| `stage` | `dealstage` (maps to stage name via pipeline-stages.json) |
| `pipeline` | `pipeline` |
| `ownerName` | `hubspot_owner_id` (maps to name via owners.json) |
| `amount` | `amount` |
| `closeDate` | `closedate` |
| `lastActivityDate` | ??? — confirm: `notes_last_updated` or `hs_lastmodifieddate` |
| `contactCount` | `num_associated_contacts` — confirm available in CRM Search |
| `openTaskCount` | ??? — research |
| `propertyAddress` | ??? — Mo to confirm |
| `county` | ??? — Mo to confirm |
| `parcelId` | ??? — Mo to confirm |
| `taxSaleDate` | ??? — Mo to confirm |
| `hubspotUrl` | Constructed from `hs_object_id` |

**Contact phone fields (list all variants found):**
| Phone Field Variant | HubSpot Property Name |
|---|---|
| Standard phone | `phone` |
| phone_1 | ??? |
| phone_2 | ??? |
| phone_3 | ??? |
| phone_4 | ??? |
| phone_5 | ??? |
| XS Elite fields | ??? |
| BeenVerified fields | ??? |
| FastPeopleSearch fields | ??? |

### What We Can Pull via API
- [ ] Layer 1 fields: all available / partially available / workaround needed
- [ ] Note full text: yes / no
- [ ] Email body text: yes / no
- [ ] Email direction (inbound vs outbound): yes / no — critical for "Mo Action Required"
- [ ] Call notes: yes / no
- [ ] Google Drive files: yes / no

### Workarounds Required

| Data We Need | Workaround |
|---|---|
| Google Drive files (if not in API) | Manual document checklist in dashboard |
| Case type (no dedicated HubSpot field) | Infer from `is_deceased` contact field + note text patterns |
| Attorney status (no dedicated HubSpot field) | Infer from note/email text |

### Rate Limit Strategy

Estimated Layer 1 sync cost:
- 1–2 API calls (batched CRM Search with pagination at 100/page)

Estimated Layer 2 cost per deal (~30 activities):
- ~6 association calls (notes, calls, emails, tasks, contacts, attachments)
- ~30 individual object fetches
- **Total: ~36 calls per deal**

At 100 req/10s (Starter), 36 calls per deal means one deal's Layer 2 takes ~3.6 seconds minimum (assuming sequential). Warn user before pulling. Do not auto-pull Layer 2.
