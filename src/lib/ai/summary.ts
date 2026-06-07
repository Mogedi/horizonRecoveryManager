import { AIError } from './errors'

export type SummaryJson = {
  current_status: string
  last_meaningful_activity: string
  blockers: string[]
  who_needs_something: string | null
  suggested_next_step: string
  mo_action_required: boolean
  documents_mentioned_missing: string[]
}

export function parseSummaryResponse(rawText: string): SummaryJson {
  let parsed: unknown
  try {
    parsed = JSON.parse(rawText)
  } catch {
    throw new AIError(`Claude response is not valid JSON: ${rawText.slice(0, 200)}`)
  }

  if (typeof parsed !== 'object' || parsed === null) {
    throw new AIError('Claude response parsed to non-object')
  }

  const obj = parsed as Record<string, unknown>

  const required = [
    'current_status',
    'last_meaningful_activity',
    'blockers',
    'who_needs_something',
    'suggested_next_step',
    'mo_action_required',
    'documents_mentioned_missing',
  ]
  for (const key of required) {
    if (!(key in obj)) {
      throw new AIError(`Claude response missing required field: ${key}`)
    }
  }

  if (!Array.isArray(obj.blockers)) {
    throw new AIError('Claude response field "blockers" must be an array')
  }
  if (!Array.isArray(obj.documents_mentioned_missing)) {
    throw new AIError('Claude response field "documents_mentioned_missing" must be an array')
  }
  if (typeof obj.mo_action_required !== 'boolean') {
    throw new AIError('Claude response field "mo_action_required" must be a boolean')
  }

  return obj as unknown as SummaryJson
}
