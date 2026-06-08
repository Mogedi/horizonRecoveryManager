// Google Workspace sync — Gmail only → activity_events.
// Drive is NOT synced to DB — on-demand search only via /api/deals/[id]/drive.
//
// SECURITY CONSTRAINT (CLAUDE.md): Gmail sync MUST run sample mode (last 7 days,
// max 50 emails) first. Full mode requires Mo's explicit approval in the UI.
// Enforce this by never calling syncGmailFull from auto-triggers.

import { prisma } from '@/lib/db/client'
import { upsertActivityEvents } from '@/lib/db/activity-events'
import { googleClient } from './client'
import { mapGmailMessage } from './mapper'
import { log } from '@/lib/logger'
import type { ActivityEventInput } from '@/lib/db/activity-events'

// ─── Email → deal matching ────────────────────────────────────────────────────

// Build a map of email address → dealHubspotId from deal_contacts.emailList.
async function buildEmailDealMap(): Promise<Map<string, string>> {
  const contacts = await prisma.dealContact.findMany({
    select: { dealHubspotId: true, emailList: true },
  })

  const map = new Map<string, string>()
  for (const c of contacts) {
    if (!c.emailList || !c.dealHubspotId) continue
    const emails = c.emailList as string[]
    if (!Array.isArray(emails)) continue
    for (const email of emails) {
      if (typeof email === 'string' && email.trim()) {
        map.set(email.trim().toLowerCase(), c.dealHubspotId)
      }
    }
  }
  return map
}

// Extract all email addresses from a raw header string like "Alice <alice@example.com>, bob@example.com"
function parseEmailsFromHeader(header: string | null): string[] {
  if (!header) return []
  return Array.from(header.matchAll(/[\w.+\-]+@[\w.\-]+\.[a-z]{2,}/gi), m => m[0].toLowerCase())
}

// Find the deal that best matches a Gmail message by looking up From/To/Cc in the email map.
function matchGmailToDeal(
  msg: { payload?: { headers?: { name: string; value: string }[] }; labelIds?: string[] },
  emailMap: Map<string, string>
): string | null {
  const headers = msg.payload?.headers ?? []
  const relevant = headers.filter(h => ['from', 'to', 'cc'].includes(h.name.toLowerCase()))
  for (const h of relevant) {
    for (const email of parseEmailsFromHeader(h.value)) {
      const dealId = emailMap.get(email)
      if (dealId) return dealId
    }
  }
  return null
}

// ─── Report type ──────────────────────────────────────────────────────────────

export type GmailSyncReport = {
  mode: 'sample' | 'full'
  since: Date
  until: Date
  messagesFetched: number
  messagesMatched: number
  messagesUnmatched: number
  durationMs: number
}

// ─── Gmail sync ───────────────────────────────────────────────────────────────

// SAMPLE MODE: last 7 days, max 50 emails.
// Mo must review and approve before full pull (CLAUDE.md constraint).
export async function syncGmailSample(): Promise<GmailSyncReport> {
  const until = new Date()
  const since = new Date(until.getTime() - 7 * 24 * 60 * 60 * 1000)
  return syncGmailInRange(since, until, 'sample', 50)
}

// FULL MODE: since last sync (or last 90 days on first run).
// Only callable after Mo has explicitly approved in the UI — never auto-triggered.
export async function syncGmailFull(): Promise<GmailSyncReport> {
  const source = await prisma.syncSource.findUnique({ where: { name: 'GOOGLE' } })
  const ninetyDaysAgo = new Date(Date.now() - 90 * 24 * 60 * 60 * 1000)
  const since = source?.lastSyncedAt ?? ninetyDaysAgo
  const until = new Date()
  return syncGmailInRange(since, until, 'full', 500)
}

async function syncGmailInRange(
  since: Date,
  until: Date,
  mode: 'sample' | 'full',
  maxMessages: number
): Promise<GmailSyncReport> {
  const startMs = Date.now()
  log.info('google gmail sync starting', { mode, since: since.toISOString(), until: until.toISOString() })

  // Gmail search query — all mail (inbox + sent) in date range
  const sinceUnix = Math.floor(since.getTime() / 1000)
  const untilUnix = Math.floor(until.getTime() / 1000)
  const query = `after:${sinceUnix} before:${untilUnix}`

  const emailMap = await buildEmailDealMap()

  let messagesFetched = 0
  let messagesMatched = 0
  let messagesUnmatched = 0
  let pageToken: string | undefined

  const events: ActivityEventInput[] = []

  do {
    const remaining = maxMessages - messagesFetched
    if (remaining <= 0) break

    const listRes = await googleClient.listGmailMessages(query, {
      maxResults: Math.min(remaining, 100),
      pageToken,
    })

    const ids = listRes.messages ?? []
    if (ids.length === 0) break

    for (const stub of ids) {
      if (messagesFetched >= maxMessages) break
      const msg = await googleClient.getGmailMessage(stub.id, 'metadata')
      messagesFetched++

      const dealId = matchGmailToDeal(msg, emailMap)
      if (dealId) messagesMatched++
      else messagesUnmatched++

      events.push(mapGmailMessage(msg, dealId))
    }

    pageToken = listRes.nextPageToken
  } while (pageToken && messagesFetched < maxMessages)

  const inserted = await upsertActivityEvents(events)
  log.info('google gmail events upserted', { inserted })

  // Only advance the cursor on full syncs
  if (mode === 'full') {
    await prisma.syncSource.upsert({
      where: { name: 'GOOGLE' },
      create: { name: 'GOOGLE', isActive: true, lastSyncedAt: until },
      update: { lastSyncedAt: until, isActive: true },
    })
  }

  const report: GmailSyncReport = {
    mode, since, until, messagesFetched, messagesMatched, messagesUnmatched,
    durationMs: Date.now() - startMs,
  }
  log.info('google gmail sync complete', report)
  return report
}
