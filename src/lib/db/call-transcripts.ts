import { prisma } from './client'
import type { ClassifyResult } from '@/lib/integrations/call-classifier/types'

// Write a permanent-skip row so the call exits the unclassified queue.
// Used for 413 (file too large) and missing recording URL — both are unretryable.
export async function upsertErrorTranscript(activityEventId: number, reason: string): Promise<void> {
  await prisma.callTranscript.upsert({
    where: { activityEventId },
    create: {
      activityEventId,
      transcript: '',
      classification: 'error',
      summary: reason,
    },
    update: {
      classification: 'error',
      summary: reason,
      processedAt: new Date(),
    },
  })
}

export async function upsertCallTranscript(result: ClassifyResult): Promise<void> {
  await prisma.callTranscript.upsert({
    where: { activityEventId: result.activityEventId },
    create: {
      activityEventId: result.activityEventId,
      transcript: result.transcript,
      classification: result.classification,
      summary: result.summary,
      whisperSecs: result.whisperSecs,
    },
    update: {
      transcript: result.transcript,
      classification: result.classification,
      summary: result.summary,
      whisperSecs: result.whisperSecs,
      processedAt: new Date(),
    },
  })
}

export async function getCallTranscript(activityEventId: number) {
  return prisma.callTranscript.findUnique({
    where: { activityEventId },
  })
}

// Returns classified call count per deal as a Map<dealHubspotId, count>.
// Used by the deals API to surface transcript status on each card.
export async function getClassifiedCallCountsByDeal(): Promise<Map<string, number>> {
  const rows = await prisma.$queryRaw<Array<{ deal_hubspot_id: string; cnt: number }>>`
    SELECT ae.deal_hubspot_id, COUNT(ct.id)::int AS cnt
    FROM call_transcripts ct
    JOIN activity_events ae ON ae.id = ct.activity_event_id
    WHERE ct.classification != 'error'
    GROUP BY ae.deal_hubspot_id
  `
  return new Map(rows.map(r => [r.deal_hubspot_id, r.cnt]))
}

// Returns event IDs of answered outbound calls that have NOT yet been classified.
// Used by the backfill script to find unprocessed calls.
export async function getUnclassifiedAnsweredCallIds(limit = 500): Promise<number[]> {
  const events = await prisma.activityEvent.findMany({
    where: {
      source: 'JUSTCALL',
      direction: 'outbound',
      outcome: 'answered',
      transcript: null,   // no CallTranscript row yet
    },
    select: { id: true },
    orderBy: { happenedAt: 'asc' },
    take: limit,
  })
  return events.map(e => e.id)
}
