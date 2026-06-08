/**
 * Reset lastSyncedAt cursor and run the full 90-day JustCall pull, then re-match all unmatched events.
 */

import { syncJustCallFull } from '@/lib/integrations/justcall/sync'
import { prisma } from '@/lib/db/client'
import { ActivitySource } from '@prisma/client'

function log(msg: string, data?: Record<string, unknown>) {
  const ts = new Date().toISOString().slice(11, 19)
  console.log(`[${ts}] ${msg}${data ? ' ' + JSON.stringify(data) : ''}`)
}

async function rematchUnmatched() {
  const unmatched = await prisma.activityEvent.findMany({
    where: { source: ActivitySource.JUSTCALL, dealHubspotId: null },
    select: { id: true, direction: true, toNumber: true, fromNumber: true },
  })

  log(`Unmatched events to re-process: ${unmatched.length}`)
  if (unmatched.length === 0) return { rematched: 0, dealsUpdated: 0 }

  let rematched = 0
  const affectedDealIds = new Set<string>()

  for (const event of unmatched) {
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

  return { rematched, dealsUpdated: affectedDealIds.size }
}

async function main() {
  // Reset the cursor so syncJustCallFull goes back 90 days
  await prisma.syncSource.upsert({
    where: { name: 'JUSTCALL' },
    create: { name: 'JUSTCALL', isActive: true, lastSyncedAt: null },
    update: { lastSyncedAt: null },
  })
  log('Cursor reset — will pull from 90 days ago')

  log('Starting JustCall full 90-day sync...')
  const report = await syncJustCallFull()
  const matchRate = `${Math.round((report.callsMatched / Math.max(report.callsFetched, 1)) * 100)}%`
  log('JustCall full sync done', {
    callsFetched: report.callsFetched,
    callsMatched: report.callsMatched,
    callsUnmatched: report.callsUnmatched,
    dealsUpdated: report.dealsUpdated,
    matchRate,
    durationMs: report.durationMs,
  })

  log('Re-matching remaining unmatched events...')
  const rm = await rematchUnmatched()
  log('Re-match done', rm)

  // Final summary
  const totalEvents = await prisma.activityEvent.count({ where: { source: ActivitySource.JUSTCALL } })
  const stillUnmatched = await prisma.activityEvent.count({
    where: { source: ActivitySource.JUSTCALL, dealHubspotId: null },
  })
  const matched = totalEvents - stillUnmatched
  log('=== Final state ===', {
    totalJustCallEvents: totalEvents,
    matched,
    stillUnmatched,
    matchRate: `${Math.round((matched / Math.max(totalEvents, 1)) * 100)}%`,
  })

  await prisma.$disconnect()
}

main()
