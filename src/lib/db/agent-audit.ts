import { prisma } from './client'

// Phase 1 (Hermes): one row per agent-originated mutation, with full before/after payloads.
// This is the safety net that replaces the per-write manual review when agent writes run auto.

export type AgentAction =
  | 'create_analysis'
  | 'create_task'
  | 'complete_task'
  | 'delete_task'
  | 'snooze'
  | 'unsnooze'

export type LogAgentActionInput = {
  actor: string
  action: AgentAction
  target?: string | null
  route?: string | null
  method?: string | null
  correlationId?: string | null
  idempotencyKey?: string | null
  requestMeta?: Record<string, unknown> | null
  before?: unknown
  after?: unknown
}

// Safe-cast per CLAUDE.md JSON rule; undefined/null → skip the column.
function toJson(v: unknown) {
  if (v === undefined || v === null) return undefined
  return JSON.parse(JSON.stringify(v))
}

export async function logAgentAction(input: LogAgentActionInput) {
  return prisma.agentAuditLog.create({
    data: {
      actor: input.actor,
      action: input.action,
      target: input.target ?? null,
      route: input.route ?? null,
      method: input.method ?? null,
      correlationId: input.correlationId ?? null,
      idempotencyKey: input.idempotencyKey ?? null,
      requestMeta: toJson(input.requestMeta),
      before: toJson(input.before),
      after: toJson(input.after),
    },
  })
}
