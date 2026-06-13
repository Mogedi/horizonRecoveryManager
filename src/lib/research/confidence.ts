import type { Band, ChecklistItem, ConfidenceChecklist } from './types'

// Confidence is an explainable BAND, never a probability — `score` is only a sortable heuristic.
// We never claim "94% sure"; we show the evidence and a band, and surface conflicts explicitly.
export function deriveBand(score: number, conflictScore: number, distinctSources: number): Band {
  // Two credible-but-different identities → make the human disambiguate.
  if (conflictScore >= 25 && conflictScore >= score * 0.6) return 'conflicting'
  if (score >= 60 && distinctSources >= 1) return 'high'
  if (score >= 30) return 'medium'
  return 'low'
}

export function explainBand(band: Band): string {
  switch (band) {
    case 'high': return 'Strong, corroborated evidence for a single person.'
    case 'medium': return 'Some matching evidence — verify before acting.'
    case 'conflicting': return 'Evidence points at more than one person — needs human disambiguation.'
    default: return 'Weak or no evidence — treat as unconfirmed.'
  }
}

// Build an explainable per-person / per-relationship confidence from a ✓/✗ checklist (B3).
// No false precision: the band falls out of how many evidence checks pass, plus any conflict.
export function buildChecklist(checklist: ChecklistItem[], hasConflict = false): ConfidenceChecklist {
  const total = checklist.length || 1
  const present = checklist.filter(c => c.present).length
  const score = Math.round((present / total) * 100)
  let band: Band
  if (hasConflict) band = 'conflicting'
  else if (score >= 75) band = 'high'
  else if (score >= 40) band = 'medium'
  else band = 'low'
  return { band, checklist, explanation: explainBand(band), score }
}
