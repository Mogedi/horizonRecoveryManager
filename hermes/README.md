# hermes-tools

Agent tools for HorizonManager. Hybrid access, matching the dashboard's Phase 1 contract:

- **Reads** go direct to Neon via a **read-only** role (`DATABASE_URL_READONLY`) — `cases-read.js`.
- **Writes** go through the dashboard HTTP API with the scoped `HERMES_TOKEN` — `hm-api.js`.
  Every write is server-side **audited, idempotent, source-tagged, and kill-switchable**.

This package is developed inside the HorizonManager repo and deployed to the VPS (`~/hermes/`).

## Setup

```bash
cp .env.example .env   # fill in HM_BASE_URL, HERMES_TOKEN, DATABASE_URL_READONLY, ANTHROPIC_API_KEY
npm install            # on the VPS; during repo dev it resolves from the parent node_modules
```

## Commands

```bash
hermes queue                     # list active deals (read-only)
hermes read <dealId>             # dump one case (deal + contacts + recent activity + latest analysis)
hermes triage <dealId>           # propose a triage analysis — DRY RUN (prints, writes nothing)
hermes triage <dealId> --apply   # write the analysis via the API (audited, idempotent)
```

## Safety

- `triage` is **dry-run by default** — review before `--apply`. The dashboard kill switch
  (`agent_writes_enabled`) is the second layer: when off, every write returns 423.
- Re-running `triage` over **unchanged facts** is skipped (the analysis `inputHash` matches the last
  one) — no duplicate rows.
- Writes are **append-only interpretation** (`case_analyses`), tasks, and snoozes. Hermes never
  writes business facts or HubSpot.
