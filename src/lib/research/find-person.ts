// find_person — the orchestrator behind the MCP tool / research page.
// Picks matching adapters, applies the circuit breaker (skip sources with a high recent block
// rate), runs them, resolves candidates into a dossier, and persists it (append-only).
import type { PersonQuery, Dossier } from './types'
import { adaptersFor } from './sources'
import { runResearch } from './runner'
import { buildDossier } from './dossier'
import { resolveCounty } from './geo'
import { saveDossier, getSourceHealth } from '@/lib/db/research'

export interface FindPersonOptions {
  persist?: boolean // default true
  proxyUsed?: boolean
}

export async function findPerson(
  query: PersonQuery, opts: FindPersonOptions = {},
): Promise<{ dossier: Dossier; dossierId: number | null; skipped: string[] }> {
  const q: PersonQuery = { ...query, state: (query.state || 'GA').toUpperCase() }

  // qPublic is keyed by COUNTY, but Mo searches by address — derive the county (and confirm state)
  // from the address when not supplied. Free Census geocoder; failure just leaves county unset.
  if (!q.county && q.address) {
    const geo = await resolveCounty([q.address, q.city, q.state].filter(Boolean).join(', ')).catch(() => null)
    if (geo) {
      q.county = geo.county
      if (geo.state) q.state = geo.state.toUpperCase()
    }
  }

  const all = adaptersFor(q)

  // Circuit breaker: skip a source if it's been mostly blocked over the last week.
  const health = await getSourceHealth(7).catch(() => [])
  const open = new Set(health.filter(h => h.attempts >= 4 && h.blockRate >= 0.6).map(h => h.sourceId))

  const { candidates, attempts, skipped } = await runResearch(all, q, {
    proxyUsed: opts.proxyUsed,
    persist: opts.persist,
    shouldSkip: a => open.has(a.id),
  })

  const dossier = buildDossier(q, candidates, attempts)
  const dossierId = opts.persist === false ? null : await saveDossier(dossier)
  return { dossier, dossierId, skipped }
}
