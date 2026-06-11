import { NextRequest, NextResponse } from 'next/server'
import { isAuthenticated, unauthorizedResponse } from '@/lib/auth/require-session'
import { getActivitiesForDeal } from '@/lib/db/activities'
import { getActivityEvents } from '@/lib/db/activity-events'
import { getContactsForDeal } from '@/lib/db/contacts'
import { getLatestSummary } from '@/lib/db/summaries'
import { getLatestAnalysis } from '@/lib/db/case-analysis'
import { getOpenTaskCountForDeal } from '@/lib/db/tasks'
import { loadOwnerMap } from '@/lib/db/settings'
import { buildCaseEvents } from '@/lib/case/events'
import { buildStoryDays } from '@/lib/case/story'
import { buildCurrentState } from '@/lib/case/state'
import type { AnalysisStateInput } from '@/lib/case/state'
import type { CaseHealthStatus } from '@/lib/case/types'

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  if (!(await isAuthenticated())) return unauthorizedResponse()

  const { id } = await params

  const [activities, activityEvents, contacts, summary, latestAnalysis, ownerMap, openTaskCount] =
    await Promise.all([
      getActivitiesForDeal(id),
      getActivityEvents(id),
      getContactsForDeal(id),
      getLatestSummary(id),
      getLatestAnalysis(id),
      loadOwnerMap(),
      getOpenTaskCountForDeal(id),
    ])

  // Prefer the latest triage analysis (AI-interpretation layer); fall back to ai_summaries.
  const analysisState: AnalysisStateInput = latestAnalysis
    ? {
        health: latestAnalysis.health as CaseHealthStatus,
        statusLabel: latestAnalysis.statusLabel,
        blockers: latestAnalysis.blockers,
        nextAction: latestAnalysis.nextAction,
        lastMeaningfulActivity: latestAnalysis.lastMeaningfulActivity,
        createdAt: latestAnalysis.createdAt,
        source: latestAnalysis.source,
      }
    : null

  const events = buildCaseEvents(activities, activityEvents, contacts, ownerMap)
  const days = buildStoryDays(events)
  const currentState = buildCurrentState(analysisState, summary, openTaskCount)

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
