import { NextRequest, NextResponse } from 'next/server'
import { cookies } from 'next/headers'
import { completeTask, deleteTask } from '@/lib/db/tasks'

async function checkAuth() {
  const cookieStore = await cookies()
  return cookieStore.get('horizon_auth')?.value === '1'
}

export async function PATCH(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  if (!(await checkAuth())) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

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
  if (!(await checkAuth())) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

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
