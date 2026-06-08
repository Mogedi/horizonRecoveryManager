import { prisma } from '../src/lib/db/client'

const classified = await prisma.callTranscript.count()
process.stdout.write(`Total classified: ${classified}\n`)

type DealRow = { deal_hubspot_id: string; name: string | null; classified_calls: number }
const dealsRaw = await prisma.$queryRaw<DealRow[]>`
  SELECT
    ae.deal_hubspot_id,
    d.name,
    COUNT(ct.id)::int as classified_calls
  FROM call_transcripts ct
  JOIN activity_events ae ON ae.id = ct.activity_event_id
  JOIN deals d ON d.hubspot_id = ae.deal_hubspot_id
  GROUP BY ae.deal_hubspot_id, d.name
  ORDER BY classified_calls DESC
`

process.stdout.write(`Deals with data: ${dealsRaw.length}\n\n`)
for (const r of dealsRaw) {
  const name = (r.name ?? '(unnamed)').slice(0, 50).padEnd(52)
  process.stdout.write(`  ${name} ${String(r.classified_calls).padStart(3)} calls\n`)
}

await prisma.$disconnect()
