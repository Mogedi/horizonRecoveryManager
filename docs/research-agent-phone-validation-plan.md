# Research Agent — Phone Validation (Trestle) integration plan

> Goal: for every phone number we capture, get a real signal on **(1) is it a live number** and
> **(2) is it actually associated with the person** — so we keep the good numbers, flag the bad ones, and
> can tell the searcher "this one failed, try for a better one" — *without* burning time or money.

## 1. Why / what Mo asked for
- We pull phones from two places: **research evidence** (people-search, obituaries, etc.) and **deal
  contacts** (HubSpot / JustCall). Today we have no objective signal on whether a number is live or right.
- Want: rank phones by quality, surface bad ones, and optionally trigger a *bounded* re-search for a
  better number when the best one fails. "At least try to get better feedback on which phones are good/bad."

## 2. Trestle APIs (verified June 2026) — which to use
| API | Price | Returns | Our use |
|---|---|---|---|
| **Phone Validation** | **$0.015**/query | `is_valid`, `activity_score` (0–100, 12-mo activity; 0=disconnected), `line_type` (mobile/landline/**NonFixedVOIP**/…), carrier, prepaid | **Liveness — run on every phone** |
| **Real Contact** | **$0.03**/query | validates phone **+ name + address** together → contactability + match grade | **Association — run selectively** on keep-worthy phones |
| Reverse Phone | $0.07/query | owner name(s), associated people, addresses | Discover *whose* number it is (lead-gen / "wrong owner" diagnosis) |

Trestle's own recommended liveness rule: `is_valid === true && line_type !== "NonFixedVOIP" && activity_score > 30`.

