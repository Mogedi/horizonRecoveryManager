import { NextRequest, NextResponse } from 'next/server'
import { isAuthenticated, unauthorizedResponse } from '@/lib/auth/require-session'
import { createSnooze, removeActiveSnooze, isValidSnoozeCategory } from '@/lib/db/snoozes'
import { SnoozeCategory } from '@prisma/client'

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  if (!(await isAuthenticated())) return unauthorizedResponse()

  const { id } = await params
  let body: { category?: unknown; snoozeUntil?: unknown; freeformNote?: unknown }
  try {
    body = await req.json()
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 })
  }

  const { category, snoozeUntil, freeformNote } = body

  if (typeof category !== 'string' || !isValidSnoozeCategory(category)) {
    return NextResponse.json({ error: 'Invalid category' }, { status: 400 })
  }

  if (typeof snoozeUntil !== 'string') {
    return NextResponse.json({ error: 'snoozeUntil is required' }, { status: 400 })
  }
  const snoozeDate = new Date(snoozeUntil)
  if (isNaN(snoozeDate.getTime())) {
    return NextResponse.json({ error: 'Invalid date' }, { status: 400 })
  }
  if (snoozeDate <= new Date()) {
    return NextResponse.json({ error: 'Snooze date must be in the future' }, { status: 400 })
  }

  await createSnooze(
    id,
    category as SnoozeCategory,
    snoozeDate,
    typeof freeformNote === 'string' ? freeformNote : undefined
  )

  return NextResponse.json({ ok: true })
}

export async function DELETE(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  if (!(await isAuthenticated())) return unauthorizedResponse()
  const { id } = await params
  await removeActiveSnooze(id)
  return NextResponse.json({ ok: true })
}
