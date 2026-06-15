import Link from 'next/link'
import { getResearchRunTelemetry, getCostTrend, getSourceHealth } from '@/lib/db/research'

// Cost + spend telemetry for the research agent. One row per run, LLM cost split by model so the
// Haiku-vs-Sonnet routing is visible. Server component — reads the DB directly (auth via middleware).
export const dynamic = 'force-dynamic'

const money = (n: number) => (n >= 1 ? `$${n.toFixed(2)}` : `$${n.toFixed(4)}`)
const k = (n: number) => (n >= 1000 ? `${(n / 1000).toFixed(1)}k` : String(n))
const modelLabel = (m: string) => m.replace('claude-', '').replace('-4-5', ' 4.5').replace('-4-6', ' 4.6').replace('-4-8', ' 4.8')
const isCheap = (m: string) => m.toLowerCase().includes('haiku')
const fmtDate = (d: Date) => new Date(d).toLocaleString('en-US', { timeZone: 'America/New_York', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })

export default async function ResearchTelemetryPage() {
  const [runs, trend, health] = await Promise.all([
    getResearchRunTelemetry(60),
    getCostTrend(60),
    getSourceHealth(30),
  ])

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

      {/* Per-run table */}
      <h2 className="text-sm font-semibold text-gray-700 mb-2">Per-run cost</h2>
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
              <th className="text-right font-medium px-3 py-2">Total</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-100">
            {runs.length === 0 && (
              <tr><td colSpan={8} className="px-3 py-8 text-center text-gray-400">No cost rows yet. Run a research search and it will appear here.</td></tr>
            )}
            {runs.map(r => (
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
                <td className="px-3 py-2 text-right font-medium text-gray-800 whitespace-nowrap">{money(r.usd)}</td>
              </tr>
            ))}
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
