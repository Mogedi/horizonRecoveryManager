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

// ─── Email intake (real-time pipeline) ──────────────────────────────────────────
// Importance triage for the inbox notifier — broadened beyond casework to Mo's whole business +
// legal matters. One cheap Haiku call; also decides whether the full body is worth pulling.
type Importance = 'notify' | 'digest' | 'noise'

async function classifyEmailImportance(
  from: string | null, subject: string | null, preview: string | null
): Promise<{ importance: Importance; pullBody: boolean; reason: string }> {
  const prompt =
    `An email arrived.\nFrom: ${from ?? ''}\nSubject: ${JSON.stringify(subject ?? '')}\n` +
    `Preview: ${JSON.stringify((preview ?? '').slice(0, 300))}\n\n` +
    `Mo runs Horizon Recovery (surplus-funds recovery) and uses this to manage his WHOLE business and ` +
    `legal/attorney matters. Decide:\n` +
    `1. importance: "notify" if it plausibly needs Mo's attention soon — a lawyer/attorney, court/county/clerk, ` +
    `a client or heir, money/payment/invoice/wire, a deadline, a real person doing business, or anything ` +
    `time-sensitive or personal-to-the-business. "digest" if it's a real but non-urgent FYI. "noise" if it's ` +
    `marketing, newsletters, automated receipts, or app notifications.\n` +
    `2. pull_body: true if reading the full body would help decide or matters (anything notify-worthy, or an ` +
    `unfamiliar sender). false for obvious noise.\n` +
    `Bias toward notify and pull_body when unsure — better safe. ` +
    `Respond JSON only: {"importance":"notify|digest|noise","pull_body":boolean,"reason":"<=10 words"}`
  try {
    const txt = await callClaude(prompt, 'You triage email importance. Respond with strict JSON only.', 150, 'claude-haiku-4-5')
    const m = txt.match(/\{[\s\S]*\}/)
    const o = m ? JSON.parse(m[0]) : {}
    const importance: Importance = ['notify', 'digest', 'noise'].includes(o.importance) ? o.importance : 'digest'
    return { importance, pullBody: !!o.pull_body, reason: String(o.reason ?? '').slice(0, 80) }
  } catch {
    return { importance: 'digest', pullBody: true, reason: 'classify failed' }
  }
}

export type IntakeEmail = {
  id: string; from: string | null; subject: string | null; snippet: string | null
  importance: Importance; reason: string; hasBody: boolean; dealName: string | null; link: string
}
export type IntakeResult = {
  fetched: number; notify: IntakeEmail[]; digest: IntakeEmail[]; noiseCount: number; since: string; until: string
}

