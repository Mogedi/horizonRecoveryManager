# Research Agent — Cost, Speed & Architecture (design + findings)

> Decision doc: is the agentic browser flow the right tool, and how to make it cost-effective, fast, and
> scalable. Grounded in our real run costs + 2026 industry practice. **TL;DR: cost is NOT your problem;
> speed + reliability are. The winning pattern is learn-once / replay-cheap + humans for the hard parts.**

## 1. The fact that reframes everything: your real costs

From `research_costs` (live data):
- **Average run: $0.32. Max (the 12-min property deep-dive): $0.90.** Not $20.
- So a full property research run costs **under a dollar.** Cost per query is already cheap.

**Implication:** you are NOT over-engineering on cost — the agent is affordable. The real pain is
**speed (12 min)** and **reliability (GSCCCA blocked, broken links)**. Optimize for *those*, not pennies.

## 2. What the field does (2026 best practice + sources)

**a. Don't run the LLM on every page — learn once, replay cheap.** The dominant cost-effective pattern:
an agent *discovers* the path once, you **record the working method**, and future runs **replay
deterministically with no LLM call**, falling back to the agent only on a cache miss / site change.
- [Web Scraping in the AI Era: Full AI vs Hybrid vs Traditional](https://www.datahen.com/blog/web-scraping-in-the-ai-era/) — build-time AI (generate code once) beats inference-time AI (LLM every page).
- [Kadoa: How AI Is Changing Web Scraping 2026](https://www.kadoa.com/blog/how-ai-is-changing-web-scraping-2026) — agents *maintain* deterministic scrapers, don't run on every extraction.
- Open-source proof of the pattern: [Anansi](https://github.com/mdowis/anansi) (selectors scored by confidence, self-heal, skip-unchanged), [esinecan/agentic-ai-browser](https://github.com/esinecan/agentic-ai-browser) (per-domain success-pattern recording, persistent, built for *small* models), [browser-use/browser-harness](https://github.com/browser-use/browser-harness) (the agent writes its own reusable "skills" for sites). **This is exactly what our `county_sources` table is for.**

**b. Prefer APIs over the browser (10–100×).** Browser tasks ≈ $0.10–0.53; an API/JSON call ≈ $0.001–0.03.
- [Internal APIs Are All You Need (arXiv)](https://arxiv.org/pdf/2604.00694) — the case against browser-first agents. We already prefer GIS REST APIs; keep pushing that.

**c. Text/DOM extraction over screenshots (≈12×).** Text extract ≈ **800 tokens/page**; one screenshot fed
to the model ≈ **10,000+ tokens.**
- [Browser Use: Speed Matters](https://browser-use.com/posts/speed-matters), [AI Agent Token Cost Optimization (Fastio)](https://fast.io/resources/ai-agent-token-cost-optimization/).

**d. Humans + AI co-pilot for the agent-hostile parts.** Hybrid human–AI verification reaches near-100%
accuracy at low cost; agents are bad/expensive at clunky logged-in gov sites and scanned PDFs.
- [The Future of Web Scraping: AI Agents + Human Co-Pilots](https://tendem.ai/blog/future-of-web-scraping-ai-agents-human-co-pilots), [Best Document AI Platforms 2026 (LlamaIndex)](https://www.llamaindex.ai/insights/best-document-processing-software).

## 3. Screenshots — your instinct is correct (and there are TWO kinds)

Don't conflate them:
1. **Vision screenshots fed to the LLM every step** = the expensive one (~10k tokens each). Avoid as a default.
2. **Session *recording*** (Browser Use captures the session as video/screenshots in *its* dashboard for
   YOU to watch) = cheap — it does **not** spend LLM tokens. This is the right "see what it found" tool.

**Best practice = exactly what you said:** turn capture **ON to learn a new/hard site** (worth it once),
record the working route in `county_sources`, then turn it **OFF and replay** the learned route cheaply.
Screenshots are a *learning/verification* tool, not a per-run cost.

## 4. Are you over-engineering? No — but here's the line

You're not over-engineering on cost. The trap is **over-relying on the full agent** for things that should
be an API, a cached route, or a human. The right system is **tiered**:

| Tier | Use for | Cost | Tool |
|---|---|---|---|
| **1. Free/API first** | parcel, owner, value, tax sale, leads — verify + enrich | ~$0.001–0.03 | GIS/qPublic/assessor/Zillow via HTTP/Firecrawl |
| **2. Agent (discover once)** | a new/hard/blocked site; figure it out + **record the route** | ~$0.90 first time, ~$0 after | Browser Use + `county_sources` + session recording ON while learning |
| **3. Human co-pilot** | logged-in gov sites (GSCCCA), scanned tax-deed PDFs | human time | teammate grabs PDFs → Drive → **AI reads + back-checks her analysis** |

Your "free sites verify + extra leads, and a separate Drive system where my teammate uploads and AI
back-checks" idea is **Tier 1 + Tier 3 — a recognized, recommended architecture.** Build it.

## 5. GSCCCA specifically
You logged in via Browser Use, so the session/profile should now pass the login captcha. Next:
- Turn **session recording ON** to watch + learn the GSCCCA flow (cheap).
- Once it completes a lien/deed search, **record the method in `county_sources`** (entryUrl + searchHint)
  so future runs replay it without re-figuring-it-out.
- GSCCCA is a logged-in gov site — a strong **Tier 3 (human co-pilot)** candidate if the browser stays flaky.

## 6. Recommended next builds (in priority order)
1. **Lean into `county_sources` as the learn/replay cache** — after a successful run, the agent records the
   working route per county; future runs consult it first. (Pattern already scaffolded — make the agent
   actually write + reuse it.) Biggest speed + reliability win.
2. **Document capture (on-demand snapshot/PDF)** — fixes broken links (session sites, GSCCCA) AND gives the
   downloadable verification you wanted. The clear "kills 3 birds" build.
3. **Tier-3 Drive back-check track** — teammate uploads PDFs → AI reads + verifies her analysis. We already
   have Google Drive integration + doc classification to build on.
4. Tighten the source list (drop LoopNet-type junk); prefer deep-linkable canonical URLs.

## 6b. Locked decisions (2026-06-15, after ChatGPT cross-check)

Architecture stays — these are the cost-engineering rules going forward:
1. **Hermes is API-only.** No Claude Pro/Max or ChatGPT/Codex subscription for production runs — the
   April 4 2026 third-party-OAuth block + June 15 separate-credit-then-normal-rates change killed the
   subscription-agent model. Pay-per-token API is the path.
2. **Route by difficulty.** Cheap model for extraction / classification / normalization / parsing;
   strong model only for probate reasoning, heir analysis, conflict resolution, final dossier.
3. **Model selection is config-driven** — `cheap_model` / `reasoning_model` / `premium_model`, never
   hardcoded (so we can swap providers/tiers without code changes).
4. **Aggressive routing** — target **~90–95% of calls on the cheap model**; escalate only hard cases.
5. **Cost tracking by category** — LLM, Browser Use, Firecrawl, PropertyRadar, GSCCCA, phone validation,
   other enrichment. Browser + data-source cost may exceed model cost over time; measure all of it.
6. **Caching/replay BEFORE model optimization** — cached county routes, person prior-evidence, extracted
   records, and document summaries save more than any model swap. This is the 10× lever; do it first.

**Engineering priority order:** caching/replay → routing → cost-by-category tracking → browser-cost
reduction. Model swaps are last and low-impact.

## 6c. Routing — implemented & validated (2026-06-15)

**Live config** (Hermes `config.yaml`, set safely via `hermes config set auxiliary.<role>.model …`, backed up to `config.yaml.bak.routing`):
```
Sonnet 4.6  →  main model (reasoning) + auxiliary.compression
Haiku 4.5   →  auxiliary: web_extract, vision, triage_specifier, title_generation,
               profile_describer, curator, kanban_decomposer, skills_hub, approval, mcp
```
`compression` stays on Sonnet because context compaction is lossy and feeds the agent's *memory* —
context drift is a top cause of long-run agent failure, and it's low-volume so the extra cost is negligible.

**Validation — `scripts/extraction-eval.mjs`.** A controlled A/B: identical Georgia source text (property
cards, tax deeds, obituaries, people-search, lien records) fed to Haiku 4.5 and Sonnet 4.6, scored against
hand-verified answers. Deliberately includes **hallucination probes** (fields absent from the source → the
correct answer is null), **mis-attribution probes** (grantor vs grantee, predeceased vs surviving), and a
**long multi-parcel probe**. **Result (2 runs each): Haiku = Sonnet = 100%, zero hallucinations across all
five record types.** Haiku fabricated nothing on the null-probes. Conclusion: routing extraction to Haiku is
empirically safe — no gross deficiency, no fabrication on representative records.

*Limits:* 10 representative items, not live-scraped 5k-token OCR'd PDFs (Haiku's documented weak spot —
long, noisy inputs); that tail is covered by the production telemetry panel. Re-run anytime with `RUNS=3`;
grow the set whenever a real failure appears (the "write a test for every bug" rule).

*Why we can't replay past runs:* evidence packages store the extracted value + a one-line quote, **not** the
raw page fed to extraction — so a clean offline eval needs either this controlled harness or new Hermes
telemetry that captures raw inputs.

## 7. The honest bottom line
The current agentic flow **works and is cheap (<$1/run).** It's **slow and occasionally blocked.** Don't
throw it out — **wrap it**: APIs first, agent to learn-then-cache, humans for the gov-PDF tail. That's how
the field gets cost low, speed high, and accuracy near-100%.
