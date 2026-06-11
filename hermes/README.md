# hermes-tools

The Hermes agent for HorizonManager: a **Discord bot** that triages cases with Claude, plus the CLI
tools behind it. Hybrid access, matching the dashboard's contract:

- **Reads** go direct to Neon via a **read-only** role (`DATABASE_URL_READONLY`) — `cases-read.js`.
- **Writes** go through the dashboard HTTP API with the scoped `HERMES_TOKEN` — `hm-api.js`. Every
  write is server-side **audited, idempotent, source-tagged, and kill-switchable**.

Developed inside the HorizonManager repo; deployed to the VPS at `/home/mo/hermes` and run under PM2.

## Files
| File | What |
|---|---|
| `src/bot.js` | Discord bot — slash commands + chat + the Apply-to-write confirm gate |
| `src/chat.js` | Conversational Hermes (Claude) with short per-channel memory |
| `src/triage.js` | Read case → Claude → validated analysis (dry-run; `inputHash` skip) |
| `src/cases-read.js` | Read-only Postgres reads (deals, contacts, activity, latest analysis) |
| `src/hm-api.js` | Scoped HTTP write client (token + `Idempotency-Key` + `X-Correlation-Id`) |
| `src/cli.js` | Local CLI (`queue` / `read` / `triage`) for testing without Discord |
| `ecosystem.config.cjs` | PM2 process config (loads `.env` via Node `--env-file`) |

## In Discord
- `/queue` — list active deals
- `/case deal:<id>` — case summary
- `/triage deal:<id>` — propose an analysis (dry-run) → **Apply** button writes it (audited)
- **Chat** — @mention the bot or DM it to talk to Hermes in plain language
  (works without the privileged Message Content intent; mentions and DMs deliver content)

## Environment (`hermes/.env` on the VPS, `600`)
```
HM_BASE_URL=https://<your-vercel-url>     # dashboard base URL
HERMES_TOKEN=...                          # must match the dashboard's HERMES_TOKEN (Vercel)
DATABASE_URL_READONLY=...                 # SELECT-only Neon role
ANTHROPIC_API_KEY=...                     # triage + chat
DISCORD_BOT_TOKEN=...                     # the bot login token
DISCORD_OWNER_ID=...                      # optional — restricts who can click "Apply"
```

## Operations (on the VPS)
```bash
ssh -i ~/.ssh/hermes_vps mo@<VPS_IP>
pm2 list                 # status
pm2 logs hermes-bot      # live logs
pm2 restart hermes-bot   # restart
pm2 start ecosystem.config.cjs   # first start
pm2 save                 # persist the process list
# boot persistence (run once, needs sudo):
pm2 startup systemd -u mo --hp /home/mo
#   → paste & run the "sudo env PATH=… pm2 startup …" line it prints
```

## Deploy an update (from the repo on your Mac)
```bash
rsync -az --exclude node_modules --exclude .env -e "ssh -i ~/.ssh/hermes_vps" hermes/ mo@<VPS_IP>:hermes/
ssh -i ~/.ssh/hermes_vps mo@<VPS_IP> 'cd ~/hermes && npm install && pm2 restart hermes-bot'
```

## Local dev (against the repo's node_modules)
```bash
npx dotenv -e ../.env.local -- node src/cli.js queue
npx dotenv -e ../.env.local -- node src/cli.js triage <dealId>          # dry-run
npx dotenv -e ../.env.local -- node src/cli.js triage <dealId> --apply  # writes
```

## Safety
- `triage` is **dry-run by default** — review before Apply. The dashboard **kill switch**
  (`agent_writes_enabled`) is the second layer: when off, every write returns 423.
- Re-running `triage` over **unchanged facts** is skipped (analysis `inputHash` matches the last one).
- Writes are **append-only interpretation** (`case_analyses`), tasks, and snoozes. Hermes never
  writes business facts or HubSpot.
