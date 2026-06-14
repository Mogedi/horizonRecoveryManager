# Logged-in Property Sources — Setup (PropertyRadar + GSCCCA)

How to give the research agent access to logged-in sites for a real property run. **One system: the VPS
runs the agent against a Browser Use Cloud browser that uses a saved, already-logged-in PROFILE per site.**
Your local browser is NOT involved (that's a separate tool). Credentials live in ONE place (a VPS secret),
never in code, the playbook, evidence, logs, or git.

## The model (why profiles, not passwords-per-run)

```
Dashboard (enqueue)  →  Neon queue  →  Hermes on VPS  →  Browser Use Cloud browser
                                                          └─ uses saved profile "propertyradar" (already logged in)
                                                          └─ uses saved profile "gsccca"        (already logged in)
```
- A **profile** stores the logged-in session (cookies). The agent reuses it → no password typing per run,
  and it survives 2FA/captcha (you cleared those once, by hand, when you created the profile).
- The raw password is a **VPS secret**, used only to *seed or refresh* a profile — not on every run.

## One-time setup (your side — Nous Hermes / Browser Use portal)

1. **Create a logged-in profile per site.** In the Browser Use Cloud portal, open a cloud browser with a
   new named profile (`propertyradar`, then `gsccca`), use the **live view** to log in by hand (incl. any
   2FA), confirm you're in, and **save the profile**. Now the session is stored.
2. **Store the credentials as VPS secrets** (for later refresh), e.g. in `hermes/.env` on the VPS:
   `PROPERTYRADAR_USER`, `PROPERTYRADAR_PASS`, `GSCCCA_USER`, `GSCCCA_PASS`. **Never** commit these; they
   stay on the VPS only.
3. **Point the agent at the profiles.** The playbook already says "use the saved logged-in PROFILE for that
   site." Make the profile names available to the Browser Use tool config (platform side) so it picks
   `propertyradar` / `gsccca` when hitting those hosts.
4. **Residential proxy** is on by default for Browser Use Cloud — nothing to do.

## Refresh (when a session expires)

Re-open the profile's cloud browser, log in again (using the stored secret or by hand), re-save. Optional
later: a small refresh step that logs in from the secret automatically. Start manual; automate if it lapses often.

## Deploy + run (the actual real run)

1. **Deploy the playbook** to the VPS: `hermes/research-playbook.md` → `/opt/data/research-playbook.md`
   (via `hermes/deploy.sh` or a `git pull` + copy on the VPS).
2. **Confirm the research worker is running** (PM2 `hermes-research-worker`) so it drains the queue.
3. **From the dashboard:** run the name first (`find_heirs`) to get people + relations, then click
   **🏠 Run property search now** (or the form with goal `property_records`) on the address.
4. **Watch it live** on the research page (progress) → open the dossier → review the **linkage**,
   **transaction history**, **liens**, **coverage checklist**, and the **Verify — by source** cards
   (PropertyRadar / GSCCCA / qPublic each with their quote + Open↗ link to confirm).

## Security checklist

- Credentials only in VPS secrets (`hermes/.env`). Not in the repo, playbook, evidence, dossiers, logs, or git.
- `docs/research/` and `.env*` stay gitignored.
- The agent references profiles by name, never raw credentials.
