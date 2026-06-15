# Research Agent — accurate cost tracking plan (real Anthropic spend + per-run + dossier link)

> Mo's ask: (1) the telemetry page isn't showing the latest runs; (2) track the **actual** Anthropic API
> spend (what Hermes really burns in API credits, separate from Claude Code's subscription usage); (3)
> connect each dossier to its cost row in telemetry. Plan first, then build.

## The core insight (why there are two cost numbers)
There are **two** sources of research cost, and we currently only show the weaker one:

| Source | What it is | Granularity | Accuracy | Shows Haiku/Sonnet split? |
|---|---|---|---|---|
| **`research_costs`** (today) | Hermes's *self-estimated* `estimated_cost_usd`, posted by costSync | **per run** (→ dossier) | estimate; tags only the **main** model | ❌ lumps everything under Sonnet |
| **Anthropic Admin API** (new) | the **real billed $** Anthropic charges | **daily**, by model / key / workspace | ground truth | ✅ real Haiku vs Sonnet $ |

The Console numbers Mo watched (org credits $14.51→$13.82, i.e. **~$0.69 for the Albert run**) come from the
**Admin API source** — that's Hermes burning org API credits. Claude Code (the assistant) bills separately
(subscription), so it does **not** draw these credits. We want both sources: Admin API for *truth + model
split*, `research_costs` for *per-run/per-dossier attribution*. Then reconcile them.

## Part 1 — Fix "latest runs don't show" (the real bug)
**Root cause (already diagnosed):** costSync is dead — `execSync` reading the session export hits its 1 MB
default buffer → `ENOBUFS` every 2 min, so **no new run has synced since it broke**. That's why the newest
row is Rodney Mullis (Jun 13) and the Jun 15 Albert run (#12 / dossier 11) is missing. It's not an ordering
bug — it's missing data.
- **Fix:** the staged one-line change (`maxBuffer: 256MB`) in `hermes/src/research-worker.js` + restart the
  worker. After that, #12 and all future runs sync; the table is ordered newest-first (`createdAt desc`).
- **Needs:** Mo's OK to deploy to the VPS worker (gated — agent write to prod infra).
- Once synced we get our **first reconciliation point:** compare #12's self-estimate vs the ~$0.69 actual.

## Part 2 — Track the REAL Anthropic spend (Admin Usage + Cost API)
Pull the authoritative numbers into the telemetry page.
- **Endpoints** ([docs](https://platform.claude.com/docs/en/manage-claude/usage-cost-api)):
  - `GET /v1/organizations/cost_report` — USD by **workspace / model / token-type**, daily buckets.
  - `GET /v1/organizations/usage_report/messages` — tokens by **api_key / workspace / model / service tier**.
- **What it gives us that the self-report can't:** the **real Haiku-vs-Sonnet dollar split** — the definitive
  answer to "did the routing actually save money," in billed dollars, not estimates.
- **Display on the telemetry page:** a "Real Anthropic spend" panel — org credit balance + month-to-date
  (the Console cards), plus a **daily cost-by-model** chart/table for the research key (last 30/60 d).
- **Attribution — the important design choice.** The Admin API groups by **api_key / workspace**. To cleanly
  isolate *research* spend (and separate Hermes from Claude Code and anything else):
  - **Recommended:** give Hermes a **dedicated Anthropic workspace (or at least a dedicated API key)**, e.g.
    "Hermes Research." Then `cost_report` filtered to that workspace = pure research spend.
  - This also directly answers Mo's "track what Claude [Code] is using too": with separate keys, the by-key
    view shows **Hermes vs Claude Code vs other** side by side. (If Claude Code is on a subscription, it
    simply won't appear in `cost_report` — already separated.)
- **Auth / secrets:** needs an **Admin API key** (`sk-ant-admin…`, created by Mo in Console → it's org-wide,
  read-only usage here). Lives in Horizon's env (Vercel) since the telemetry page (Horizon) pulls it —
  `ANTHROPIC_ADMIN_KEY`, never in repo. New integration module `src/lib/integrations/anthropic-admin/`
  (Boundary 2: one `request()`, `bottleneck` limiter, error class). Cache responses ~30–60 min (daily data).

## Part 3 — Reconcile self-report vs actual
- Show, per period: **self-reported total** (sum of `research_costs`) vs **actual** (Admin cost_report), and
  the ratio. Tells us how trustworthy the per-run estimates are.
- Optionally scale each run's estimate by the reconciliation factor to show a "best-estimate actual / run."
- If the gap is large, that's a signal to improve what Hermes reports (or rely on the daily actual).

## Part 4 — Connect dossier ↔ telemetry (bidirectional)
- **Telemetry run row → dossier:** add `dossierId` to `getResearchRunTelemetry` (join `request.dossierId`);
  each row links to its dossier in the Research view.
- **Dossier → telemetry:** the dossier detail already shows cost (now summed correctly) — make it a link
  ("$0.90 · view cost") that deep-links to that run's row on the telemetry page (anchor by run key).
- Result: click a dossier → see its cost → jump to the telemetry breakdown, and back.

## Separation: Hermes vs Claude Code (Mo's question, explicit)
- **Hermes** (research worker) = burns this org's **Anthropic API credits** → shows in Console + Admin API.
- **Claude Code** (this assistant) = separate billing (subscription); does **not** draw these credits.
- Clean tracking = **distinct API keys/workspaces per consumer**; the Admin API's by-key grouping then
  attributes each. Recommend a dedicated Hermes key/workspace so research spend is unambiguous.

## What Mo provides (infra/secrets — your side)
1. **OK to deploy the costSync fix** to the VPS worker (Part 1).
2. **Create an Admin API key** in Console (Settings → Admin keys) → I'll wire it as `ANTHROPIC_ADMIN_KEY`.
3. **(Recommended)** a dedicated **Anthropic workspace + API key for Hermes** so research spend isolates
   cleanly from Claude Code / other usage. (If you'd rather not, we filter by the existing Hermes key.)

## Phasing
1. **Part 1** — deploy costSync fix → latest runs appear (immediate; needs your OK).
2. **Part 4** — dossier ↔ telemetry links (cheap, pure Horizon).
3. **Part 2** — Admin API "real spend" panel (needs admin key; the big value — real model split).
4. **Part 3** — reconciliation view (after both data sources flow).

## Open questions
- Dedicated Hermes workspace/key, or filter the existing key? (Affects attribution cleanliness.)
- Admin key in Horizon env (Vercel) vs Hermes pulling + posting? (Lean Horizon-direct, read-only.)
- `cost_report` minimum bucket = daily — fine for trend/reconciliation; per-run stays from `research_costs`.
