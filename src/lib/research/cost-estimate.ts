// Cost estimator for research runs — pure + interpretable (no ML; robust on small data).
// A-priori estimate = recency-weighted (EWMA) central cost for the same (goal, case_type), shown as a RANGE
// (p25–p75). Self-tweaks: every new actual shifts the EWMA, no retraining. Calibration backtests predictions
// against actuals using ONLY prior runs (no leakage). Real actuals are the source of truth; the estimate
// carries its own accuracy. See docs/cost-estimation-plan.md.

export interface RunCost { id?: string; goal: string | null; caseType?: string | null; usd: number; at: number } // at = epoch ms
export interface CostEstimate { predicted: number; low: number; high: number; n: number; level: 'goal+type' | 'goal' | 'global' | 'none' }

const round = (n: number) => +n.toFixed(4)
function quantile(sorted: number[], q: number): number {
  if (!sorted.length) return 0
  const i = (sorted.length - 1) * q, lo = Math.floor(i), hi = Math.ceil(i)
  return sorted[lo] + (sorted[hi] - sorted[lo]) * (i - lo)
}
// EWMA over time-ordered costs — recency-weighted central estimate.
function ewma(runs: RunCost[], alpha = 0.4): number {
  const ordered = [...runs].sort((a, b) => a.at - b.at)
  let e = ordered[0]?.usd ?? 0
  for (let i = 1; i < ordered.length; i++) e = alpha * ordered[i].usd + (1 - alpha) * e
  return e
}

// Predict a run's cost from history. Falls back goal+type → goal → global as the sample shrinks.
export function estimateRunCost(goal: string | null, caseType: string | null | undefined, history: RunCost[]): CostEstimate {
  const usable = history.filter(r => r.usd > 0)
  const pick = (rs: RunCost[], level: CostEstimate['level']): CostEstimate | null => {
    if (rs.length < 2) return null
    const sorted = rs.map(r => r.usd).sort((a, b) => a - b)
    return { predicted: round(ewma(rs)), low: round(quantile(sorted, 0.25)), high: round(quantile(sorted, 0.75)), n: rs.length, level }
  }
  return (
    pick(usable.filter(r => r.goal === goal && caseType && r.caseType === caseType), 'goal+type') ??
    pick(usable.filter(r => r.goal === goal), 'goal') ??
    pick(usable, 'global') ??
    { predicted: usable.length ? round(ewma(usable)) : 0, low: 0, high: 0, n: usable.length, level: usable.length ? 'global' : 'none' }
  )
}

export interface CalibrationPoint { id?: string; at: number; goal: string | null; predicted: number; low: number; high: number; actual: number; errorPct: number; withinRange: boolean }
export interface CalibrationSummary { n: number; mape: number; bias: number; mae: number; points: CalibrationPoint[] }

// Backtest: for each run, predict from ONLY the runs before it, compare to its actual. No leakage.
export function backtestCalibration(history: RunCost[]): CalibrationSummary {
  const ordered = history.filter(r => r.usd > 0).sort((a, b) => a.at - b.at)
  const points: CalibrationPoint[] = []
  for (let i = 0; i < ordered.length; i++) {
    const run = ordered[i]
    const est = estimateRunCost(run.goal, run.caseType, ordered.slice(0, i))
    if (est.level === 'none' || est.n < 2) continue // not enough history to have predicted
    const errorPct = run.usd > 0 ? round(((est.predicted - run.usd) / run.usd) * 100) : 0
    points.push({ id: run.id, at: run.at, goal: run.goal, predicted: est.predicted, low: est.low, high: est.high, actual: run.usd, errorPct, withinRange: run.usd >= est.low && run.usd <= est.high })
  }
  const n = points.length
  const avg = (f: (p: CalibrationPoint) => number) => (n ? points.reduce((s, p) => s + f(p), 0) / n : 0)
  return {
    n,
    mape: +avg(p => Math.abs(p.errorPct)).toFixed(1),
    bias: +avg(p => p.errorPct).toFixed(1),
    mae: round(avg(p => Math.abs(p.predicted - p.actual))),
    points,
  }
}
