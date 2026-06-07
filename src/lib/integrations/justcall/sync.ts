import { prisma } from '@/lib/db/client'
import { upsertActivityEvents, type ActivityEventInput } from '@/lib/db/activity-events'
import { lookupDealByPhone, upsertPhoneNumber } from '@/lib/db/phone-numbers'
import { getJustCallClient } from './client'
import { log } from '@/lib/logger'
import type { NormalizedCallLog } from '@/lib/integrations/phone-provider'
import { ActivitySource } from '@prisma/client'

export type SyncReport = {
  mode: 'sample' | 'full'
  since: Date
  until: Date
  callsFetched: number
  callsMatched: number     // calls matched to a deal via phone_numbers
  callsUnmatched: number   // calls with no matching deal (phone not in registry)
  callsSkipped: number     // calls that couldn't be normalized (bad phone data)
  dealsUpdated: number     // deals whose callAttemptCount was refreshed
  durationMs: number
}

// Match a NormalizedCallLog to a deal via the phone_numbers registry.
// Returns the dealHubspotId or null if no match found.
async function matchCallToDeal(call: NormalizedCallLog): Promise<string | null> {
  // For all calls: match on the contact's number (customer's phone).
  // contact_number is the customer for both inbound and outbound.
  const dealId = await lookupDealByPhone(call.contactNumberE164)
  return dealId
}

// Convert a NormalizedCallLog to an ActivityEventInput for DB insertion.
function toActivityEvent(call: NormalizedCallLog, dealHubspotId: string | null): ActivityEventInput {
  const isOutbound = call.direction === 'outbound'
  return {
    dealHubspotId,
    source: ActivitySource.JUSTCALL,
    externalId: call.externalId,
    type: 'call',
    happenedAt: call.happenedAt,
    durationSecs: call.durationSecs,
    direction: call.direction,
    outcome: call.outcome,
    fromNumber: isOutbound ? call.lineNumberE164 : call.contactNumberE164,
    toNumber: isOutbound ? call.contactNumberE164 : call.lineNumberE164,
    agentId: call.agentId,
    body: call.notes,
    rawPayload: call.rawPayload,
  }
}

// Refresh callAttemptCount and lastCallAttemptAt on deals that were touched by this sync.
// Counts only outbound calls (JUSTCALL source, type=call, direction=outbound).
async function refreshDealCallCounts(dealIds: Set<string>): Promise<number> {
  let updated = 0
  for (const dealHubspotId of dealIds) {
    const [count, lastCall] = await Promise.all([
      prisma.activityEvent.count({
        where: { dealHubspotId, source: ActivitySource.JUSTCALL, type: 'call', direction: 'outbound' },
      }),
      prisma.activityEvent.findFirst({
        where: { dealHubspotId, source: ActivitySource.JUSTCALL, type: 'call', direction: 'outbound' },
        orderBy: { happenedAt: 'desc' },
        select: { happenedAt: true },
      }),
    ])

    await prisma.deal.updateMany({
      where: { hubspotId: dealHubspotId },
      data: {
        callAttemptCount: count,
        lastCallAttemptAt: lastCall?.happenedAt ?? null,
      },
    })
    updated++
  }
  return updated
}

// Core sync function — fetches calls in the given range and writes to activity_events.
async function syncCallsInRange(
  since: Date,
  until: Date,
  mode: 'sample' | 'full'
): Promise<SyncReport> {
  const startMs = Date.now()
  const client = getJustCallClient()

  log.info('justcall sync starting', { mode, since: since.toISOString(), until: until.toISOString() })

  const calls = await client.getCallLogs(since, until)
  const callsFetched = calls.length
  let callsMatched = 0
  let callsUnmatched = 0
  let callsSkipped = 0

  const events: ActivityEventInput[] = []
  const matchedDealIds = new Set<string>()

  for (const call of calls) {
    const dealId = await matchCallToDeal(call)
    if (dealId) {
      callsMatched++
      matchedDealIds.add(dealId)

      // Register the phone number if not already in registry
      await upsertPhoneNumber(call.contactNumberE164, dealId, { contactName: undefined })
    } else {
      callsUnmatched++
      // Store unmatched calls too — they might be matched later when phone_numbers is populated
    }
    events.push(toActivityEvent(call, dealId))
  }

  const inserted = await upsertActivityEvents(events)
  log.info('justcall events upserted', { inserted })

  // Refresh callAttemptCount on all affected deals
  const dealsUpdated = await refreshDealCallCounts(matchedDealIds)

  // Update sync_sources record
  await prisma.syncSource.upsert({
    where: { name: 'JUSTCALL' },
    create: { name: 'JUSTCALL', isActive: true, lastSyncedAt: new Date() },
    update: { lastSyncedAt: new Date(), isActive: true },
  })

  const report: SyncReport = {
    mode,
    since,
    until,
    callsFetched,
    callsMatched,
    callsUnmatched,
    callsSkipped,
    dealsUpdated,
    durationMs: Date.now() - startMs,
  }

  log.info('justcall sync complete', { ...report, since: since.toISOString(), until: until.toISOString() })
  return report
}

// Sample mode: last 72 hours of calls — Mo reviews this before approving full pull.
// No record cap — pulls all calls in the 72h window.
export async function syncJustCallSample(): Promise<SyncReport> {
  const until = new Date()
  const since = new Date(until.getTime() - 72 * 60 * 60 * 1000)
  return syncCallsInRange(since, until, 'sample')
}

// Full mode: since last sync (or last 90 days for first run).
// Only call this after Mo has reviewed and approved the sample.
export async function syncJustCallFull(): Promise<SyncReport> {
  const source = await prisma.syncSource.findUnique({ where: { name: 'JUSTCALL' } })
  const ninetyDaysAgo = new Date(Date.now() - 90 * 24 * 60 * 60 * 1000)
  const since = source?.lastSyncedAt ?? ninetyDaysAgo
  const until = new Date()
  return syncCallsInRange(since, until, 'full')
}
