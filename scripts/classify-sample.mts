// Sample validation: process James Baker's 5 answered outbound calls
// and print transcript + classification so Mo can manually verify results.
import { prisma } from '../src/lib/db/client'
import { processCall } from '../src/lib/integrations/call-classifier/index'

async function main() {
  const events = await prisma.activityEvent.findMany({
    where: {
      dealHubspotId: '321285583585',  // TROUP - James Baker
      source: 'JUSTCALL',
      direction: 'outbound',
      outcome: 'answered',
    },
    select: { id: true, durationSecs: true, happenedAt: true },
    orderBy: { happenedAt: 'asc' },
    take: 5,
  })

  console.log(`Processing ${events.length} James Baker calls...\n`)

  for (const ev of events) {
    const date = ev.happenedAt.toISOString().slice(0, 10)
    console.log(`─── Event ${ev.id} | ${date} | ${ev.durationSecs}s ───`)
    try {
      const result = await processCall(ev.id)
      console.log(`  classification: ${result.classification}`)
      console.log(`  whisper secs:   ${result.whisperSecs}`)
      console.log(`  transcript:     ${result.transcript.slice(0, 200)}`)
      if (result.summary) {
        console.log(`  summary:        ${result.summary}`)
      }
    } catch (err) {
      console.log(`  ERROR: ${err instanceof Error ? err.message : String(err)}`)
    }
    console.log()
  }

  await prisma.$disconnect()
}

main()
