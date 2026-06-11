// Skill: memory — store/recall/forget durable facts & preferences across chats.
// Passive recall is injected into every chat automatically (see chat.js); these tools are for
// explicit "remember this" / "what do you know" / "forget that" actions.
import { remember, recall, forget, allMemories } from '../memory.js'

export default {
  name: 'memory',
  description: "Hermes's long-term memory: remember durable facts/preferences Mo shares, recall them, list them, or forget them.",
  playbook:
    'Save with remember when Mo states a DURABLE fact or preference worth keeping (how he likes things, ' +
    'standing instructions, key client/context details) — not transient chatter. Relevant memories are ' +
    'already injected into your context automatically; use recall to search explicitly, list_memories to ' +
    'show everything, forget to delete by id. Confirm before forgetting unless Mo named the item.',
  writes: true,
  defaultEnabled: true,
  tools: [
    {
      name: 'remember',
      description: 'Save a durable fact or preference to long-term memory.',
      input_schema: {
        type: 'object',
        properties: {
          content: { type: 'string', description: 'the fact/preference to remember' },
          tags: { type: 'array', items: { type: 'string' }, description: 'optional topic tags' },
        },
        required: ['content'],
      },
    },
    {
      name: 'recall',
      description: 'Search long-term memory by keyword (or recent if no query).',
      input_schema: {
        type: 'object',
        properties: { query: { type: 'string' }, limit: { type: 'number' } },
      },
    },
    {
      name: 'list_memories',
      description: 'List everything Hermes has remembered (newest first), with ids.',
      input_schema: { type: 'object', properties: {} },
    },
    {
      name: 'forget',
      description: 'Delete a memory by its id (from recall/list_memories).',
      input_schema: {
        type: 'object',
        properties: { id: { type: 'string' } },
        required: ['id'],
      },
    },
  ],
  handlers: {
    remember: async (input) => {
      const e = await remember(input.content, input.tags)
      return { remembered: { id: e.id, content: e.content } }
    },
    recall: async (input) => {
      const rows = await recall(input.query ?? '', Math.min(Math.max(Number(input.limit) || 8, 1), 25))
      return rows.length ? rows.map((m) => ({ id: m.id, content: m.content, tags: m.tags })) : 'nothing relevant in memory'
    },
    list_memories: async () => {
      const rows = await allMemories()
      return rows.length ? rows.map((m) => ({ id: m.id, content: m.content, tags: m.tags, at: m.createdAt })) : 'memory is empty'
    },
    forget: async (input) => {
      if (!input.id) return 'an id is required (from list_memories)'
      const ok = await forget(input.id)
      return ok ? { forgotten: input.id } : `no memory with id ${input.id}`
    },
  },
}
