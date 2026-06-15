# Cost estimation for research runs — plan + critical take

> Goal as stated: predict what a future run costs from past runs, with a formula that self-tweaks as new
> data arrives, then show estimate vs real cost + the error. Real data is the source of truth.
>
> This doc pushes back on parts of that, then proposes a simpler, more useful design.

## Pushback (think like an engineer first)
**1. An estimate is only worth building if it changes a decision.** A predicted number shown next to the
real number, for its own sake, is a vanity metric. The decisions worth driving:
- **Pre-run:** "is this case worth running / what cap do I set?" (property runs are $1–6, heirs $0.3–0.9 —
  10× spread; you'd want to know before spending).
- **During-run:** kill a runaway before it burns $6 (the highest-value guard — see live tally below).
- **Monthly:** forecast spend for budgeting.
Build the estimator to serve *those*, not the side-by-side display.

**2. We already have a per-run cost number we're not using for this — Hermes's token-based self-report**
(`research_costs`), available **immediately** at run end. The Admin API "real cost" is **org-level and
4–24h lagged and NOT per-run** (it's daily aggregates). So **there is no per-run ground-truth from
Anthropic.** The honest model has *four* numbers, not two:

| # | Number | When | Per-run? |
|---|---|---|---|
| 1 | A-priori **estimate** (from past runs) | before run | yes |
| 2 | **Live token tally** (Hermes, accumulating) | during run | yes |
| 3 | **Self-report** `research_costs` (tokens×price) | at finish (immediate) | yes |
| 4 | **Org actual** (Admin Cost API) | +4–24h | **no — daily total only** |

So "estimate vs real, how off" is really **two** calibrations: (a) a-priori estimate vs the per-run
self-report (#1 vs #3), and (b) the sum of self-reports vs the org actual (#3 vs #4) — a **bias factor**
that corrects the self-report to true billed dollars.

**3. Do NOT train an ML model on ~15 runs — it will overfit.** The literature favors MLP/LSTM for agent
cost, but those need lots of data; with our sample, a fancy model is noise. Robust small-data approach:
**grouped median / EWMA + a range** (not a false-precise point). Upgrade to a small regression at ~100+
runs. ([MindStudio: median tokens × volume × safety multiplier](https://www.mindstudio.ai/blog/forecast-ai-token-usage-business), [arXiv agent cost prediction](https://arxiv.org/pdf/2504.03702))

**4. One feature explains most of the variance: `goal`.** property_records vs find_heirs is a 5–10×
difference. So "median by (goal × case_type)" is already a strong v1 — don't over-feature.

## Proposed design (simpler + tied to decisions)
1. **A-priori estimator = recency-weighted (EWMA) median of past runs with the same `(goal, case_type)`**,
   shown as a **range** (p25–p75 / median ± MAD), with global-median fallback when no group history.
   *Self-tweaking falls out for free:* each new actual updates the EWMA — no retraining, fully interpretable.
2. **Live budget guard (the real win):** Hermes's accumulating token tally → "at $X, trending toward $Y."
   **Cap a run at, say, 3× its predicted p75 and kill it** before a runaway hits $6+. This is more valuable
   than the predictor itself.
3. **Per-run actual (immediate) = `research_costs`** (token-based). Treat as the per-run truth-for-now.
4. **Bias factor (periodic) = Σ self-reports ÷ org actual** over a settled window (once Admin API lands).
   A scalar (e.g., self-report runs 0.9× actual) → multiply per-run actuals → **true-cost-equivalent.**
   Recomputes as Admin data settles. This is how the lagged org truth flows back into per-run numbers.
5. **Calibration tracking:** store predicted vs actual per run; track **MAE / MAPE / bias** over time and
   show the estimator's accuracy, so we know how much to trust it. **Real data stays the source of truth;
   the estimate is decorated with its track record.**

## What it drives (the point)
- **Pre-run:** show predicted range + a default cap on the research form / queue.
- **During-run:** auto-kill runaways (budget guard).
- **Monthly forecast:** avg/run × expected volume × safety multiplier.
- **Display (telemetry):** Predicted range → Actual (self-report) → True (bias-adjusted) → error %, plus the
  rolling calibration accuracy.

## Why this is the better solution
- Robust on tiny data (no overfit); fully interpretable (you can read the formula).
- Reuses the immediate self-report we already collect, instead of waiting 4–24h for org data.
- Honest about the data reality (no per-run actual from Anthropic; bias-factor bridges it).
- Self-tweaks with zero ML infra (EWMA + a recomputed scalar).
- Ties to real decisions (cap, kill, forecast), not a vanity number.

## Phasing
1. **EWMA-by-goal estimator + range + calibration store** (predicted vs self-report per run).
2. **Telemetry display:** predicted vs actual vs error + rolling accuracy.
3. **Bias-factor reconciliation** against the Admin API total → true-cost-equivalent.
4. **Budget guard:** pre-run cap + live runaway kill (needs Hermes to expose the live tally / a cap hook).
5. Upgrade to a small regression (goal, case_type, #candidates, county) when ~100+ runs exist.

## Hermes findings (resolved 2026-06-15)
- **No native cost cap** — Hermes bounds **iterations** (max 90 / subagents 50) and **time** (600s/child),
  not dollars. These already put an implicit ceiling on a runaway; a true "stop at $X" is a future Hermes
  change (add cost to `IterationBudget`).
- **No live cost tally exposed** to Horizon (tracked internally only) → no real-time external kill yet; the
  iteration/time caps are the current guard. So **Phase 4's runaway-kill is deferred** (needs a Hermes hook).
- **`pkg.budget` already carries per-run cost drivers** — `{capHit, stepsUsed, sourcesUsed, trestleCalls,
  cacheHits, paidPeopleSearchCalls}`. **Use these in the estimator/calibration** (cost ≈ f(stepsUsed,
  sourcesUsed, trestleCalls); `capHit` flags the expensive/incomplete runs). A-priori still keys on
  `(goal, case_type)` since drivers are only known *after* a run.
- **Conclusion: Phase 1 needs no Hermes changes** — it reads `research_costs` + `pkg.budget`, both already stored.

## Open questions
- Cap policy when we do build the guard: hard-kill vs warn? (Hard-kill risks losing a near-complete run.)
