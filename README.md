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
