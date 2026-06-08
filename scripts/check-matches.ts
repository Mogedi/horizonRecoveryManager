import { prisma } from '@/lib/db/client'

async function main() {
  const matched = await prisma.activityEvent.findMany({
    where: { dealHubspotId: { not: null }, source: 'JUSTCALL' },
    select: {
      dealHubspotId: true, happenedAt: true, direction: true,
      outcome: true, toNumber: true, fromNumber: true, durationSecs: true,
    },
    orderBy: { happenedAt: 'desc' },
  })

  const deal = matched[0]?.dealHubspotId
    ? await prisma.deal.findUnique({
        where: { hubspotId: matched[0].dealHubspotId },
        select: { hubspotId: true, name: true, stage: true, callAttemptCount: true, lastCallAttemptAt: true },
      })
    : null

  console.log('Matched events:', matched.length)
  matched.forEach(e => console.log(' ', e.happenedAt.toISOString().slice(0, 16), e.direction, e.outcome, e.toNumber, `${e.durationSecs}s`))
  console.log('Deal:', deal)
  await prisma.$disconnect()
}

main()
