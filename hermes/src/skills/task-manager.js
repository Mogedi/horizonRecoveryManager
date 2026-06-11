// Skill: task-manager — track Mo's to-do list in Google Tasks.
// Read now; add/complete/remove + notes→tasks capture + cleanup come in the next phase.
import { getGoogleTasks } from '../hm-api.js'

export default {
  name: 'task-manager',
  description: "Track Mo's to-do list (Google Tasks): list open tasks and what's due. (Adding/completing/removing tasks is coming next.)",
  playbook:
    'Use list_tasks to show open to-dos (pass completed=true to include finished ones). Lead with what\'s ' +
    'due soonest. Adding/removing tasks is not enabled yet — if Mo asks to add or capture a task, say it\'s ' +
    'coming next so he knows it\'s on the way.',
  writes: false,
  defaultEnabled: true,
  tools: [
    {
      name: 'list_tasks',
      description: "List Mo's Google Tasks (open by default). Each: title, notes, due date, status.",
      input_schema: {
        type: 'object',
        properties: { completed: { type: 'boolean', description: 'include completed tasks' } },
      },
    },
  ],
  handlers: {
    list_tasks: async (input) => {
      const r = await getGoogleTasks(!!input.completed)
      return r.tasks?.length ? r.tasks : 'no tasks on the list right now'
    },
  },
}
