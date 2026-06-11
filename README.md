# Horizon Recovery — Operations Dashboard

Owner-attention layer on top of HubSpot CRM. Answers: "What needs Mo's attention right now?"

---

## First-time setup

1. Copy `.env.local.example` to `.env.local` and fill in the values (see below)
2. `npm install`
3. `npm run db:generate` — generate Prisma client
4. `npm run db:migrate` — apply schema migrations
5. `vercel login` — one-time browser auth, needed for production log access

---

## Required environment variables (`.env.local`)

| Variable | What it is |
|---|---|
| `HUBSPOT_ACCESS_TOKEN` | HubSpot private app token |
| `DATABASE_URL` | Neon pooled connection string |
| `DIRECT_URL` | Neon direct connection string (Prisma CLI) |
| `DASHBOARD_PASSWORD` | Login password — if it contains `$`, escape each as `\$` in `.env.local` (Vercel UI needs no escaping) |
| `SESSION_SECRET` | Random base64 string — generate with `openssl rand -base64 32` |
| `ANTHROPIC_API_KEY` | Claude API key |
| `CRON_SECRET` | Random string — must match what's set in Vercel env vars |
| `HERMES_TOKEN` | Scoped bearer token for the Hermes agent's write API — `openssl rand -hex 32`; must match Vercel + the VPS `hermes/.env` |
| `DATABASE_URL_READONLY` | SELECT-only Neon role for Hermes reads (see `scripts/create-readonly-role.mjs`) |
| `SENTRY_DSN` *(optional)* | Sentry DSN — activates error tracking if set |

---

## Running locally

```bash
# Always use this — not plain npm run dev
npm run dev:log
```

`dev:log` tees the server output to `/tmp/horizon-dev.log` in addition to your terminal. This lets Claude read the log file directly to diagnose issues without you copy-pasting anything. Every `npm test` run also automatically checks this file and surfaces any errors.

Open [http://localhost:3000](http://localhost:3000).

---

## npm scripts

| Command | What it does |
|---|---|
| `npm run dev:log` | **Default for local dev** — starts Next.js and captures logs to `/tmp/horizon-dev.log` |
| `npm run dev` | Plain dev server (no log file — avoid unless you have a reason) |
| `npm test` | Run Vitest suite + auto-check dev log for errors |
| `npm run smoke` | Hit every protected route without auth — all should return 401/307 |
| `npm run check:logs` | Pull last 2h of production logs via Vercel CLI |
| `npm run db:migrate` | Apply Prisma migrations |
| `npm run db:push` | Push schema without migration (dev only) |
| `npm run db:studio` | Open Prisma Studio |
| `npm run db:seed` | Seed app_settings, stage maps, owner maps |

---

## Testing

```bash
npm test             # run all tests — posttest hook checks dev log automatically
npm run test:watch   # watch mode for active TDD
npm run smoke        # smoke test every API route for auth
```

The `posttest` hook runs `scripts/check-dev-logs.sh` after every test run. If the dev server is running via `dev:log`, any errors or warnings are surfaced automatically — no need to ask Claude to check.

---

## Checking production logs

Requires `vercel login` (one-time).

```bash
npm run check:logs                         # last 2h, all levels
npm run check:logs -- --level error        # errors only
npm run check:logs -- --since 30m          # last 30 minutes
```

Outputs JSON. Claude can run this directly and diagnose the issue.

---

## Working with Claude

- **Start dev**: `npm run dev:log` so logs are captured
- **After a change**: `npm test` — posttest hook surfaces dev log errors automatically
- **Something broke locally**: just say what's wrong, Claude reads `/tmp/horizon-dev.log`
- **Something broke in production**: say "check production logs", Claude runs `npm run check:logs`
- **Auth broken**: run `npm run smoke` — all 16 checks should pass

---

## Hermes — AI agent layer (Discord bot on a VPS)

Hermes is an external Claude agent that triages cases from Discord and writes its conclusions back to
the dashboard. It is **separate from the dashboard** (which stays read-only on Vercel) and lives in
[`hermes/`](hermes/) in this repo, deployed to a VPS under PM2.

**The key architectural rule — facts vs. interpretation:**
- **Business facts** (deals, contacts, activities) are never written by any agent.
- **AI interpretation** (status / health / priority / blockers / next action) is an **append-only**
  layer (`case_analyses`). Each deal's `CurrentState` derives from the latest `triage` analysis.
- Every agent write is **audited** (`agent_audit_log`), **idempotent**, **reversible**, and can be
  killed instantly with a switch. Code deploys and HubSpot stay off-limits / gated.

```
You (Discord) → Hermes bot (VPS, PM2)
                  → reads case facts via a read-only Neon role
                  → Claude proposes a triage analysis (dry-run)
   ← you click "Apply"
                  → writes via the dashboard API (HERMES_TOKEN) → append-only case_analyses
                  → dashboard CurrentState updates
```

### Using it (in Discord)
- `/queue` — list active deals
- `/case deal:<id>` — quick case summary
- `/triage deal:<id>` — Claude proposes an analysis (dry-run); click **Apply** to write it
- **Chat:** @mention the bot or DM it to talk to Hermes in plain language

### Operating it
| Task | How |
|---|---|
| SSH to the VPS | `ssh -i ~/.ssh/hermes_vps mo@<VPS_IP>` (key-only; root login + passwords disabled) |
| Bot status / logs | `pm2 list` · `pm2 logs hermes-bot` |
| Restart the bot | `pm2 restart hermes-bot` |
| **Pause ALL agent writes (kill switch)** | `npx dotenv -e .env.local -- node scripts/agent-writes.mjs off` (`on` to resume) → off makes every agent write return 423 |
| Verify the agent API end-to-end | `npm run dev:log`, then `npx dotenv -e .env.local -- node scripts/verify-hermes.mjs` (self-cleaning) |
| Create/rotate the read-only DB role | `npx dotenv -e .env.local -- node scripts/create-readonly-role.mjs` |
| Audit trail | every agent write is a row in `agent_audit_log` (before/after + correlationId) |

### Update the bot after a code change (from this repo on your Mac)
```bash
rsync -az --exclude node_modules --exclude .env -e "ssh -i ~/.ssh/hermes_vps" hermes/ mo@<VPS_IP>:hermes/
ssh -i ~/.ssh/hermes_vps mo@<VPS_IP> 'cd ~/hermes && npm install && pm2 restart hermes-bot'
```

### VPS facts
- Ubuntu 24.04, Node 20, PM2. Bot runs as user `mo`. App dir `/home/mo/hermes`.
- Secrets live in `/home/mo/hermes/.env`: `HM_BASE_URL`, `HERMES_TOKEN`, `DATABASE_URL_READONLY`,
  `ANTHROPIC_API_KEY`, `DISCORD_BOT_TOKEN`.
- Full agent design + tool details: [`hermes/README.md`](hermes/README.md) and the "Hermes Agent
  Layer" section of [`CLAUDE.md`](CLAUDE.md).

---

## Architecture quick reference

| What | Where |
|---|---|
| Auth (proxy) | `src/proxy.ts` |
| Auth (route helper) | `src/lib/auth/require-session.ts` — use this, never inline cookie checks |
| Structured logger | `src/lib/logger.ts` — use `log.info/warn/error`, not `console.*` |
| HubSpot client | `src/lib/hubspot/client.ts` — all HubSpot calls go here, rate limiter enforced |
| Rules engine | `src/lib/rules/*.ts` — pure functions, no DB imports |
| DB access for rules | `src/lib/db/deals.ts` |
| Full docs | `docs/` — design doc, gameplan, API reference, field mapping |
