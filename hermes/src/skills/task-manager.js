// Skill: task-manager — track Mo's to-do list in Google Tasks (read + write).
// Writes go through the dashboard's audited, kill-switchable agent API. Tasks are low-risk and
// undoable, so they write directly; capturing tasks FROM a note is propose-then-confirm.
import { getGoogleTasks, addGoogleTask, completeGoogleTask, removeGoogleTask } from '../hm-api.js'

export default {
  name: 'task-manager',
  description: "Manage Mo's to-do list (Google Tasks): list, add, complete, and remove tasks; capture action items from his notes; clean up done/stale tasks.",
  playbook:
    'Behavior:\n' +
    '- If Mo EXPLICITLY asks to add/track a task ("add a task…", "remind me to…"), call add_task directly.\n' +
    '- If Mo sends a NOTE that contains action items but doesn\'t explicitly ask, LIST the items you\'d ' +
    'capture and ask which to add — only call add_task after he confirms (never create silently from a note).\n' +
    '- For "clean up my tasks": list_tasks, identify what looks done/obsolete/duplicate, and propose ' +
    'completing or removing those — confirm before complete_task/remove_task on anything ambiguous.\n' +
    '- complete_task/remove_task need the task id from list_tasks. due accepts YYYY-MM-DD (a due date ' +
    'makes the task show on Google Calendar). Lead with what\'s due soonest.',
  writes: true,
  defaultEnabled: true,
  tools: [
    {
      name: 'list_tasks',
      description: "List Mo's Google Tasks (open by default). Each: id, title, notes, due, status.",
      input_schema: {
        type: 'object',
        properties: { completed: { type: 'boolean', description: 'include completed tasks' } },
      },
    },
    {
      name: 'add_task',
      description: 'Create a task on Mo\'s Google Tasks list. A due date makes it appear on his calendar.',
      input_schema: {
        type: 'object',
        properties: {
          title: { type: 'string', description: 'the task title' },
          notes: { type: 'string', description: 'optional detail' },
          due: { type: 'string', description: 'optional due date, YYYY-MM-DD' },
        },
        required: ['title'],
      },
    },
    {
      name: 'complete_task',
      description: 'Mark a task complete. Needs the task id from list_tasks.',
      input_schema: {
        type: 'object',
        properties: { id: { type: 'string', description: 'the task id' } },
        required: ['id'],
      },
    },
    {
      name: 'remove_task',
      description: 'Delete a task. Needs the task id from list_tasks.',
      input_schema: {
        type: 'object',
        properties: { id: { type: 'string', description: 'the task id' } },
        required: ['id'],
      },
    },
  ],
  handlers: {
    list_tasks: async (input) => {
      const r = await getGoogleTasks(!!input.completed)
      return r.tasks?.length ? r.tasks : 'no tasks on the list right now'
    },
    add_task: async (input) => {
      if (!input.title) return 'a title is required'
      const t = await addGoogleTask({ title: input.title, notes: input.notes, due: input.due })
      return { added: { id: t.id, title: t.title, due: t.due } }
    },
    complete_task: async (input) => {
      if (!input.id) return 'a task id is required (get it from list_tasks)'
      const t = await completeGoogleTask(input.id)
      return { completed: { id: t.id, title: t.title } }
    },
    remove_task: async (input) => {
      if (!input.id) return 'a task id is required (get it from list_tasks)'
      const r = await removeGoogleTask(input.id)
      return { removed: r.removed ?? input.id }
    },
  },
}
