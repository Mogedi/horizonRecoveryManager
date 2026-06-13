// Adapter registry. Add a source here once its adapter is written (the "register" step of the
// discover → codify → register → run lifecycle).
import type { SourceAdapter, PersonQuery, SourceKind } from '../types'
import { qpublicAdapter } from './qpublic'
import { fastPeopleSearchAdapter } from './fastpeoplesearch'

export const ADAPTERS: SourceAdapter[] = [qpublicAdapter, fastPeopleSearchAdapter]

// Public records first, contact/social last.
const KIND_ORDER: SourceKind[] = ['property', 'tax', 'deed', 'probate', 'obituary', 'people_search', 'social']

// Adapters whose coverage matches the query, ordered by priority.
export function adaptersFor(q: PersonQuery): SourceAdapter[] {
  const state = (q.state || 'GA').toUpperCase()
  return ADAPTERS
    .filter(a => a.enabled && (!a.coverage.states || a.coverage.states.includes(state)))
    .sort((a, b) => KIND_ORDER.indexOf(a.kind) - KIND_ORDER.indexOf(b.kind))
}
