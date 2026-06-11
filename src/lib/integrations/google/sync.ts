// Google Workspace sync — Gmail only → activity_events.
// Drive is NOT synced to DB — on-demand search only via /api/deals/[id]/drive.
//
// Smart body-pulling: most email is noise (app updates, login codes, vendor notices), so we store
// headers only by default and pull the FULL body only when it's worth it. Decision ladder per email:
//   1. sent by me (SENT label)        → full body  (tone-of-voice corpus)
//   2. matched to a deal contact      → full body  (case-related, free signal)
//   3. sender in email_sender_rules   → follow the saved rule
//   4. obvious noise heuristic        → headers only (+ write a skip rule)
//   5. new sender                     → one Haiku classification → write + cache a rule
// 'full' mode = incremental since last sync; 'backfill' = pull all history (GMAIL_BACKFILL_DAYS).

import { prisma } from '@/lib/db/client'
import { upsertActivityEvents } from '@/lib/db/activity-events'
import { getAllSenderRules, upsertSenderRule } from '@/lib/db/email-rules'
import { callClaude } from '@/lib/ai/client'
import { googleClient } from './client'
import { mapGmailMessage } from './mapper'
import { log } from '@/lib/logger'
import type { GmailMessage, GmailMessagePart } from './client'
import type { ActivityEventInput } from '@/lib/db/activity-events'

// ─── Email → deal matching ────────────────────────────────────────────────────

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

function parseEmailsFromHeader(header: string | null): string[] {
  if (!header) return []
  return Array.from(header.matchAll(/[\w.+\-]+@[\w.\-]+\.[a-z]{2,}/gi), m => m[0].toLowerCase())
}

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

function headerValue(msg: GmailMessage, name: string): string | null {
  return (msg.payload?.headers ?? []).find(h => h.name.toLowerCase() === name.toLowerCase())?.value ?? null
}

function firstEmail(header: string | null): string | null {
  const m = (header ?? '').match(/[\w.+\-]+@[\w.\-]+\.[a-z]{2,}/i)
  return m ? m[0].toLowerCase() : null
}

// ─── Body-pull decision (the ladder) ────────────────────────────────────────────

const NOISE_SENDER_RE = /no-?reply|do-?not-?reply|^notifications?@|@(?:notifications?|mail|email|bounce|mailer)\.|noreply|mailer-daemon|postmaster|@.*\.sendgrid\.|@.*\.mailgun\./i
const NOISE_DOMAINS = [
  'letterstream.com', 'auction.com', 'github.com', 'vercel.com', 'accounts.google.com',
  'slack.com', 'stripe.com', 'intuit.com', 'docusign.net', 'calendly.com', 'zoom.us',
  'notion.so', 'figma.com', 'atlassian.net', 'linear.app', 'amazonses.com',
]
const NOISE_SUBJECT_RE = /verification code|verify your|sign[- ]?in|log[- ]?in code|confirm your email|your code is|password reset|one-time|\b2fa\b|receipt|invoice #/i

function isNoiseHeuristic(sender: string, subject: string | null): boolean {
  if (NOISE_SENDER_RE.test(sender)) return true
  const domain = sender.split('@')[1] ?? ''
  if (NOISE_DOMAINS.some(d => domain.includes(d))) return true
  if (subject && NOISE_SUBJECT_RE.test(subject)) return true
  return false
}

