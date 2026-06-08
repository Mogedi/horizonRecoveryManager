import { getDealOutreachMatrix } from '@/lib/db/outreach'
import { prisma } from '@/lib/db/client'

async function main() {
  // Top 3 deals by call count to validate the matrix
  const deals = await prisma.deal.findMany({
    where: { callAttemptCount: { gt: 0 }, contacts: { some: {} } },
    select: { hubspotId: true, name: true, callAttemptCount: true },
    orderBy: { callAttemptCount: 'desc' },
    take: 3,
  })

  for (const deal of deals) {
    const matrix = await getDealOutreachMatrix(deal.hubspotId)
    console.log(`\n─── ${deal.name?.slice(0, 60)} ───`)
    console.log(`  Outreach days:    ${matrix.outreachDays}`)
    console.log(`  Total calls:      ${matrix.totalOutboundCalls}`)
    console.log(`  Contacts:         ${matrix.contactsReached}/${matrix.contactsTotal} reached`)
    console.log(`  Last called:      ${matrix.lastCalledAt?.toISOString().slice(0, 10) ?? 'never'}`)
    console.log(`  Days summary:`)
    matrix.days.slice(-5).forEach(d =>
      console.log(`    ${d.date}  ${d.callCount} calls  ${d.answeredCount} answered  [${d.contactsReached.join(', ')}]`)
    )
    console.log(`  Contacts:`)
    matrix.contacts.forEach(c => {
      const reachedStr = c.reached ? '✓ reached' : '✗ not reached'
      console.log(`    ${c.name ?? 'Unknown'} (${c.totalAttempts} attempts) — ${reachedStr}`)
      c.phones.forEach(p => {
        const last = p.lastOutcome ?? 'never called'
        console.log(`      ${p.numberE164}  ${p.attempts.length} calls  last: ${last}  answered: ${p.everAnswered}`)
      })
    })
  }

  await prisma.$disconnect()
}

main()
