import { NextRequest, NextResponse } from 'next/server'
import { isAuthenticated, unauthorizedResponse } from '@/lib/auth/require-session'
import { getActivitiesForDeal } from '@/lib/db/activities'
import { getActivityEvents } from '@/lib/db/activity-events'
import { getContactsForDeal } from '@/lib/db/contacts'
import { getLatestSummary } from '@/lib/db/summaries'
import { getOpenTaskCountForDeal } from '@/lib/db/tasks'
import { loadOwnerMap } from '@/lib/db/settings'
import { buildCaseEvents } from '@/lib/case/events'
import { buildStoryDays } from '@/lib/case/story'
import { buildCurrentState } from '@/lib/case/state'

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  if (!(await isAuthenticated())) return unauthorizedResponse()

  const { id } = await params

  const [activities, activityEvents, contacts, summary, ownerMap, openTaskCount] =
    await Promise.all([
      getActivitiesForDeal(id),
      getActivityEvents(id),
      getContactsForDeal(id),
      getLatestSummary(id),
      loadOwnerMap(),
      getOpenTaskCountForDeal(id),
    ])

  const events = buildCaseEvents(activities, activityEvents, contacts, ownerMap)
  const days = buildStoryDays(events)
  const currentState = buildCurrentState(summary, openTaskCount)

  return NextResponse.json({
    days: days.map(day => ({
      date: day.date,
      categories: day.categories,
      eventCount: day.eventCount,
      latestEventSummary: day.latestEventSummary,
      events: day.events.map(e => ({
        id: e.id,
        happenedAt: e.happenedAt.toISOString(),
        source: e.source,
        type: e.type,
        category: e.category,
        participants: e.participants,
        outcome: e.outcome,
        summary: e.summary,
        durationSecs: e.durationSecs,
        rawRef: e.rawRef,
      })),
    })),
    currentState: {
      status: currentState.status,
      health: currentState.health,
      blocker: currentState.blocker,
      nextAction: currentState.nextAction,
      lastMeaningfulActivity: currentState.lastMeaningfulActivity,
      openTaskCount: currentState.openTaskCount,
      generatedAt: currentState.generatedAt?.toISOString() ?? null,
      source: currentState.source,
    },
  })
}
