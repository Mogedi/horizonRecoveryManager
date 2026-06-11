// Skill: calendar — read Google Calendar. (Event creation comes in a later phase, confirm-gated.)
import { getCalendarEvents } from '../hm-api.js'

export default {
  name: 'calendar',
  description: 'Read Mo\'s Google Calendar: upcoming events/meetings, what\'s on a given day, availability.',
  playbook:
    'Use list_calendar_events to see what\'s coming up. Start/end are ISO timestamps with timezone ' +
    '(all-day events use a date). Summarize clearly (day, time, title). Creating events is not enabled ' +
    'yet — if Mo asks to schedule something, say it\'s coming soon.',
  writes: false,
  defaultEnabled: true,
  tools: [
    {
      name: 'list_calendar_events',
      description: 'List upcoming Google Calendar events (default next 14 days).',
      input_schema: {
        type: 'object',
        properties: { days: { type: 'number', description: 'days ahead to look (default 14, max 90)' } },
      },
    },
  ],
  handlers: {
    list_calendar_events: async (input) => {
      const days = Math.min(Math.max(Number(input.days) || 14, 1), 90)
      const r = await getCalendarEvents(days)
      return r.events?.length ? { days, events: r.events } : `no events in the next ${days} days`
    },
  },
}
