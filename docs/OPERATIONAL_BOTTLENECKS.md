# Horizon Recovery — Top 20 Operational Bottlenecks (COO View)

*Author's lens: COO of Horizon Recovery LLC. Goal: find where the surplus-recovery machine actually loses time, money, and cases. Grounded in the live stack — HubSpot (read-only CRM), JustCall (calls + transcripts), Gmail, Google Drive, and on-demand AI summaries — and the real team: Mo (owner/decider), Marwa (research + data entry), Kathleen (phones).*

*Date: 2026-06-09*

---

## How to read this

- **Frequency** = how often the friction occurs across the ~150-case book (~18–30 active).
- **Impact** = blended cost: Mo/staff hours, claim risk, and dollars at stake. Individual surpluses run four–to–five figures, so a single dropped case dwarfs weeks of small inefficiencies — impact ratings weight claim-loss risk heavily.
- **Automation** = what Hermes/Horizon Manager could do within the current guardrails (read everything; write only internal tasks/snoozes/notes; never write HubSpot, never send without Mo's approval). Where a step needs a new integration or a human approval gate, it says so.

The 20 are grouped by where they live in the funnel: Intake & Data Integrity → Outreach → Documents & Legal → Pipeline Hygiene → Owner/Team Leverage.

---

## A. Intake & Data Integrity

### 1. Manual deal data entry into HubSpot
**Problem.** Every new case is hand-keyed into HubSpot by Marwa — county, address, owner name, parcel ID, surplus amount, tax-sale date. It's slow and error-prone, and errors here poison everything downstream (skip-tracing, deed matching, letters).
**Frequency.** Per new case — steady inflow, several per week.
**Impact.** High. Data-entry hours plus the compounding cost of a wrong parcel/owner that surfaces only at filing.
**Automation.** Hermes drafts a structured intake record from the source list/deed and presents it for one-click confirmation; flags fields it's unsure of. (HubSpot write stays manual/approved — Hermes prepares, Marwa commits.)

### 2. Data drift between HubSpot and the deed / PropertyRadar
**Problem.** HubSpot says one parcel/owner; the tax-sale deed or PropertyRadar profile says another. Nobody reconciles until a problem appears. Owner-name and parcel mismatches are exactly what kills a claim at the county.
**Frequency.** Latent on a meaningful share of active cases; surfaces unpredictably.
**Impact.** Very High. A mismatch discovered post-filing can void or delay a five-figure recovery.
**Automation.** AI Case Manager reconciliation pass — doc-verify already extracts deed/PropertyRadar fields; compare against HubSpot and raise a discrepancy task. (Data exists today; this is the single highest-leverage integrity fix.)

### 3. Untracked heirs / co-owners named on the deed
**Problem.** The deed names parties (co-owners, estates, lien debtors) who were never added as HubSpot contacts. Miss a required signatory and the claim stalls or fails.
**Frequency.** Common on probate/multi-owner cases — a recurring subset of active deals.
**Impact.** Very High. Legal-sufficiency risk; a missed heir can be unrecoverable.
**Automation.** doc-verify's `ownerTrackingCheck` already flags `tracked:false` debtors — auto-create a "research & add party" task naming the person. Pure existing data.

### 4. Phone numbers scattered across 11 HubSpot fields
**Problem.** Contact phones live in 11 field variants; the dialer-ready truth isn't obvious to staff. Bad/duplicate numbers waste call time.
**Frequency.** Every contact, every case.
**Impact.** Medium. Wasted dials, confusion over which number is "the" number.
**Automation.** Already normalized to an E.164 `phoneNumbers` array in the mapper — surface a single deduped, validated call list per contact in the workspace and feed it to the call queue. Largely built; needs to be the canonical surface staff use.

### 5. No systematic dead-number detection
**Problem.** Kathleen re-dials disconnected lines for weeks because nothing marks a number dead. JustCall already produces the signal; it's just not acted on.
**Frequency.** Continuous across the calling book.
**Impact.** Medium-High. Direct waste of the team's scarcest resource (live calling hours) and false "still working it" signals.
**Automation.** Outreach matrix already classifies `dead_line`. Auto-set `phone_numbers.status = disconnected` after repeated dead classifications and spawn a skip-trace task. Data ready today.

---

## B. Outreach & Contact

### 6. Knowing who to call next, in what order
**Problem.** With 18–30 active cases and limited calling hours, Kathleen has no value-weighted call list. A $45K owner and a $3K owner look the same in the queue.
**Frequency.** Daily — every calling session.
**Impact.** High. Mis-prioritized calling directly slows the highest-value recoveries.
**Automation.** Weighted call queue = f(surplus amount, stage urgency, contacts not yet reached, business-days stale). Pure computation over data already cached. Hand Kathleen a ranked list each morning.

### 7. Stalled cases dropping silently between calls
**Problem.** A case where contact was attempted but not reached can sit untouched for days with no nudge. The attention queue catches some via staleness rules, but cadence between attempts isn't enforced.
**Frequency.** Continuous — a steady fraction of active cases idle at any time.
**Impact.** High. Surplus claims are time-boxed by county deadlines; silent drift loses cases.
**Automation.** Auto-generate a follow-up task when a deal is flagged (e.g., Agreement Sent + no activity 2 days). Rules engine + task creation already exist; wire them together.

### 8. No skip-trace path when contact info is exhausted
**Problem.** When all known numbers are tried and dead, the case needs fresh contact data — but there's no skip-trace integration, so it silently parks. `contact-quality` already labels these `skip_trace`, and nothing happens next.
**Frequency.** Recurring — the natural endpoint of any hard-to-reach owner.
**Impact.** High. These are often the highest-surplus, hardest-to-find owners — exactly the ones worth chasing.
**Automation.** Two-stage: (a) auto-build the prioritized skip-trace worklist today (data exists); (b) wire a skip-trace provider (scaffold exists, no provider chosen) to pull numbers automatically. (b) needs a new API + credential decision.

### 9. Manual, inconsistent call logging & note-taking
**Problem.** Call outcomes and notes depend on Kathleen writing them up; quality and timeliness vary, and live-call substance gets lost.
**Frequency.** Every call — dozens per week.
**Impact.** Medium-High. Weak notes degrade every downstream summary and handoff.
**Automation.** Whisper transcription + Claude summary already runs on live calls. Auto-draft the call note from the transcript for one-click acceptance — turns logging from a chore into a confirmation.

### 10. Voicemail vs. live vs. dead is ambiguous without listening
**Problem.** "Answered" in raw JustCall conflates a real conversation, a voicemail greeting, and a dead line. Without classification, staff and Mo can't trust outreach metrics.
**Frequency.** Every answered/voicemail call.
**Impact.** Medium. Distorts "have we actually reached this owner?" — the core outreach question.
**Automation.** `deriveDetailedOutcome` already splits conversation / voicemail subtype / dead-line / brief-answered. Make that the metric of record in dashboards and the reached/not-reached gate. Built; needs to be authoritative.

---

## C. Documents & Legal

### 11. Document completeness is checked by hand, late
**Problem.** Whether a case has its deed, PropertyRadar profile, and notice letter is verified manually, often only when filing looms. Missing docs discovered late blow deadlines.
**Frequency.** Per case at multiple stages.
**Impact.** High. A missing deed at filing time stalls the whole recovery.
**Automation.** doc-verify already classifies folder contents and reports present/missing per required type — run it on a cadence per active deal and raise a task for each gap. Data + logic exist; needs orchestration (respecting the on-demand cost rule).

### 12. Notice-letter accuracy depends on a careful human read
**Problem.** Outreach/notice letters must match the deed (name, parcel, address, county). A typo'd letter is a compliance and credibility risk.
**Frequency.** Per outreach letter.
**Impact.** Medium-High. Errors can invalidate notice or confuse owners.
**Automation.** doc-verify already cross-checks the notice letter against deed/profile and lists mismatches. Surface those as blocking review items before a letter goes out.

### 13. Attorney outreach drafting is slow and county-specific
**Problem.** Each filing county has its own attorney, rules, and deadlines. Drafting the right attorney email with the right case facts is manual and repetitive.
**Frequency.** Per case reaching the filing stage; recurring follow-ups.
**Impact.** Medium-High. Slow attorney engagement extends time-to-cash.
**Automation.** Hermes drafts the attorney email from deal context (county, parcel, surplus, deed facts) into a task/clipboard. Drafting is cheap today; *sending* needs Gmail send scope + Mo's approval.

### 14. No county-deadline / filing-status tracking
**Problem.** Surplus claims have statutory windows by county. There's no structured deadline field or countdown — deadlines live in people's heads and notes.
**Frequency.** Every filed/about-to-file case.
**Impact.** Very High. A blown statutory deadline is a total, unrecoverable loss.
**Automation.** Maintain a county-rules/deadline reference; compute days-to-deadline per case and escalate as a top-priority attention flag. Needs a county-rules data set assembled (Hermes can research) + a deadline field; high payoff.

### 15. Probate / legal status research is repetitive and manual
**Problem.** Deceased-owner cases need probate-requirement research per county/estate — done from scratch each time.
**Frequency.** Recurring on the probate subset (a notable share of cases).
**Impact.** Medium-High. Slows a whole class of high-value, complex cases.
**Automation.** Hermes researches probate/filing requirements per county and attaches a structured brief to the case (explicitly within its allowed actions). Reusable across similar cases.

---

## D. Pipeline Hygiene & Visibility

### 16. "What needs attention right now" still needs Mo to assemble it
**Problem.** The attention queue exists, but turning it into a prioritized daily plan — weighting by dollars and urgency, folding in tasks and snoozes — still leans on Mo each morning.
**Frequency.** Daily.
**Impact.** High. Owner time is the company's bottleneck resource; this is recurring cognitive load.
**Automation.** Auto-generated, value-weighted morning briefing delivered proactively (the briefing generator is built). Add weighted priority + delivery so Mo opens to a plan, not raw data.

### 17. Snoozes expire into silence
**Problem.** "Waiting on attorney / county / probate" snoozes wake a deal back into the queue, but there's no proactive nudge when the wait should be over — it just reappears whenever Mo looks.
**Frequency.** Continuous — many active cases are in a waiting state.
**Impact.** Medium-High. Cases that were "parked for a reason" silently overstay their wait, extending time-to-cash.
**Automation.** On snooze expiry, auto-create a "follow up on [waiting_on_X]" task and include it in the briefing. Internal-write only; data exists.

### 18. No value-weighted pipeline health view
**Problem.** Leadership can't quickly see dollars-at-stage, week-over-week movement, or where the book is clogging. Decisions rely on gut feel over 150 cases.
**Frequency.** Weekly/ongoing management need.
**Impact.** Medium. Mostly strategic-allocation cost rather than per-case loss.
**Automation.** Portfolio health rollup: count + total surplus per stage, aging, trend vs. last week. Analytics layer already exists; extend to a weighted health snapshot in the briefing.

### 19. Inbound email/calls aren't triaged to "who needs something"
**Problem.** When an attorney or client emails, or a live call comes in, the "ball is now in our court" signal isn't automatically captured — it waits for someone to read the thread.
**Frequency.** Continuous across active cases.
**Impact.** Medium-High. Slow responses to attorneys/clients stretch every timeline and erode trust.
**Automation.** The AI summary already produces `who_needs_something`; combined with classified live calls and Gmail, auto-raise a response task when the counterparty is waiting on us. Needs continuous Gmail sync (sample done today) + ideally a webhook for real-time.

### 20. Case-status handoffs between Marwa, Kathleen, and Mo lose context
**Problem.** Work passes between three people across four systems; the "where does this case actually stand" picture is reassembled manually at each handoff. The HubSpot deal owner isn't even who works the case, adding confusion.
**Frequency.** Every active case, multiple times through its life.
**Impact.** Medium-High. Re-deriving context is pure waste and a source of dropped balls.
**Automation.** The case Story + CurrentState view models already unify the timeline and produce status/blocker/next-action. Make a one-glance case brief the standard handoff artifact so nobody rebuilds context. Built; needs to be the team norm.

---

## COO's Bottom Line

Three themes account for most of the bleeding:

1. **Data integrity at intake is the root cause of expensive late failures.** #1, #2, #3, #14 — wrong parcel, untracked heir, missed deadline — are low-frequency but catastrophic. Fixing reconciliation and deadline tracking protects the dollars that matter most. Most of the data already exists; it just isn't being compared and escalated.

2. **The team's scarcest resource — live calling and owner-decision time — is spent on low-value motion.** #5, #6, #7, #16 waste dialing hours on dead numbers and unprioritized queues, and waste Mo's mornings assembling what the system could hand him. These are mostly *internal-write* automations with data ready today — fast wins.

3. **The outbound edge is where we're genuinely capability-limited, not data-limited.** Skip-trace execution (#8), attorney/notice sending (#13), and real-time inbound triage (#19) need new integrations (a skip-trace provider, Gmail send scope, continuous sync/webhooks) and must clear the human-approval gate. Higher effort, sequence them after the read-only wins.

**If I could only fund five this quarter:** #2 (deed/CRM reconciliation), #14 (county-deadline tracking), #6 (value-weighted call queue), #7 (auto follow-up tasks), and #3 (untracked-heir detection). Four of the five run on data we already hold — they're orchestration, not new plumbing — and together they defend against the unrecoverable losses while reclaiming the team's most expensive hours.

---

*Method: reviewed SYSTEM_OVERVIEW.md, CURRENT_STATE.md, docs/DOMAIN_MODEL.md, and the prior code-level audit (rules engine, outreach matrix, contact-quality, doc-verify, integration clients). Constraints applied throughout: HubSpot read-only, no external sends without Mo's approval, AI summaries on-demand only. No code written.*
