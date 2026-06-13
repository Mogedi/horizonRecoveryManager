import type { Band } from './types'

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
