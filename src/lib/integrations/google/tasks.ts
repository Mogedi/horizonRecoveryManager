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
