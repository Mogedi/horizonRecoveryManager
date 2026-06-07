import { NextRequest, NextResponse } from 'next/server'
import { isAuthenticated, unauthorizedResponse } from '@/lib/auth/require-session'
import { completeTask, deleteTask } from '@/lib/db/tasks'

export async function PATCH(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  if (!(await isAuthenticated())) return unauthorizedResponse()

  const { id } = await params
  const taskId = parseInt(id, 10)
  if (isNaN(taskId)) {
    return NextResponse.json({ error: 'Invalid id' }, { status: 400 })
  }

  try {
    const task = await completeTask(taskId)
    return NextResponse.json(task)
  } catch {
    return NextResponse.json({ error: 'Task not found' }, { status: 404 })
  }
}

export async function DELETE(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  if (!(await isAuthenticated())) return unauthorizedResponse()

  const { id } = await params
  const taskId = parseInt(id, 10)
  if (isNaN(taskId)) {
    return NextResponse.json({ error: 'Invalid id' }, { status: 400 })
  }

  try {
    await deleteTask(taskId)
    return new NextResponse(null, { status: 204 })
  } catch {
    return NextResponse.json({ error: 'Task not found' }, { status: 404 })
  }
}
