// Returns Gmail events stored for a specific deal.
// Only returns events already synced — does NOT trigger a new sync.

import { NextRequest, NextResponse } from 'next/server'
import { getActivityEvents } from '@/lib/db/activity-events'
import { isAuthenticated, isCronRequest, unauthorizedResponse } from '@/lib/auth/require-session'
import { ActivitySource } from '@prisma/client'

type Params = { params: Promise<{ id: string }> }

export async function GET(req: NextRequest, { params }: Params) {
  if (!(await isAuthenticated()) && !isCronRequest(req)) return unauthorizedResponse()

  const { id } = await params
  const events = await getActivityEvents(id, ActivitySource.GOOGLE)

  const emails = events
    .filter(e => e.type === 'email')
    .map(e => ({
      id: e.id,
      externalId: e.externalId,
      happenedAt: e.happenedAt.toISOString(),
      direction: e.direction,
      body: e.body,
      metadata: e.metadata,
    }))

  return NextResponse.json({ emails })
}
