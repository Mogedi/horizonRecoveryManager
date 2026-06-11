// Google Tasks integration (tasks scope). Read functions now; writes added in a later phase.
import { googleClient, type GoogleTask } from './client'

export type NormalizedTask = {
  id: string
  title: string | null
  notes: string | null
  due: string | null
  status: string
  completedAt: string | null
}

function normalizeTask(t: GoogleTask): NormalizedTask {
  return {
    id: t.id,
    title: t.title ?? null,
    notes: t.notes ?? null,
    due: t.due ?? null,
    status: t.status ?? 'needsAction',
    completedAt: t.completed ?? null,
  }
}

// Reads the default task list (where reminders + calendar-linked tasks live).
export async function getTasks(opts: { showCompleted?: boolean } = {}): Promise<NormalizedTask[]> {
  const tasks = await googleClient.listTasks('@default', {
    showCompleted: opts.showCompleted ?? false,
    maxResults: 100,
  })
  return tasks.map(normalizeTask)
}

const LIST = '@default'

// `due` accepts a date (YYYY-MM-DD) or RFC3339 timestamp; Tasks stores it as a date.
// A task with a due date shows on Google Calendar automatically.
export async function createTask(input: {
  title: string
  notes?: string | null
  due?: string | null
}): Promise<NormalizedTask> {
  const task = await googleClient.insertTask(LIST, {
    title: input.title,
    ...(input.notes ? { notes: input.notes } : {}),
    ...(input.due ? { due: toRfc3339Date(input.due) } : {}),
  })
  return normalizeTask(task)
}

export async function getTask(taskId: string): Promise<NormalizedTask> {
  return normalizeTask(await googleClient.getTask(LIST, taskId))
}

export async function completeTask(taskId: string): Promise<NormalizedTask> {
  return normalizeTask(await googleClient.patchTask(LIST, taskId, { status: 'completed' }))
}

// Edit any of a task's fields (title/notes/due) and/or reopen it (status: needsAction).
export async function updateTask(
  taskId: string,
  patch: { title?: string; notes?: string; due?: string; status?: 'needsAction' | 'completed' }
): Promise<NormalizedTask> {
  const body: { title?: string; notes?: string; due?: string; status?: 'needsAction' | 'completed' } = {}
  if (patch.title !== undefined) body.title = patch.title
  if (patch.notes !== undefined) body.notes = patch.notes
  if (patch.due !== undefined) body.due = toRfc3339Date(patch.due)
  if (patch.status !== undefined) body.status = patch.status
  return normalizeTask(await googleClient.patchTask(LIST, taskId, body))
}

export async function removeTask(taskId: string): Promise<void> {
  await googleClient.deleteTask(LIST, taskId)
}

// Google Tasks wants RFC3339. Accept a bare date (YYYY-MM-DD) or a full timestamp.
function toRfc3339Date(s: string): string {
  if (/^\d{4}-\d{2}-\d{2}$/.test(s)) return `${s}T00:00:00.000Z`
  return new Date(s).toISOString()
}
