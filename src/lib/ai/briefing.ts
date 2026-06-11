import { getOpenTasks } from '@/lib/db/tasks'
import { loadStageMap, loadOwnerMap } from '@/lib/db/settings'
import { getDealsForQueue } from '@/lib/db/deals'
import { getEmployeeActivitySummary } from '@/lib/db/activities'
import { evaluateAll, buildRuleCtx } from '@/lib/rules'
import { getMoActionDealIds } from '@/lib/db/summaries'
import { callClaude, callClaudeStreaming } from './client'
import { AIError } from './errors'
import { log } from '@/lib/logger'

const MAX_FLAGGED_DEALS = 15

const BRIEFING_SYSTEM =
  'You are a business analyst for Horizon Recovery LLC, a surplus funds recovery firm. ' +
  'The owner Mo uses this dashboard every morning to plan his day. ' +
  'Write a concise, action-oriented morning briefing in plain text. ' +
  'Be specific — name deals, name tasks, call out overdue items. ' +
  'Do not hedge or add generic advice. Respond in plain text with no markdown headers.'


async function buildBriefingPrompt(): Promise<string> {
  const today = new Date()
  const dateStr = today.toLocaleDateString('en-US', {
    weekday: 'long', year: 'numeric', month: 'long', day: 'numeric',
    timeZone: 'America/New_York',
  })

  const [{ deals, snoozedDealIds }, stageMap, ownerMap, openTasks, moActionIds] = await Promise.all([
    getDealsForQueue(),
    loadStageMap().catch((err: unknown) => { log.warn('briefing: failed to load stageMap, using empty fallback', { err }); return {} as Record<string, string> }),
    loadOwnerMap().catch((err: unknown) => { log.warn('briefing: failed to load ownerMap, using empty fallback', { err }); return {} as Record<string, string> }),
    getOpenTasks(),
    getMoActionDealIds(),
  ])

  const ctx = await buildRuleCtx(stageMap, snoozedDealIds)
  const results = evaluateAll(deals, ctx)
  const allFlagged = results.filter(r => r.flags.length > 0 && r.flags[0].type !== 'snoozed')
  // Cap at MAX_FLAGGED_DEALS — Mo Action Required items sort to the top
  const flagged = [
    ...allFlagged.filter(r => moActionIds.has(r.deal.hubspotId)),
    ...allFlagged.filter(r => !moActionIds.has(r.deal.hubspotId)),
  ].slice(0, MAX_FLAGGED_DEALS)

  const employeeActivity = await getEmployeeActivitySummary(ownerMap)

  const lines: string[] = [`DAILY BRIEFING — ${dateStr}`, '']

  if (flagged.length === 0) {
    lines.push('ATTENTION QUEUE: No deals need attention right now.')
  } else {
    const totalFlagged = allFlagged.length
    const cap = totalFlagged > MAX_FLAGGED_DEALS ? ` (showing top ${MAX_FLAGGED_DEALS} of ${totalFlagged})` : ''
    lines.push(`ATTENTION QUEUE${cap}:`)
    for (const r of flagged) {
      const name = r.deal.name ?? r.deal.hubspotId
      const stage = stageMap[r.deal.stage ?? ''] ?? r.deal.stage ?? '?'
      const flags = r.flags.map(f => f.message).join('; ')
      const isMoAction = moActionIds.has(r.deal.hubspotId)
      lines.push(`- ${name} [${stage}]${isMoAction ? ' ⚠ Mo Action Required' : ''}: ${flags}`)
    }
  }

  lines.push('')

  if (openTasks.length === 0) {
    lines.push('OPEN TASKS: None.')
  } else {
    lines.push(`OPEN TASKS (${openTasks.length}):`)
    for (const t of openTasks) {
      const deal = t.deal ? ` — ${t.deal.name ?? t.deal.hubspotId}` : ''
      const due = t.dueDate ? ` (due ${new Date(t.dueDate).toLocaleDateString()})` : ''
      lines.push(`- [${t.category}] ${t.title}${deal}${due}`)
    }
  }

  if (employeeActivity) {
    lines.push('')
    lines.push('EMPLOYEE ACTIVITY (last 7 days):')
    for (const ea of employeeActivity) {
      lines.push(`- ${ea.ownerName}: ${ea.notes} notes, ${ea.calls} calls`)
    }
  }

  lines.push('')
  lines.push(
    'Write a concise morning briefing for Mo (2–3 short paragraphs). ' +
    'Start with the most urgent items. Then cover open tasks. ' +
    'If employee activity is included, close with a brief comment on team activity. ' +
    'Be specific and actionable. No generic advice.'
  )

  return lines.join('\n')
}

// Returns a ReadableStream of plain text chunks — caller streams directly to the client.
export async function streamBriefingGeneration(): Promise<ReadableStream<Uint8Array>> {
  const prompt = await buildBriefingPrompt()

  const stream = callClaudeStreaming(prompt, BRIEFING_SYSTEM)

  const encoder = new TextEncoder()

  return new ReadableStream<Uint8Array>({
    async start(controller) {
      try {
        for await (const event of stream) {
          if (event.type === 'content_block_delta' && event.delta.type === 'text_delta') {
            controller.enqueue(encoder.encode(event.delta.text))
          } else if (event.type === 'message_delta' && event.delta.stop_reason === 'max_tokens') {
            controller.enqueue(encoder.encode('\n\n[Briefing truncated — max length reached]'))
          }
        }
      } catch (err) {
        controller.error(new AIError(
          `Briefing stream error: ${err instanceof Error ? err.message : String(err)}`
        ))
      } finally {
        controller.close()
      }
    },
  })
}

// Non-streaming variant — returns the full briefing as a single string. Used by the Hermes
// morning-digest job, which posts the text to Discord (no streaming consumer on that path).
export async function generateBriefingText(maxTokens = 1024): Promise<string> {
  const prompt = await buildBriefingPrompt()
  return callClaude(prompt, BRIEFING_SYSTEM, maxTokens)
}
