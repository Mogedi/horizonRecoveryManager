# Horizon Recovery — Business Context

## What the Company Does

Horizon Recovery is an asset recovery company. It identifies individuals who are owed money from government-held surplus funds, contacts them, obtains signed recovery agreements, gathers documentation, works with attorneys, and recovers funds on their behalf in exchange for a fee (typically 25–30% of recovered amount).

**Primary business lines:**
1. Tax sale surplus recovery — property owners owed surplus from county tax sales
2. State unclaimed property recovery — individuals owed unclaimed funds held by the state

The company does not hold or manage the funds. It facilitates the claim process between the rightful owner and the county or state authority.

---

## Team

**Mo (Owner)** — Primary user of this dashboard. Makes all final decisions on cases, strategy, and attorney engagement. Currently uses Trello for personal task tracking (being replaced by this tool).

**Marwa Yasmeen** — Handles research, outreach, and deal creation. Does most data entry in HubSpot — so deal `hubspot_owner_id` almost always shows her name, but this does NOT indicate who is actively working the case. Do not use deal owner for attention routing or team assignment. Instead, use engagement-level `hubspot_owner_id` (on notes, emails, calls) to track who logged the activity.

**Ma Kathleen Dabu** — Handles calls, contact attempts, and case notes. Makes outbound calls via JustCall.

Future employees should be automatically supported as team members are added to HubSpot.

---

## Current Systems

### HubSpot (System of Record)
Contains all deals, contacts, notes, tasks, emails, calls, and documents. Employees operate entirely inside HubSpot. The dashboard reads from HubSpot but does not write back to it in Phase 1.

HubSpot plan: **Starter** (confirmed). Rate limits: 100 req/10s, 250,000 req/day.

### JustCall
Phone system. Employees make outbound calls through JustCall. Call activity syncs automatically into HubSpot as call engagements.

### Google Drive
Stores property profiles, signed agreements, IDs, attorney documents, and supporting records. Files are attached to HubSpot deal records through the Google Drive integration panel.

---

## Pipeline: Cases – Surplus Funds

All active deals live in the "Cases – Surplus Funds" pipeline (ID: `2172337854`). The system should support multiple pipelines in the future.

**Note:** The pipeline was previously referenced as "KSR Plus Funds" in early docs. The actual pipeline name in HubSpot is "Cases – Surplus Funds" (confirmed in M1).

### Stage Definitions

Stage names and IDs are authoritative in `docs/research/pipeline-stages.json`. Never compare against raw string names — always use `stageMap[deal.stage]`.

| Stage | Active? | Description |
|---|---|---|
| **More Research Need** | Pre-pipeline | Deal needs additional research before entering main flow. |
| **F** | Separate deal type | Mortgage Foreclosures (Georgia). All other pipeline cases are tax surplus cases. "F" cases are a separate deal type in the same pipeline — not an error, not pre-pipeline. Treat as its own category. |
| **New Case** | Active | Deal created. Research complete. Setup documents (PropertyRadar profile, tax sale deed, Google Drive folder) being gathered. |
| **Ready for Outreach** | Active | Research and documents in place. Ready for contact attempts. |
| **Attempted Contact** | Active | Outbound calling underway. May not have reached owner yet. |
| **Contact Made** | Active | Owner or family member reached. Initial conversation happened. |
| **Follow-Up Needed** | Active | Catch-all. May mean: waiting on client, client asked a question, employee needs to follow up, more info needed. Clock does not pause — still needs active monitoring. |
| **Engaged / Interested** | Active | Prospect shows real interest. Deeper discussions underway. Mo becomes more directly involved. |
| **Agreement Sent** | Active | Recovery agreement sent to claimant. Awaiting signature. |
| **Signed / In Progress** | Active | Agreement signed. Case is active. Attorney may be involved. Documents being gathered. |
| **Closed – Paid** | Terminal (won) | Claim resolved. Funds recovered. Revenue realized. |
| **Letter Outreach - Final Attempt** | Active | Letters sent when calls fail. Important: letters generate callbacks and cases can re-enter active pipeline. Keep visible. |
| **Dead / Not Interested** | Terminal (lost) | Client explicitly declined or unresponsive after all attempts. |
| **DNC** | Terminal (lost) | Do Not Contact — remove from pipeline. |
| **Blocked, Missing Info** | Stalled | Cannot proceed due to a specific blocker (missing documents, unresolved question). |
| **Exhausted** | Terminal (lost) | All contact attempts failed. No path forward. |

### Deal Naming Convention

Pattern: `COUNTY - Property Address - OWNER NAME ($AMOUNT)`

Example: `BREVARD - 2671 San Filippo Dr SE - JOHN THOMPSON ($33K)`

- County in deal name is generally correct (populated manually)
- County dropdown in HubSpot may say "Other" if dropdown was not maintained
- Dollar amount is the **projected surplus available to the owner**, not Horizon's fee
- Fee is approximately 25–30% of recovered amount
- Do not use these amounts for revenue forecasting — value only exists when case is Closed/Paid

