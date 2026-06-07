import type { Rule, AttentionFlag } from './types'

export const checkContacts: Rule = (deal, ctx) => {
  // Terminal stages: case is closed — contact info is irrelevant
  if (deal.stage !== null && ctx.terminalStageIds.has(deal.stage)) return null

  // Layer 2 loaded: check whether any contact has a valid phone number
  if (deal.hasValidPhone !== null) {
    if (deal.hasValidPhone) return null
    return {
      type: 'no_contacts',
      severity: 'warning',
      message: 'No valid phone numbers found for any contact',
    } satisfies AttentionFlag
  }

  // Layer 2 not loaded: fall back to Layer 1 contactCount check
  if (deal.contactCount === 0) {
    return {
      type: 'no_contacts',
      severity: 'warning',
      message: 'No contacts linked — cannot reach owner',
    } satisfies AttentionFlag
  }

  return null
}
