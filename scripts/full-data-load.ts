/**
 * Full data load sequence:
 * 1. Layer 2 sync all 150 deals (contact + activity data from HubSpot)
 * 2. Populate phone_numbers registry from deal contacts
 * 3. JustCall full 90-day sync
 * 4. Re-match any unmatched activity_events now that registry is populated
 */

import { runLayer2Sync } from '@/lib/sync/layer2'
import { populateFromDealContacts } from '@/lib/db/phone-numbers'
import { normalizeToE164 } from '@/lib/integrations/justcall/normalize'
import { syncJustCallFull } from '@/lib/integrations/justcall/sync'
import { prisma } from '@/lib/db/client'
import { ActivitySource } from '@prisma/client'

function log(msg: string, data?: Record<string, unknown>) {
  const ts = new Date().toISOString().slice(11, 19)
  const extra = data ? ' ' + JSON.stringify(data) : ''
  console.log(`[${ts}] ${msg}${extra}`)
}

// ─── Step 1: Layer 2 all deals ────────────────────────────────────────────────

async function layer2AllDeals() {
  const deals = await prisma.deal.findMany({ select: { hubspotId: true, name: true } })
  log(`Layer 2: syncing ${deals.length} deals`)

  let ok = 0
  let failed = 0
  let totalApiCalls = 0

  for (let i = 0; i < deals.length; i++) {
    const deal = deals[i]
    try {
      const result = await runLayer2Sync(deal.hubspotId)
      totalApiCalls += result.apiCallsMade
      ok++
      if (i % 10 === 0 || i === deals.length - 1) {
        log(`Layer 2 progress: ${i + 1}/${deals.length}`, { ok, failed, totalApiCalls })
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      log(`Layer 2 FAILED for ${deal.hubspotId} (${deal.name?.slice(0, 40)})`, { error: msg })
      failed++
    }
  }

  log('Layer 2 complete', { ok, failed, totalApiCalls })
  return { ok, failed, totalApiCalls }
}

// ─── Step 2: Populate phone registry ─────────────────────────────────────────

async function populatePhones() {
  log('Populating phone_numbers from deal_contacts...')
  const result = await populateFromDealContacts(normalizeToE164)
  log('Phone registry populated', result)
  return result
}

// ─── Step 3: JustCall full 90-day sync ───────────────────────────────────────

async function justCallFullSync() {
  // Seed sync_sources first (idempotent)
  const sources = [
    { name: 'HUBSPOT', isActive: true },
    { name: 'JUSTCALL', isActive: false },
    { name: 'GOOGLE', isActive: false },
  ]
  for (const s of sources) {
    await prisma.syncSource.upsert({
      where: { name: s.name },
      create: { name: s.name, isActive: s.isActive },
      update: {},
    })
  }

  log('Starting JustCall full 90-day sync...')
  const report = await syncJustCallFull()
  log('JustCall full sync complete', {
    callsFetched: report.callsFetched,
    callsMatched: report.callsMatched,
    callsUnmatched: report.callsUnmatched,
    dealsUpdated: report.dealsUpdated,
    matchRate: `${Math.round((report.callsMatched / Math.max(report.callsFetched, 1)) * 100)}%`,
    durationMs: report.durationMs,
  })
  return report
}

// ─── Step 4: Re-match unmatched events ────────────────────────────────────────
// Some events were stored before the phone registry was populated.
// Now that phone_numbers is full, update their dealHubspotId.

async function rematchUnmatched() {
  log('Re-matching unmatched activity_events...')

  const unmatched = await prisma.activityEvent.findMany({
    where: { source: ActivitySource.JUSTCALL, dealHubspotId: null },
    select: { id: true, direction: true, toNumber: true, fromNumber: true },
  })

  log(`Found ${unmatched.length} unmatched events`)
  if (unmatched.length === 0) return { rematched: 0 }

  let rematched = 0
  const affectedDealIds = new Set<string>()

  for (const event of unmatched) {
    // For outbound: customer is toNumber. For inbound: customer is fromNumber.
    const contactNumber = event.direction === 'outbound' ? event.toNumber : event.fromNumber
    if (!contactNumber) continue

    const phone = await prisma.phoneNumber.findFirst({
      where: { numberE164: contactNumber },
      select: { dealHubspotId: true },
    })

    if (phone?.dealHubspotId) {
      await prisma.activityEvent.update({
        where: { id: event.id },
        data: { dealHubspotId: phone.dealHubspotId },
      })
      affectedDealIds.add(phone.dealHubspotId)
      rematched++
    }
  }

  log(`Re-matched ${rematched} events, refreshing counts for ${affectedDealIds.size} deals`)

  // Refresh callAttemptCount on affected deals
  for (const dealHubspotId of affectedDealIds) {
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
      data: { callAttemptCount: count, lastCallAttemptAt: lastCall?.happenedAt ?? null },
    })
  }

  log('Re-match complete', { rematched, dealsUpdated: affectedDealIds.size })
  return { rematched, dealsUpdated: affectedDealIds.size }
}

// ─── Main ─────────────────────────────────────────────────────────────────────

async function main() {
  const start = Date.now()
  log('=== Full data load starting ===')

  try {
    const l2 = await layer2AllDeals()
    log(`Step 1 done: Layer 2 — ${l2.ok} ok, ${l2.failed} failed, ${l2.totalApiCalls} HubSpot calls`)

    const phones = await populatePhones()
    log(`Step 2 done: Phone registry — ${phones.inserted} new numbers (${phones.processed} contacts scanned)`)

    const jc = await justCallFullSync()
    log(`Step 3 done: JustCall — ${jc.callsFetched} calls fetched, ${jc.callsMatched} matched`)

    const rm = await rematchUnmatched()
    log(`Step 4 done: Re-match — ${rm.rematched} events updated`)

    const elapsed = Math.round((Date.now() - start) / 1000)
    log('=== Full data load complete ===', { elapsed: `${elapsed}s`, l2ok: l2.ok, l2failed: l2.failed, phones: phones.inserted, callsFetched: jc.callsFetched, matched: jc.callsMatched + rm.rematched })
  } finally {
    await prisma.$disconnect()
  }
}

main()
