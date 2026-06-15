import Link from 'next/link'
import { getResearchRunTelemetry, getCostTrend, getSourceHealth } from '@/lib/db/research'
import { getRealSpend } from '@/lib/integrations/anthropic-admin/client'
import { backtestCalibration, estimateRunCost, type RunCost } from '@/lib/research/cost-estimate'

// Cost + spend telemetry for the research agent. One row per run, LLM cost split by model so the
// Haiku-vs-Sonnet routing is visible. Server component — reads the DB directly (auth via middleware).
export const dynamic = 'force-dynamic'

const money = (n: number) => (n >= 1 ? `$${n.toFixed(2)}` : `$${n.toFixed(4)}`)
const k = (n: number) => (n >= 1000 ? `${(n / 1000).toFixed(1)}k` : String(n))
const modelLabel = (m: string) => m.replace('claude-', '').replace('-4-5', ' 4.5').replace('-4-6', ' 4.6').replace('-4-8', ' 4.8')
const isCheap = (m: string) => m.toLowerCase().includes('haiku')
const fmtDate = (d: Date) => new Date(d).toLocaleString('en-US', { timeZone: 'America/New_York', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })

export default async function ResearchTelemetryPage() {
  const [runs, trend, health, real, trend7] = await Promise.all([
    getResearchRunTelemetry(60),
    getCostTrend(60),
    getSourceHealth(30),
    getRealSpend(7),
    getCostTrend(7),
  ])
  const modelChip = (m: string) => {
    const l = m.toLowerCase()
    return l.includes('haiku') ? 'bg-emerald-100 text-emerald-700'
      : l.includes('opus') ? 'bg-purple-100 text-purple-700'
      : l.includes('sonnet') ? 'bg-indigo-100 text-indigo-700'
      : 'bg-gray-100 text-gray-600'
  }

  // Cost estimator: backtested calibration (predicted vs actual, no leakage) + a-priori estimate per goal.
  const history: RunCost[] = runs.filter(r => r.usd > 0).map(r => ({ id: r.key, goal: r.goal, caseType: r.caseType, usd: r.usd, at: r.createdAt.getTime() }))
  const calib = backtestCalibration(history)
  const predByRun = new Map(calib.points.map(p => [p.id, p]))
  const goalEstimates = ([...new Set(history.map(h => h.goal).filter(Boolean))] as string[])
    .map(g => ({ goal: g, est: estimateRunCost(g, null, history) }))
    .filter(x => x.est.n >= 2)
    .sort((a, b) => b.est.predicted - a.est.predicted)

  return (
    <div className="h-screen overflow-y-auto px-8 py-6">
      <div className="flex items-center justify-between mb-1">
        <h1 className="text-xl font-semibold text-gray-800">Research Telemetry</h1>
        <Link href="/dashboard/research" className="text-sm text-blue-600 hover:underline">← Back to Research</Link>
      </div>
      <p className="text-sm text-gray-500 mb-6">Per-run LLM cost, split by model. Last 60 days.</p>

      {/* Summary */}
      <div className="grid grid-cols-3 gap-4 mb-6 max-w-2xl">
        <Stat label="Runs (60d)" value={String(trend.runs)} />
        <Stat label="Total LLM cost" value={money(trend.totalUsd)} />
        <Stat label="Avg / run" value={money(trend.avgUsd)} />
      </div>

      <div className="mb-6 text-xs text-gray-500 bg-amber-50 border border-amber-200 rounded-lg px-4 py-3 max-w-3xl">
        <span className="font-medium text-amber-800">Scope:</span> this page shows <b>LLM</b> cost (the model tokens).
        Browser Use and Firecrawl <b>dollar</b> spend live with their own APIs on the VPS (account-level, not yet
        tagged per run) — see <code className="bg-amber-100 px-1 rounded">scripts/research-ops.sh</code>. Firecrawl
        calls below are a count, not a charge.
      </div>

      {/* Real billed spend — Anthropic Admin API (the truth source) */}
      <div className="flex items-baseline justify-between max-w-3xl mb-2">
        <h2 className="text-sm font-semibold text-gray-700">Real Anthropic spend — last 7 days (billed by model)</h2>
      </div>
      {!real.available ? (
        <div className="mb-8 text-xs text-gray-500 bg-gray-50 border border-gray-200 rounded-lg px-4 py-3 max-w-3xl">
          Real-spend unavailable: {real.reason}. Set <code className="bg-gray-100 px-1 rounded">ANTHROPIC_ADMIN_KEY</code> (Console → Settings → Admin keys) to show actual billed cost by model.
        </div>
      ) : (
        <div className="mb-8 max-w-3xl">
          <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1 mb-2">
            <span className="text-2xl font-semibold text-gray-800">{money(real.totalUsd)}</span>
            <span className="text-xs text-gray-500">
              billed (all workspaces) · self-report (research_costs, 7d): {money(trend7.totalUsd)}
              {trend7.totalUsd > 0 && <span className="ml-1 text-amber-700 font-medium">→ real is {(real.totalUsd / trend7.totalUsd).toFixed(1)}× the self-report</span>}
            </span>
          </div>
          <div className="border border-gray-200 rounded-lg overflow-hidden">
            {real.byWorkspace.map(w => (
              <div key={w.workspaceId} className={`px-4 py-2 border-b border-gray-100 last:border-0 ${w.isHermes ? 'bg-emerald-50' : ''}`}>
                <div className="flex justify-between text-sm">
                  <span className="text-gray-700">
                    {w.label}
                    {w.isHermes && <span className="ml-2 text-[10px] text-emerald-700 font-semibold tracking-wide">HERMES RESEARCH</span>}
                  </span>
                  <span className="font-medium text-gray-800">{money(w.usd)}</span>
                </div>
                <div className="flex flex-wrap gap-1 mt-1">
                  {w.byModel.map(m => (
                    <span key={m.model} className={`inline-flex items-center px-1.5 py-0.5 rounded text-[11px] ${modelChip(m.model)}`} title={m.model}>
                      {modelLabel(m.model)} {money(m.usd)}
                    </span>
                  ))}
                </div>
              </div>
            ))}
          </div>
          <p className="text-[11px] text-gray-400 mt-1">Source: Anthropic Admin Cost API — actual billed $ by model. Hermes research now isolates to its own workspace; the self-report below only sees research CLI runs.</p>
        </div>
      )}

      {/* Cost estimator */}
      <h2 className="text-sm font-semibold text-gray-700 mb-2">Cost estimate vs actual</h2>
      <div className="mb-3 max-w-3xl text-xs text-gray-600">
        Estimator accuracy (backtest, no leakage):{' '}
        {calib.n
          ? <span><b>{calib.mape}%</b> avg error · bias {calib.bias > 0 ? '+' : ''}{calib.bias}% · n={calib.n}</span>
          : <span className="text-gray-400">not enough history yet (need ≥2 prior runs of a goal)</span>}
        <span className="text-gray-400"> — actuals are the source of truth; the estimate carries its own track record.</span>
      </div>
      {goalEstimates.length > 0 && (
        <div className="mb-5 flex flex-wrap gap-2">
          {goalEstimates.map(({ goal, est }) => (
            <span key={goal} className="inline-flex items-center gap-1 px-2 py-1 rounded-lg bg-blue-50 text-blue-800 text-xs border border-blue-100">
              <b>{goal}</b> next run ≈ {money(est.predicted)} <span className="text-blue-400">({money(est.low)}–{money(est.high)}, n={est.n})</span>
            </span>
          ))}
        </div>
      )}

      {/* Per-run table */}
      <h2 className="text-sm font-semibold text-gray-700 mb-2">Per-run cost <span className="font-normal text-gray-400">(self-reported)</span></h2>
      <div className="overflow-x-auto border border-gray-200 rounded-lg mb-8">
        <table className="w-full text-sm">
          <thead className="bg-gray-50 text-gray-500 text-xs uppercase tracking-wide">
            <tr>
              <th className="text-left font-medium px-3 py-2">When</th>
              <th className="text-left font-medium px-3 py-2">Search</th>
              <th className="text-left font-medium px-3 py-2">Goal</th>
              <th className="text-right font-medium px-3 py-2">Time</th>
              <th className="text-right font-medium px-3 py-2">Tokens (in/out)</th>
              <th className="text-left font-medium px-3 py-2">Cost by model</th>
              <th className="text-right font-medium px-3 py-2">FC</th>
              <th className="text-right font-medium px-3 py-2">Predicted</th>
              <th className="text-right font-medium px-3 py-2">Actual</th>
              <th className="text-right font-medium px-3 py-2">Δ</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-100">
            {runs.length === 0 && (
              <tr><td colSpan={10} className="px-3 py-8 text-center text-gray-400">No cost rows yet. Run a research search and it will appear here.</td></tr>
            )}
            {runs.map(r => {
              const p = predByRun.get(r.key)
              const dColor = !p ? 'text-gray-300' : Math.abs(p.errorPct) < 25 ? 'text-emerald-600' : Math.abs(p.errorPct) < 50 ? 'text-amber-600' : 'text-red-600'
              return (
              <tr key={r.key} className="hover:bg-gray-50">
                <td className="px-3 py-2 text-gray-500 whitespace-nowrap">{fmtDate(r.createdAt)}</td>
                <td className="px-3 py-2 text-gray-800">{r.name ?? <span className="text-gray-400">—</span>}</td>
                <td className="px-3 py-2 text-gray-500">{r.goal ?? '—'}</td>
                <td className="px-3 py-2 text-right text-gray-500 whitespace-nowrap">{r.runSeconds ? `${r.runSeconds}s` : '—'}</td>
                <td className="px-3 py-2 text-right text-gray-500 whitespace-nowrap">{k(r.inTokens)} / {k(r.outTokens)}</td>
                <td className="px-3 py-2">
                  <div className="flex flex-wrap gap-1">
                    {r.byModel.map(m => (
                      <span key={m.model} className={`inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[11px] ${isCheap(m.model) ? 'bg-emerald-100 text-emerald-700' : 'bg-indigo-100 text-indigo-700'}`} title={m.model}>
                        {modelLabel(m.model)} {money(m.usd)}
                      </span>
                    ))}
                  </div>
                </td>
                <td className="px-3 py-2 text-right text-gray-400">{r.firecrawlCalls || '—'}</td>
                <td className="px-3 py-2 text-right text-gray-500 whitespace-nowrap">{p ? money(p.predicted) : <span className="text-gray-300">—</span>}</td>
                <td className="px-3 py-2 text-right font-medium text-gray-800 whitespace-nowrap">{money(r.usd)}</td>
                <td className={`px-3 py-2 text-right whitespace-nowrap text-[11px] ${dColor}`}>{p ? `${p.errorPct > 0 ? '+' : ''}${p.errorPct}%` : '—'}</td>
              </tr>
            )})}
          </tbody>
        </table>
      </div>

      {/* Source health */}
      <h2 className="text-sm font-semibold text-gray-700 mb-2">Source health (30d)</h2>
      <div className="overflow-x-auto border border-gray-200 rounded-lg max-w-3xl">
        <table className="w-full text-sm">
          <thead className="bg-gray-50 text-gray-500 text-xs uppercase tracking-wide">
            <tr>
              <th className="text-left font-medium px-3 py-2">Source</th>
              <th className="text-right font-medium px-3 py-2">Attempts</th>
              <th className="text-right font-medium px-3 py-2">Success</th>
              <th className="text-right font-medium px-3 py-2">Blocked</th>
              <th className="text-right font-medium px-3 py-2">Avg latency</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-100">
            {health.length === 0 && (
              <tr><td colSpan={5} className="px-3 py-6 text-center text-gray-400">No source attempts logged yet.</td></tr>
            )}
            {health.sort((a, b) => b.attempts - a.attempts).map(s => (
              <tr key={s.sourceId} className="hover:bg-gray-50">
                <td className="px-3 py-2 text-gray-700">{s.sourceId}</td>
                <td className="px-3 py-2 text-right text-gray-500">{s.attempts}</td>
                <td className={`px-3 py-2 text-right ${s.successRate >= 0.7 ? 'text-emerald-600' : s.successRate >= 0.4 ? 'text-amber-600' : 'text-red-600'}`}>{Math.round(s.successRate * 100)}%</td>
                <td className={`px-3 py-2 text-right ${s.blockRate > 0.3 ? 'text-red-600' : 'text-gray-400'}`}>{Math.round(s.blockRate * 100)}%</td>
                <td className="px-3 py-2 text-right text-gray-500">{s.avgLatencyMs}ms</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  )
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="bg-white border border-gray-200 rounded-lg px-4 py-3">
      <p className="text-xs text-gray-400 uppercase tracking-wide">{label}</p>
      <p className="text-2xl font-semibold text-gray-800 mt-1">{value}</p>
    </div>
  )
}
