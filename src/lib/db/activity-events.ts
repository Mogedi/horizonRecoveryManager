import { prisma } from './client'
import { ActivitySource } from '@prisma/client'

export type ActivityEventInput = {
  dealHubspotId: string | null
  source: ActivitySource
  externalId: string
  type: string
  happenedAt: Date
  durationSecs?: number | null
  direction?: string | null
  outcome?: string | null
  fromNumber?: string | null
  toNumber?: string | null
  agentId?: string | null
  body?: string | null
  metadata?: Record<string, unknown>
  rawPayload?: unknown
}

// Upsert a single activity event — deduplicates on (source, externalId).
// Null externalId is allowed but won't dedup — use only for events without stable IDs.
export async function upsertActivityEvent(event: ActivityEventInput): Promise<void> {
  if (!event.externalId) return

  await prisma.activityEvent.upsert({
    where: { activity_events_dedup: { source: event.source, externalId: event.externalId } },
    create: {
      dealHubspotId: event.dealHubspotId,
      source: event.source,
      externalId: event.externalId,
      type: event.type,
      happenedAt: event.happenedAt,
      durationSecs: event.durationSecs ?? null,
      direction: event.direction ?? null,
      outcome: event.outcome ?? null,
      fromNumber: event.fromNumber ?? null,
      toNumber: event.toNumber ?? null,
      agentId: event.agentId ?? null,
      body: event.body ?? null,
      metadata: event.metadata ? JSON.parse(JSON.stringify(event.metadata)) : undefined,
      rawPayload: event.rawPayload ? JSON.parse(JSON.stringify(event.rawPayload)) : undefined,
    },
    update: {
      dealHubspotId: event.dealHubspotId,
      happenedAt: event.happenedAt,
      durationSecs: event.durationSecs ?? null,
      direction: event.direction ?? null,
      outcome: event.outcome ?? null,
      fromNumber: event.fromNumber ?? null,
      toNumber: event.toNumber ?? null,
      agentId: event.agentId ?? null,
      body: event.body ?? null,
      // Refresh metadata/rawPayload on re-sync — otherwise a re-pull (e.g. Gmail rematch +
      // full-body backfill) can never overwrite stale headers written by an earlier run.
      metadata: event.metadata ? JSON.parse(JSON.stringify(event.metadata)) : undefined,
      rawPayload: event.rawPayload ? JSON.parse(JSON.stringify(event.rawPayload)) : undefined,
    },
  })
}

// Bulk upsert — more efficient than calling upsertActivityEvent in a loop.
// Skips any events without externalId.
export async function upsertActivityEvents(events: ActivityEventInput[]): Promise<number> {
  const valid = events.filter(e => !!e.externalId)
  let inserted = 0
  for (const event of valid) {
    await upsertActivityEvent(event)
    inserted++
  }
  return inserted
}

// Fetch all activity events for a deal, sorted newest first.
export async function getActivityEvents(dealHubspotId: string, source?: ActivitySource) {
  return prisma.activityEvent.findMany({
    where: {
      dealHubspotId,
      ...(source ? { source } : {}),
    },
    orderBy: { happenedAt: 'desc' },
  })
}

// Count events by source for a deal — used for call attempt counts.
export async function countActivityEvents(
  dealHubspotId: string,
  source: ActivitySource,
  type?: string
): Promise<number> {
  return prisma.activityEvent.count({
    where: {
      dealHubspotId,
      source,
      ...(type ? { type } : {}),
    },
  })
}