async function classifySender(
  sender: string,
  subject: string | null,
  snippet: string | null
): Promise<{ caseRelated: boolean; reason: string }> {
  const prompt =
    `An email arrived from "${sender}".\n` +
    `Subject: ${JSON.stringify(subject ?? '')}\n` +
    `Preview: ${JSON.stringify((snippet ?? '').slice(0, 300))}\n\n` +
    `Is this likely related to a surplus-funds recovery CASE — e.g. from a lawyer, county/court, ` +
    `title company, client, or heir — OR is it NOISE (app/software updates, login or verification ` +
    `codes, marketing, receipts, vendor notifications like LetterStream, property auction listings)?\n` +
    `Respond with JSON only: {"case_related": boolean, "reason": "<=8 words"}`
  try {
    const txt = await callClaude(prompt, 'You classify emails. Respond with strict JSON only.', 120, 'claude-haiku-4-5')
    const m = txt.match(/\{[\s\S]*\}/)
    const obj = m ? JSON.parse(m[0]) : {}
    return { caseRelated: !!obj.case_related, reason: String(obj.reason ?? '').slice(0, 80) }
  } catch (e) {
    log.warn('sender classify failed', { sender, error: e instanceof Error ? e.message : String(e) })
    return { caseRelated: false, reason: 'classify failed' }
  }
}

// ─── Full-body extraction ───────────────────────────────────────────────────────

function decodeB64Url(data: string): string {
  return Buffer.from(data.replace(/-/g, '+').replace(/_/g, '/'), 'base64').toString('utf8')
}

function extractBody(payload: GmailMessage['payload']): string | null {
  if (!payload) return null
  let plain: string | null = null
  let html: string | null = null

  if (payload.body?.data && (!payload.mimeType || payload.mimeType.startsWith('text/'))) {
    const t = decodeB64Url(payload.body.data)
    if (payload.mimeType === 'text/html') html = t
    else plain = t
  }
  const walk = (p: GmailMessagePart) => {
    if (p.mimeType === 'text/plain' && p.body?.data && !plain) plain = decodeB64Url(p.body.data)
    else if (p.mimeType === 'text/html' && p.body?.data && !html) html = decodeB64Url(p.body.data)
    for (const sp of p.parts ?? []) walk(sp)
  }
  for (const p of payload.parts ?? []) walk(p)

  if (plain) return (plain as string).slice(0, 20000)
  if (html) {
    return (html as string)
      .replace(/<style[\s\S]*?<\/style>/gi, ' ')
      .replace(/<[^>]+>/g, ' ')
      .replace(/\s+/g, ' ')
      .trim()
      .slice(0, 20000)
  }
  return null
}

// ─── Report type ──────────────────────────────────────────────────────────────

export type GmailSyncReport = {
  mode: 'sample' | 'full' | 'backfill'
  since: Date
  until: Date
  messagesFetched: number
  messagesMatched: number
  messagesUnmatched: number
  bodiesFetched: number
  durationMs: number
}

// ─── Gmail sync ───────────────────────────────────────────────────────────────

// SAMPLE: last 7 days, max 50. Headers only (no bodies/classification on the cheap sample).
export async function syncGmailSample(): Promise<GmailSyncReport> {
  const until = new Date()
  const since = new Date(until.getTime() - 7 * 24 * 60 * 60 * 1000)
  return syncGmailInRange(since, until, 'sample', 50)
}

// FULL: incremental since last sync (or last 90 days on first run), max 500. Smart bodies.
export async function syncGmailFull(): Promise<GmailSyncReport> {
  const source = await prisma.syncSource.findUnique({ where: { name: 'GOOGLE' } })
  const ninetyDaysAgo = new Date(Date.now() - 90 * 24 * 60 * 60 * 1000)
  const since = source?.lastSyncedAt ?? ninetyDaysAgo
  return syncGmailInRange(since, new Date(), 'full', 500)
}

// BACKFILL: pull ALL history (GMAIL_BACKFILL_DAYS, default 365), paginating fully. Smart bodies.
export async function syncGmailBackfill(): Promise<GmailSyncReport> {
  const days = Number(process.env.GMAIL_BACKFILL_DAYS || 365)
  const since = new Date(Date.now() - days * 24 * 60 * 60 * 1000)
  return syncGmailInRange(since, new Date(), 'backfill', 100000)
}