---

## Deal Health Rules (Business Logic)

### What "Healthy" Means Per Stage

**New Case**
Healthy = required setup documents confirmed:
- PropertyRadar property profile attached
- Tax sale deed attached
- Google Drive folder created and linked

**Ready for Outreach**
Healthy = touched within 5 business days. Volume outreach stage — one employee handles high volume.

**Attempted Contact**
Healthy = touch within 7 business days.

**Contact Made**
Healthy = touch within 5 business days.

**Follow-Up Needed**
Healthy = touch within 5 business days. Do NOT assume the clock pauses just because we're waiting on the client.

**Engaged / Interested**
Healthy = touch within 3 business days. Mo is more involved here.

**Agreement Sent**
Healthy = follow-up within 2 business days. High conversion stage — do not let agreements sit.

**Signed / In Progress**
Healthy = meaningful activity every 5 business days. Friday client update calls are standard workflow. Examples of meaningful activity: client update call, email update, attorney follow-up, document request, document received, status note.

**Letter Outreach – Final Attempt**
Healthy = touch within 14 business days. Keep visible — letters create callbacks.

All thresholds are configurable in the dashboard settings.

---

## Document Requirements

Documents vary by case type. There is no dedicated HubSpot field for case type — it must be inferred from contacts and notes.

### Standard Documents (All Cases)
- PropertyRadar property profile
- Tax sale deed / deed of sale
- Signed recovery agreement
- Government-issued ID (of claimant)

### Additional: Deceased Owner
- Death certificate
- Will (if one exists)
- Probate records
- Heirship documentation
- Marriage certificate (if spouse is claimant)

### Additional: Heir / Estate Cases
- Heirship documentation
- Probate records
- Attorney packet / lawyer filing

### Attorney Engagement
- Attorney document packet (varies)

Documents are tracked in Google Drive, linked via HubSpot's sidebar integration. There is no HubSpot API endpoint to retrieve these linked files. AI-inferred document checklists are deferred — complexity is high and Google Drive already serves this purpose for the current team size (~18 active deals).

---

## Attorney Workflow

Attorneys typically become involved once a case is Signed / In Progress. Earlier involvement occurs if there is legal complexity:
- Deceased owner with no clear heir
- Heirship dispute
- Spouse claim
- Probate question
- Intestacy issue

Attorney status is not tracked in a dedicated HubSpot field. It must be inferred from notes and emails.

"Waiting on attorney" typically means:
- Attorney has filed with county or county law firm
- County / opposing firm may take 60–120 days to respond
- Attorney may request additional documents from us
- Need to track whether client and attorney have received updates

---

## Case Timeline

Typical case: approximately 4 months from New Case to final payment.

- First 2–3 weeks: active work (outreach, agreement, documents, attorney handoff)
- After filing: may sit 60–120 days waiting on county, attorney, or accountant

The dashboard must distinguish between:
- **Active work delay** — something is wrong, needs attention
- **Normal waiting period after filing** — expected, snooze-able

---

## Pain Points This Tool Addresses

| Pain Point | Dashboard Solution |
|---|---|
| Can't see what needs attention across 150+ deals | Attention queue grouped by issue type |
| Don't know which cases are stuck vs. just waiting | Stage-specific staleness rules + snooze system |
| Attorney/client emails get buried | "Mo Action Required" detection via AI summary |
| Personal tasks scattered across Trello and HubSpot | Internal task list replacing Trello (M6) |
| Can't summarize case status quickly | Per-deal AI summary (28-day activity window, M5 ✅) |
| No morning briefing on what happened yesterday | Daily Briefing button (M6) |
| Can't see which employee is productive | Team activity summary in Daily Briefing (M6) |

---

## Q&A Insights Summary

Collected from 60+ design questions across 4 rounds of product design sessions.

**Most important insight:** This is not a reporting dashboard. It is an owner-attention dashboard. The north star question is: *"What should Mo do next?"*

**Revenue values are not meaningful** until a case is Closed/Paid. Use dollar amounts as a proxy for case importance when sorting, but do not build pipeline revenue forecasting.

**HubSpot remains authoritative.** The dashboard adds an intelligence layer on top but does not replace or duplicate HubSpot's operational function.

**Employees work in HubSpot, not the dashboard.** The dashboard is primarily for Mo. Future versions may expose limited employee views.

**Snooze is critical.** Many cases legitimately sit for 60–120 days after filing. Without snooze, the attention queue would be full of noise.

**The most dangerous situation** is when attorney, client, or employee leaves something that requires Mo's action and it gets buried. "Mo Action Required" detection is a high-priority feature.

**Tasks should replace Trello.** Mo wants internal tasks (case-linked and general) tracked inside this tool, not scattered across HubSpot and Trello.
