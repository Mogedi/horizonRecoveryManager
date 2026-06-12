// Per-case refresh — pull the LATEST for one deal from all three sources (HubSpot Layer 2,
// JustCall, Gmail), scoped to that deal only, then stamp lastRefreshedAt. Freshness-gated by a TTL
// so repeated lookups don't re-pull. Each source is independent (one failing doesn't fail the rest).
import { prisma } from '@/lib/db/client'
import { runLayer2Sync } from './layer2'
import { syncJustCallFull } from '@/lib/integrations/justcall/sync'
import { syncGmailForDeal } from '@/lib/integrations/google/sync'
import { isGoogleConfigured } from '@/lib/integrations/google/auth'
import { log } from '@/lib/logger'

const TTL_MS = 30 * 60 * 1000          // 30 min — within this, serve the DB (config: freshness window)
const FIRST_LOOKBACK_MS = 90 * 24 * 60 * 60 * 1000 // first refresh looks back 90 days

export type CaseRefreshResult = {
  dealHubspotId: string
  skipped: boolean
  reason?: string
  lastRefreshedAt: string | null
  hubspot?: unknown
  calls?: unknown
  emails?: unknown
}

async function settle<T>(label: string, p: Promise<T>): Promise<T | { error: string }> {
  try { return await p } catch (e) {
    const error = e instanceof Error ? e.message : String(e)
    log.warn(`case refresh: ${label} failed`, { error })
    return { error }
  }
}

export async function refreshDeal(dealHubspotId: string, opts: { force?: boolean } = {}): Promise<CaseRefreshResult> {
  const deal = await prisma.deal.findUnique({ where: { hubspotId: dealHubspotId }, select: { lastRefreshedAt: true } })
  if (!deal) throw new Error('deal not found')

  const last = deal.lastRefreshedAt
  if (!opts.force && last && Date.now() - last.getTime() < TTL_MS) {
    return { dealHubspotId, skipped: true, reason: 'fresh', lastRefreshedAt: last.toISOString() }
  }

  const since = last ?? new Date(Date.now() - FIRST_LOOKBACK_MS)
  log.info('case refresh starting', { dealHubspotId, since: since.toISOString() })

  const hubspot = await settle('layer2', runLayer2Sync(dealHubspotId))
  // JustCall: incremental global sync (only new calls since the last sync — tiny and self-
  // throttling via its own cursor, and reliably matched). JustCall's per-contact filter proved
  // inconsistent with our stored numbers (line-vs-contact mismatches), so we don't target by number.
  const calls = await settle('justcall', syncJustCallFull())
  const emails = isGoogleConfigured()
    ? await settle('gmail', syncGmailForDeal(dealHubspotId, since))
    : { skipped: 'google not configured' }

  const now = new Date()
  await prisma.deal.update({ where: { hubspotId: dealHubspotId }, data: { lastRefreshedAt: now } })
  log.info('case refresh complete', { dealHubspotId })

  return { dealHubspotId, skipped: false, lastRefreshedAt: now.toISOString(), hubspot, calls, emails }
}
