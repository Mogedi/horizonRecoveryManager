/**
 * Find deals with the richest outreach data (contacts + calls) and dump
 * a fixture snapshot for use in unit tests.
 */
import { prisma } from '@/lib/db/client'
import { ActivitySource } from '@prisma/client'
import * as fs from 'fs'

async function main() {
  // Find deals that have both contacts AND matched JustCall activity
  const dealsWithCalls = await prisma.deal.findMany({
    where: {
      callAttemptCount: { gt: 0 },
      contacts: { some: {} },
    },
    select: {
      hubspotId: true,
      name: true,
      stage: true,
      callAttemptCount: true,
      lastCallAttemptAt: true,
      contacts: {
        select: {
          contactHubspotId: true,
          name: true,
          contactType: true,
          phoneNumbers: true,
        },
      },
    },
    orderBy: { callAttemptCount: 'desc' },
    take: 5,
  })

  console.log(`Found ${dealsWithCalls.length} deals with calls + contacts`)
  dealsWithCalls.forEach(d => console.log(`  ${d.hubspotId} — ${d.name?.slice(0, 50)} — ${d.callAttemptCount} calls`))

  // For each deal, grab their activity events
  const fixtures: Record<string, unknown>[] = []
  for (const deal of dealsWithCalls) {
    const events = await prisma.activityEvent.findMany({
      where: { dealHubspotId: deal.hubspotId, source: ActivitySource.JUSTCALL },
      select: {
        id: true,
        externalId: true,
        happenedAt: true,
        direction: true,
        outcome: true,
        fromNumber: true,
        toNumber: true,
        durationSecs: true,
        agentId: true,
      },
      orderBy: { happenedAt: 'asc' },
    })

    fixtures.push({ deal, events })
    console.log(`  ${deal.hubspotId}: ${events.length} events`)
  }

  const out = JSON.stringify(fixtures, null, 2)
  fs.writeFileSync('docs/research/outreach-fixtures.json', out)
  console.log(`\nWrote ${fixtures.length} fixtures to docs/research/outreach-fixtures.json`)
  console.log('Total events in fixtures:', fixtures.reduce((n, f) => n + (f as { events: unknown[] }).events.length, 0))

  await prisma.$disconnect()
}

main()
