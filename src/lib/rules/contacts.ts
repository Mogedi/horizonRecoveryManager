import type { Rule, AttentionFlag } from './types'

// Layer 1 version: flags deals with zero linked contacts.
// Layer 2 upgrade (M4): checks whether any contact has valid phone numbers.
export const checkContacts: Rule = (deal, _ctx) => {
  if (deal.contactCount > 0) return null

  return {
    type: 'no_contacts',
    severity: 'warning',
    message: 'No contacts linked — cannot reach owner',
  } satisfies AttentionFlag
}