// Incremental pull since the GOOGLE cursor: classify each new email's importance + decide body,
// upsert (tagged metadata.importance), and return what to notify on now vs roll into the digest.
// This is the 2-minute real-time pipeline (replaces the old periodic gmail-sync).
export async function intakeNewEmails(opts: { maxMessages?: number } = {}): Promise<IntakeResult> {
  const maxMessages = opts.maxMessages ?? 40
  const source = await prisma.syncSource.findUnique({ where: { name: 'GOOGLE' } })
  const since = source?.lastSyncedAt ?? new Date(Date.now() - 24 * 60 * 60 * 1000)
  const until = new Date()
  const query = `after:${Math.floor(since.getTime() / 1000)} before:${Math.floor(until.getTime() / 1000)}`

  const emailMap = await buildEmailDealMap()
  const senderRules = await getAllSenderRules()
  const events: ActivityEventInput[] = []
  const notify: IntakeEmail[] = []
  const digest: IntakeEmail[] = []
  let noiseCount = 0
  let fetched = 0
  let pageToken: string | undefined

  do {
    const remaining = maxMessages - fetched
    if (remaining <= 0) break
    const listRes = await googleClient.listGmailMessages(query, { maxResults: Math.min(remaining, 50), pageToken })
    const ids = listRes.messages ?? []
    if (ids.length === 0) break

    for (const stub of ids) {
      if (fetched >= maxMessages) break
      const msg = await googleClient.getGmailMessage(stub.id, 'metadata')
      fetched++
      const isSent = (msg.labelIds ?? []).includes('SENT')
      const dealId = matchGmailToDeal(msg, emailMap)
      const subject = headerValue(msg, 'subject')
      const fromHeader = headerValue(msg, 'from')
      const sender = firstEmail(fromHeader)

      let importance: Importance = 'digest'
      let reason = ''
      let pullBody = false
      if (isSent) {
        pullBody = true; importance = 'noise'; reason = 'sent by Mo' // sent mail isn't an inbound notification
      } else if (dealId) {
        const c = await classifyEmailImportance(sender, subject, msg.snippet ?? null)
        pullBody = true; importance = c.importance === 'noise' ? 'digest' : c.importance; reason = c.reason || 'case-related'
      } else if (sender && senderRules.has(sender) && senderRules.get(sender) === false) {
        pullBody = false; importance = 'noise'; reason = 'known noise sender'
      } else if (sender && isNoiseHeuristic(sender, subject)) {
        pullBody = false; importance = 'noise'; reason = 'noise heuristic'
        senderRules.set(sender, false)
        await upsertSenderRule(sender, false, { classification: 'noise', reason: 'heuristic', source: 'heuristic' })
      } else {
        const c = await classifyEmailImportance(sender, subject, msg.snippet ?? null)
        importance = c.importance; pullBody = c.pullBody; reason = c.reason
        if (sender) {
          senderRules.set(sender, pullBody)
          await upsertSenderRule(sender, pullBody, { classification: importance, reason, source: 'auto' })
        }
      }

      let bodyText: string | null = null
      let finalMsg: GmailMessage = msg
      if (pullBody) {
        try {
          const full = await googleClient.getGmailMessage(stub.id, 'full')
          bodyText = extractBody(full.payload)
          finalMsg = full
        } catch { /* keep metadata-only */ }
      }
      const ev = mapGmailMessage(finalMsg, dealId, bodyText)
      ev.metadata = JSON.parse(JSON.stringify({ ...(ev.metadata as object), importance, importanceReason: reason }))
      events.push(ev)

      if (!isSent) {
        const item: IntakeEmail = {
          id: msg.id, from: fromHeader, subject, snippet: msg.snippet ?? null,
          importance, reason, hasBody: !!bodyText, dealName: null,
          link: `https://mail.google.com/mail/u/0/#all/${msg.id}`,
        }
        if (importance === 'notify') notify.push(item)
        else if (importance === 'digest') digest.push(item)
        else noiseCount++
      }
    }
    pageToken = listRes.nextPageToken
  } while (pageToken && fetched < maxMessages)

  await upsertActivityEvents(events)
  await prisma.syncSource.upsert({
    where: { name: 'GOOGLE' },
    create: { name: 'GOOGLE', isActive: true, lastSyncedAt: until },
    update: { lastSyncedAt: until, isActive: true },
  })

  return { fetched, notify, digest, noiseCount, since: since.toISOString(), until: until.toISOString() }
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

// Targeted per-deal email pull (for the case-refresh flow). Searches Gmail for messages to/from
// THIS deal's contact addresses only — never the whole mailbox. `since` bounds the window; matched
// mail is deal-related so we pull full bodies. Capped for the Vercel function budget.
export async function syncGmailForDeal(
  dealHubspotId: string,
  since: Date,
  maxMessages = 60
): Promise<{ emails: number; fetched: number; bodies: number; inserted: number }> {
  const contacts = await prisma.dealContact.findMany({ where: { dealHubspotId }, select: { emailList: true } })
  const addrs = new Set<string>()
  for (const c of contacts) {
    const list = Array.isArray(c.emailList) ? (c.emailList as unknown[]) : []
    for (const e of list) if (typeof e === 'string' && e.trim()) addrs.add(e.trim().toLowerCase())
  }
  if (addrs.size === 0) return { emails: 0, fetched: 0, bodies: 0, inserted: 0 }

  const sinceUnix = Math.floor(since.getTime() / 1000)
  const addrClause = [...addrs].map((e) => `from:${e} OR to:${e}`).join(' OR ')
  const query = `after:${sinceUnix} (${addrClause})`

  const events: ActivityEventInput[] = []
  let pageToken: string | undefined
  let fetched = 0
  let bodies = 0
  do {
    const listRes = await googleClient.listGmailMessages(query, { maxResults: Math.min(maxMessages - fetched, 100), pageToken })
    const ids = listRes.messages ?? []
    if (ids.length === 0) break
    for (const stub of ids) {
      if (fetched >= maxMessages) break
      const full = await googleClient.getGmailMessage(stub.id, 'full')
      const bodyText = extractBody(full.payload)
      if (bodyText) bodies++
      events.push(mapGmailMessage(full, dealHubspotId, bodyText))
      fetched++
    }
    pageToken = listRes.nextPageToken
  } while (pageToken && fetched < maxMessages)

  const inserted = await upsertActivityEvents(events)
  return { emails: addrs.size, fetched, bodies, inserted }
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
