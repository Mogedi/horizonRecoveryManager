import { NextRequest, NextResponse } from 'next/server'
import { isAuthenticated, unauthorizedResponse } from '@/lib/auth/require-session'
import { getOpenTasks, getRecentCompletedTasks, createTask } from '@/lib/db/tasks'
import { TaskCategory } from '@prisma/client'

export async function GET() {
  if (!(await isAuthenticated())) return unauthorizedResponse()

  const [open, completed] = await Promise.all([getOpenTasks(), getRecentCompletedTasks(30)])
  return NextResponse.json({ open, completed })
}

export async function POST(req: NextRequest) {
  if (!(await isAuthenticated())) return unauthorizedResponse()

  let body: unknown
  try {
    body = await req.json()
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 })
  }

  const b = body as Record<string, unknown>

  if (!b.title || typeof b.title !== 'string' || b.title.trim() === '') {
    return NextResponse.json({ error: 'title is required' }, { status: 400 })
  }
  if (!b.category || !Object.values(TaskCategory).includes(b.category as TaskCategory)) {
    return NextResponse.json({ error: 'valid category is required' }, { status: 400 })
  }

  const task = await createTask({
    dealHubspotId: typeof b.dealHubspotId === 'string' ? b.dealHubspotId : null,
    title: (b.title as string).trim(),
    notes: typeof b.notes === 'string' ? b.notes.trim() || null : null,
    dueDate: typeof b.dueDate === 'string' ? new Date(b.dueDate) : null,
    category: b.category as TaskCategory,
  })

  return NextResponse.json(task, { status: 201 })
}
