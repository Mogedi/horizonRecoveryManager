import { prisma } from '@/lib/db/client'
import { getOpenTasks } from '@/lib/db/tasks'
import { loadStageMap, loadOwnerMap } from '@/lib/db/settings'
import { getDealsForQueue } from '@/lib/db/deals'
import { evaluateAll, buildRuleCtx } from '@/lib/rules'
import { getMoActionDealIds } from '@/lib/db/summaries'
import { callClaude } from './client'
import { AIError } from './errors'

const BRIEFING_SYSTEM =
  'You are a business analyst for Horizon Recovery LLC, a surplus funds recovery firm. ' +
  'The owner Mo uses this dashboard every morning to plan his day. ' +
  'Write a concise, action-oriented morning briefing in plain text. ' +
  'Be specific — name deals, name tasks, call out overdue items. ' +
  'Do not hedge or add generic advice. Respond in plain text with no markdown headers.'

type EmployeeActivity = { ownerName: string; notes: number; calls: number }

async function getEmployeeActivity(ownerMap: Record<string, string>): Promise<EmployeeActivity[] | null> {
  const sevenDaysAgo = new Date()
  sevenDaysAgo.setDate(sevenDaysAgo.getDate() - 7)

  const rows = await prisma.dealActivity.groupBy({
    by: ['authorOwnerId', 'type'],
    where: {
      timestamp: { gte: sevenDaysAgo },
      type: { in: ['note', 'call'] },
    },
    _count: { id: true },
  })

  if (rows.length === 0) return null

  const byOwner = new Map<string, { notes: number; calls: number }>()
  for (const row of rows) {
    const id = row.authorOwnerId ?? 'unknown'
    if (!byOwner.has(id)) byOwner.set(id, { notes: 0, calls: 0 })
    const entry = byOwner.get(id)!
    if (row.type === 'note') entry.notes += row._count.id
    else if (row.type === 'call') entry.calls += row._count.id
  }

  return Array.from(byOwner.entries()).map(([id, counts]) => ({
    ownerName: ownerMap[id] ?? id,
    ...counts,
  }))
}

export async function runBriefingGeneration(): Promise<string> {
  const today = new Date()
  const dateStr = today.toLocaleDateString('en-US', {
    weekday: 'long', year: 'numeric', month: 'long', day: 'numeric',
    timeZone: 'America/New_York',
  })

  const [{ deals, snoozedDealIds }, stageMap, ownerMap, openTasks, moActionIds] = await Promise.all([
    getDealsForQueue(),
    loadStageMap().catch(() => ({} as Record<string, string>)),
    loadOwnerMap().catch(() => ({} as Record<string, string>)),
    getOpenTasks(),
    getMoActionDealIds(),
  ])

  const ctx = buildRuleCtx(stageMap, snoozedDealIds)
  const results = evaluateAll(deals, ctx)
  const flagged = results.filter(r => r.flags.length > 0 && r.flags[0].type !== 'snoozed')

  const employeeActivity = await getEmployeeActivity(ownerMap)

  // Build prompt
  const lines: string[] = [`DAILY BRIEFING — ${dateStr}`, '']

  if (flagged.length === 0) {
    lines.push('ATTENTION QUEUE: No deals need attention right now.')
  } else {
    lines.push(`ATTENTION QUEUE (${flagged.length} deal${flagged.length !== 1 ? 's' : ''}):`)
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

  const prompt = lines.join('\n')

  let text: string
  try {
    text = await callClaude(prompt, BRIEFING_SYSTEM, 2048)
  } catch (err) {
    if (err instanceof AIError) throw err
    throw new AIError(`Briefing generation failed: ${err instanceof Error ? err.message : String(err)}`)
  }

  return text
}
