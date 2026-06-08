// Backfill script: classify all historical answered outbound JustCall calls.
// Processes in batches of 50, rate-limited to avoid hammering APIs.
// Safe to re-run — upserts on activityEventId so already-classified calls are skipped.
//
// Usage:
//   npx dotenv -e .env.local -- npx tsx scripts/classify-backfill.mts
//   npx dotenv -e .env.local -- npx tsx scripts/classify-backfill.mts --limit 20  (sample run)
import { prisma } from '../src/lib/db/client'
import { batchProcessCalls } from '../src/lib/integrations/call-classifier/index'
import { getUnclassifiedAnsweredCallIds } from '../src/lib/db/call-transcripts'

const BATCH_SIZE = 50
const DELAY_MS = 1200   // ~50 req/min — well under Whisper 500/min, generous for JustCall URLs

async function main() {
  const limitArg = process.argv.includes('--limit')
    ? parseInt(process.argv[process.argv.indexOf('--limit') + 1], 10)
    : Infinity

  const totalUnclassified = await prisma.activityEvent.count({
    where: { source: 'JUSTCALL', direction: 'outbound', outcome: 'answered', transcript: null },
  })

  console.log(`Total unclassified answered outbound calls: ${totalUnclassified}`)
  const toProcess = Math.min(totalUnclassified, isFinite(limitArg) ? limitArg : totalUnclassified)
  console.log(`Will process: ${toProcess}\n`)

  let totalProcessed = 0
  let totalFailed = 0
  const classifyCounts: Record<string, number> = { live: 0, voicemail: 0, disconnected: 0, unknown: 0 }
  const startMs = Date.now()

  while (totalProcessed + totalFailed < toProcess) {
    const remaining = toProcess - totalProcessed - totalFailed
    const batchLimit = Math.min(BATCH_SIZE, remaining)
    const ids = await getUnclassifiedAnsweredCallIds(batchLimit)
    if (ids.length === 0) break

    const { processed, failed, results } = await batchProcessCalls(ids, {
      delayMs: DELAY_MS,
      onProgress: (done, total, result) => {
        const totalDone = totalProcessed + totalFailed + done
        const pct = Math.round((totalDone / toProcess) * 100)
        if ('error' in result) {
          process.stdout.write(`\r[${pct}%] ${totalDone}/${toProcess} — ERROR: ${result.error.slice(0, 60)}`)
        } else {
          process.stdout.write(`\r[${pct}%] ${totalDone}/${toProcess} — ${result.classification} (${result.whisperSecs}s)  `)
        }
      },
    })

    for (const r of results) classifyCounts[r.classification]++
    totalProcessed += processed
    totalFailed += failed

    if (ids.length < batchLimit) break  // no more unclassified calls
  }

  const elapsedMin = ((Date.now() - startMs) / 60000).toFixed(1)
  console.log(`\n\n─── Complete ───`)
  console.log(`  Processed: ${totalProcessed}`)
  console.log(`  Failed:    ${totalFailed}`)
  console.log(`  Time:      ${elapsedMin} min`)
  console.log(`\n  Classifications:`)
  console.log(`    live:         ${classifyCounts.live}`)
  console.log(`    voicemail:    ${classifyCounts.voicemail}`)
  console.log(`    disconnected: ${classifyCounts.disconnected}`)
  console.log(`    unknown:      ${classifyCounts.unknown}`)

  await prisma.$disconnect()
}

main().catch(err => {
  console.error('\nFatal:', err)
  process.exit(1)
})