async function syncGmailInRange(
  since: Date,
  until: Date,
  mode: 'sample' | 'full' | 'backfill',
  maxMessages: number
): Promise<GmailSyncReport> {
  const startMs = Date.now()
  log.info('google gmail sync starting', { mode, since: since.toISOString(), until: until.toISOString() })

  const sinceUnix = Math.floor(since.getTime() / 1000)
  const untilUnix = Math.floor(until.getTime() / 1000)
  const query = `after:${sinceUnix} before:${untilUnix}`

  const emailMap = await buildEmailDealMap()
  const senderRules = await getAllSenderRules() // Map<sender, pullBody> — learned + cached this run

  // 'sample' stays headers-only (cheap pre-approval pull); full/backfill apply the smart ladder.
  const smart = mode !== 'sample'

  let messagesFetched = 0
  let messagesMatched = 0
  let messagesUnmatched = 0
  let bodiesFetched = 0
  let inserted = 0
  let pageToken: string | undefined

  do {
    const remaining = maxMessages - messagesFetched
    if (remaining <= 0) break

    const listRes = await googleClient.listGmailMessages(query, {
      maxResults: Math.min(remaining, 100),
      pageToken,
    })

    const ids = listRes.messages ?? []
    if (ids.length === 0) break

    // Accumulate per page, then flush — so a long backfill commits incrementally
    // (resilient to mid-run failure) instead of one all-or-nothing write at the end.
    const events: ActivityEventInput[] = []

    for (const stub of ids) {
      if (messagesFetched >= maxMessages) break
      const msg = await googleClient.getGmailMessage(stub.id, 'metadata')
      messagesFetched++

      const dealId = matchGmailToDeal(msg, emailMap)
      if (dealId) messagesMatched++
      else messagesUnmatched++

      let bodyText: string | null = null
      let finalMsg: GmailMessage = msg

      if (smart) {
        const isSent = (msg.labelIds ?? []).includes('SENT')
        const subject = headerValue(msg, 'subject')
        const sender = firstEmail(headerValue(msg, 'from'))

        let pullBody: boolean
        if (isSent || dealId) pullBody = true
        else if (!sender) pullBody = false
        else if (senderRules.has(sender)) pullBody = senderRules.get(sender)!
        else if (isNoiseHeuristic(sender, subject)) {
          pullBody = false
          senderRules.set(sender, false)
          await upsertSenderRule(sender, false, { classification: 'noise', reason: 'heuristic', source: 'heuristic' })
        } else {
          const c = await classifySender(sender, subject, msg.snippet ?? null)
          pullBody = c.caseRelated
          senderRules.set(sender, pullBody)
          await upsertSenderRule(sender, pullBody, {
            classification: pullBody ? 'case_related' : 'noise',
            reason: c.reason,
            source: 'auto',
          })
        }

        if (pullBody) {
          try {
            const full = await googleClient.getGmailMessage(stub.id, 'full')
            bodyText = extractBody(full.payload)
            finalMsg = full
            if (bodyText) bodiesFetched++
          } catch (e) {
            log.warn('gmail full fetch failed', { id: stub.id, error: e instanceof Error ? e.message : String(e) })
          }
        }
      }

      events.push(mapGmailMessage(finalMsg, dealId, bodyText))
    }

    inserted += await upsertActivityEvents(events)
    log.info('google gmail page flushed', { inserted, messagesFetched, bodiesFetched })

    pageToken = listRes.nextPageToken
  } while (pageToken && messagesFetched < maxMessages)

  log.info('google gmail events upserted', { inserted, bodiesFetched })

  // Advance the cursor on full + backfill (not sample).
  if (mode !== 'sample') {
    await prisma.syncSource.upsert({
      where: { name: 'GOOGLE' },
      create: { name: 'GOOGLE', isActive: true, lastSyncedAt: until },
      update: { lastSyncedAt: until, isActive: true },
    })
  }

  const report: GmailSyncReport = {
    mode, since, until, messagesFetched, messagesMatched, messagesUnmatched, bodiesFetched,
    durationMs: Date.now() - startMs,
  }
  log.info('google gmail sync complete', report)
  return report
}
