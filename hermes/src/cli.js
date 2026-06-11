#!/usr/bin/env node
// Local CLI for the Hermes tools (before Discord wiring).
//   hermes queue                     list active deals (read-only)
//   hermes read <dealId>             dump one case
//   hermes triage <dealId>           propose analysis (DRY RUN)
//   hermes triage <dealId> --apply   write the analysis via the API
import { listQueue, getCase, close } from './cases-read.js'
import { triage } from './triage.js'
import { newWorkflow } from './hm-api.js'

const [cmd, arg, ...flags] = process.argv.slice(2)
const apply = flags.includes('--apply')

async function main() {
  if (cmd === 'queue') {
    const rows = await listQueue()
    for (const r of rows) console.log(`${r.hubspot_id}\t${r.stage ?? '-'}\t${r.name ?? ''}`)
    console.log(`\n${rows.length} deals`)
  } else if (cmd === 'read') {
    if (!arg) throw new Error('usage: hermes read <dealId>')
    console.log(JSON.stringify(await getCase(arg), null, 2))
  } else if (cmd === 'triage') {
    if (!arg) throw new Error('usage: hermes triage <dealId> [--apply]')
    const result = await triage(arg)
    if (result.skipped) {
      console.log(`SKIP ${arg}: ${result.reason}`)
      return
    }
    console.log('Proposed analysis:\n' + JSON.stringify(result.analysis, null, 2))
    if (!apply) {
      console.log('\n(dry-run — re-run with --apply to write)')
      return
    }
    const wf = newWorkflow()
    const idem = `hermes:triage:${arg}:${result.inputHash.slice(0, 12)}`
    const written = await wf.postAnalysis(
      arg,
      {
        ...result.analysis,
        analysisType: 'triage',
        generatedFrom: 'hermes-triage',
        inputHash: result.inputHash,
        provider: result.provider,
        model: result.model,
      },
      idem
    )
    console.log(`\nWROTE analysis id=${written.id} (correlationId=${wf.correlationId})`)
  } else {
    console.log('usage: hermes <queue | read <dealId> | triage <dealId> [--apply]>')
    process.exitCode = 1
  }
}

main()
  .catch((e) => {
    console.error('ERROR:', e.message)
    process.exitCode = 1
  })
  .finally(() => close())
