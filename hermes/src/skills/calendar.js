// Skill: calendar — full read + write on Google Calendar. Writes are CONFIRM-GATED: Hermes shows
// the event and waits for Mo's explicit "yes" before creating/changing/deleting (guest invites fire).
import {
  getCalendarEvents, getCalendarEvent, addCalendarEvent, updateCalendarEvent, removeCalendarEvent,
} from '../hm-api.js'

export default {
  name: 'calendar',
  description: 'Read and manage Mo\'s Google Calendar: see upcoming events with full detail (description, Zoom/Meet link, attendees), and create/update/delete events & meetings.',
  playbook:
    'Reading: list_calendar_events returns full detail — title, description, start/end (ISO w/ timezone; ' +
    'all-day uses a date), location, meetingLink (Zoom/Meet/Teams), attendees with RSVP, organizer. Use ' +
    'get_calendar_event for one event by id. Surface the meetingLink and description when Mo asks about a meeting.\n' +
    'Writing is CONFIRM-GATED: for create/update/delete, FIRST show the exact event (title, date/time, ' +
    'attendees, location) and ask Mo to confirm — only call the write tool after he says yes. Default ' +
    'duration 60 min if no end given. Times are America/New_York. Warn that adding attendees emails invites.',
  writes: true,
  defaultEnabled: true,
  tools: [
    {
      name: 'list_calendar_events',
      description: 'Upcoming events (default next 14 days) with full detail: description, meetingLink, attendees, organizer.',
      input_schema: {
        type: 'object',
        properties: { days: { type: 'number', description: 'days ahead (default 14, max 90)' } },
      },
    },
    {
      name: 'get_calendar_event',
      description: 'Full detail for one event by id (from list_calendar_events).',
      input_schema: {
        type: 'object',
        properties: { id: { type: 'string', description: 'the event id' } },
        required: ['id'],
      },
    },
    {
      name: 'create_calendar_event',
      description: 'Create an event/meeting. Only call AFTER Mo confirms the details. start/end are ISO timestamps (or YYYY-MM-DD for all-day).',
      input_schema: {
        type: 'object',
        properties: {
          title: { type: 'string' },
          start: { type: 'string', description: 'ISO timestamp, or YYYY-MM-DD for all-day' },
          end: { type: 'string', description: 'ISO timestamp; optional (defaults to +durationMinutes)' },
          durationMinutes: { type: 'number', description: 'used if end omitted (default 60)' },
          description: { type: 'string' },
          location: { type: 'string', description: 'place or a meeting URL' },
          attendees: { type: 'array', items: { type: 'string' }, description: 'guest emails (will be invited)' },
          allDay: { type: 'boolean' },
        },
        required: ['title', 'start'],
      },
    },
    {
      name: 'update_calendar_event',
      description: 'Update an event by id. Only call AFTER Mo confirms. Pass only the fields to change.',
      input_schema: {
        type: 'object',
        properties: {
          id: { type: 'string' },
          title: { type: 'string' },
          start: { type: 'string' },
          end: { type: 'string' },
          description: { type: 'string' },
          location: { type: 'string' },
          attendees: { type: 'array', items: { type: 'string' } },
          allDay: { type: 'boolean' },
        },
        required: ['id'],
      },
    },
    {
      name: 'delete_calendar_event',
      description: 'Delete an event by id (cancels guest invites). Only call AFTER Mo confirms.',
      input_schema: {
        type: 'object',
        properties: { id: { type: 'string' } },
        required: ['id'],
      },
    },
  ],
  handlers: {
    list_calendar_events: async (input) => {
      const days = Math.min(Math.max(Number(input.days) || 14, 1), 90)
      const r = await getCalendarEvents(days)
      return r.events?.length ? { days, events: r.events } : `no events in the next ${days} days`
    },
    get_calendar_event: async (input) => {
      if (!input.id) return 'an event id is required'
      return getCalendarEvent(input.id)
    },
    create_calendar_event: async (input) => {
      if (!input.title || !input.start) return 'title and start are required'
      const e = await addCalendarEvent(input)
      return { created: { id: e.id, title: e.title, start: e.start, end: e.end, link: e.link, meetingLink: e.meetingLink } }
    },
    update_calendar_event: async (input) => {
      if (!input.id) return 'an event id is required'
      const { id, ...patch } = input
      const e = await updateCalendarEvent(id, patch)
      return { updated: { id: e.id, title: e.title, start: e.start, end: e.end } }
    },
    delete_calendar_event: async (input) => {
      if (!input.id) return 'an event id is required'
      const r = await removeCalendarEvent(input.id)
      return { removed: r.removed ?? input.id }
    },
  },
}