Sources: [Phone Validation API](https://trestleiq.com/phone-validation-api/) · [Activity Score](https://trestleiq.com/knowledge-base/how-do-you-read-trestles-phone-activity-score/) · [Real Contact](https://blog.clickpointsoftware.com/trestle-real-contact) · [Reverse Phone](https://trestleiq.com/reverse-phone-api/) · [Pricing](https://trestleiq.com/pricing/) · [API docs (Redocly)](https://trestle-api.redoc.ly/) · [Postman collection](https://www.postman.com/trestleiq/trestle-identity-data-apis/overview)

## 3. Strategy — Real Contact is a superset (VERIFIED via live test 2026-06-15)
Live test finding: **Real Contact ($0.03) already returns the liveness fields** (`is_valid`,
`activity_score`, `line_type`) ALONGSIDE the association (`name_match`) and `contact_grade` — in ONE call.
Since research always has a name to match against, we don't need a separate Phone Validation call:
- **Primary: one Real Contact call per (phone, attributed person)** → liveness + association + grade together.
  ~$0.03/phone → **$0.06–0.15/case** (2–5 phones). Negligible, but tracked (see §7).
- **Phone Validation ($0.015, liveness-only) is optional** — only useful for numbers with no name to match,
  and it requires enabling that product on the account (the trial key returns **403** for it until access is
  requested in the Trestle portal). For our flow, skip it.
- Match `name_match` against the person the phone is *attributed* to (claimant OR a specific heir — not always
  the claimant). Reuse `nameKey()` for our own cross-check on top of Trestle's boolean.

## 4. Phone quality model (signals → verdict — DERIVED, not captured)
Horizon derives a verdict band per phone from the stored validation facts:

| Verdict | Rule |
|---|---|
| ✅ **good** | `is_valid && activity_score > 30 && line_type != NonFixedVOIP` **and** (Real Contact match = person) |
| ⚠️ **uncertain** | live but no association check run, OR `activity_score` 1–30, OR association = "partial" |
| ❌ **bad** | `!is_valid` OR `activity_score == 0` (disconnected) OR association = "different owner" |

`activity_score` doubles as the **ranking** key — prefer the highest-activity live number.

## 5. Architecture fit — facts vs interpretation (unchanged boundary)
This must follow the same rule as the rest of research: **the agent captures facts; Horizon derives
interpretation.**
- **Hermes calls Trestle** during the run and writes the raw result as **immutable evidence** — a new
  evidence kind `phone_validation` (provenance `sourceId: "trestle"`, the response payload). It never
  writes a "good/bad" judgment.
- **Horizon's `derive.ts`** maps that evidence → the verdict band (§4) and attaches it to
  `contactRankings`. Re-derivable: the band recomputes from stored evidence; we **never** re-call Trestle
  on derive.
- Reuse the existing **`nameKey()` order-insensitive matcher** (already in `derive.ts`) to compare the
  Real Contact / Reverse Phone owner name against the subject — same logic that fixed property linkage.

This is the only correct seam: a paid, non-deterministic external call belongs in the runtime (Hermes),
not in the pure derivation step.

## 6. Where it runs
- **Primary — research run.** After Hermes captures candidate phones, it validates them (Tier 1), runs
  association on the keepers (Tier 2), writes `phone_validation` evidence. Playbook gets a new step.
- **Secondary (optional, later) — deal contacts.** A batch pass that validates phones already in
  `phone-numbers.ts` / deal contacts, surfaced on the Contacts quality page. Same evidence + derive path.

## 7. Cost + caching (the levers Mo cares about)
- **Cache by number.** Before any paid call, check whether we already validated this exact E.164 number
  recently (TTL ~60–90 days — `activity_score` is a slow-moving 12-month signal). Reuse instead of paying
  again. Mirrors `getPriorEvidenceByName` (reuse-before-pay). Store in evidence or a small
  `phone_validations` cache table keyed on number.
- **Cost-by-category.** Trestle is its own line in the cost model (the cost-architecture doc already lists
  "phone validation"). Track Trestle spend per run alongside LLM / Browser Use / Firecrawl on the
  telemetry page. Tier-1 vs Tier-2 counts logged separately.
- **Never validate junk.** Normalize + dedupe to E.164 first (we already do in `justcall/normalize.ts`);
  skip obviously-malformed numbers before spending.

## 8. The bounded "find a better number" loop
- After validation, the agent has ranked, verdict-tagged phones. If **no `good` number exists** *and*
  budget remains, Hermes does **one** targeted re-search for an alternate (e.g., a different people-search
  source). Hard cap: **1 retry**, only when zero good numbers — this is the "don't waste time" guardrail.
- Either way the dossier records what happened: "best number ⚠️ low activity; 1 alternate search, none
  better" — so Mo/the searcher sees the effort and the verdict, not a silent gap.

## 9. Data model
- New evidence kind in `research/types.ts`: `phone_validation` with `{ number, isValid, activityScore,
  lineType, carrier, prepaid, association?: { matchedName, grade } }`.
- `derive.ts`: extend `contactRankings` (or `RankedContact`) with `validation: { verdict, activityScore,
  lineType }`.
- Optional cache table `phone_validations` (number unique, payload JSONB, validatedAt) for reuse.
- New integration module per Boundary 2: `src/lib/integrations/trestle/` — one `request()`, a `bottleneck`
  limiter in `rate-limiters.ts`, a `TrestleError`. (But the *calls happen on Hermes* — so the runtime side
  lives in the worker; the Horizon module is for the optional deal-contact pass + types.)

## 10. UI surfacing
- **Dossier contact card:** a badge per phone — `✅ Live · mobile · activity 85` / `⚠️ low activity` /
  `❌ disconnected` / `⚠️ different owner`. Sort by verdict then activity score.
- **Verification card:** show Trestle as a source row (number → verdict + the raw fields), consistent with
  the existing "this came from here" verification UI.
- **Telemetry:** Trestle cost in the cost-by-category breakdown.

## 11. Phased rollout
1. **MVP — liveness only.** Phone Validation on captured phones → `phone_validation` evidence → verdict
   band + badge. Answers "live or not." (Cheapest, biggest signal.)
2. **Association.** Add Real Contact on keepers → "tied to this person" using `nameKey` match.
3. **Bounded retry loop** (§8) + the deal-contact batch pass.
4. **Caching table** if reuse volume justifies it (start by reusing evidence).

## 12. Secrets
`TRESTLE_API_KEY` → VPS `/opt/data/.env` (Hermes runtime) + local `.env.local`. **Never** in repo, docs,
logs, or git. The key was visible in a setup screenshot shared in chat — rotate it once integrated.

## 13. Verified API reference (June 2026)
Confirmed from Trestle docs; test harness: `scripts/trestle-test.mjs` (reads `TRESTLE_API_KEY`).

- **Phone Validation** (liveness, ~$0.015): `GET https://api.trestleiq.com/3.2/phone?phone=<E164>`
  - Header: `x-api-key: <key>`. `phone` accepts E.164 or local (default +1).
  - Returns: `is_valid`, `activity_score` (0–100; <30 ≈ disconnected, 70+ high confidence), `line_type`
    (`Mobile`/`Landline`/`NonFixedVOIP`/…), `carrier`, `is_prepaid`, `country_calling_code`.
  - Liveness rule: `is_valid && activity_score > 30 && line_type != "NonFixedVOIP"`.
- **Real Contact** (association, ~$0.03): `GET https://api.trestleiq.com/2.0/real_contact?phone=&name=&address.street_line_1=&address.city=&address.state_code=&address.postal_code=`
  - Header: `x-api-key`. Required: `phone` + `name` (or `first_name`/`last_name`). Optional: `email`,
    `address.*`, `ip_address`, `add_ons` (e.g. `litigator_checks` — TCPA risk, useful for outreach).
  - Returns `phone.{contact_grade A–F, is_valid, activity_score, line_type, name_match}` — **`name_match`
    is the association signal** ("is who they say they are"); `contact_grade` is overall contactability.

### Still to confirm (cheap, once the key is live)
- **Batch** endpoint to validate N numbers in one call (cut per-call overhead)? — check docs/Postman.
- **Rate limits** on trial vs paid (for the `bottleneck` limiter config).
- Real-world `name_match`/`contact_grade` behavior on a known-good vs known-bad pair (run the harness).
- Trial window — confirm plan/limits before production reliance.
