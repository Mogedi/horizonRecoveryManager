'use client'

import { useState } from 'react'
import useSWR from 'swr'
import { StatCard } from '@/components/analytics/StatCard'
import { SegmentBar } from '@/components/analytics/SegmentBar'
import { formatAmount } from '@/lib/utils/format'
import type { PortfolioAnalytics } from '@/lib/db/analytics'

const fetcher = (url: string) => fetch(url).then(r => r.ok ? r.json() : Promise.reject(new Error(r.statusText)))

// ─── Segment configs ──────────────────────────────────────────────────────────

const CALL_INTENSITY_SEGMENTS = [
  { key: 'exhausted',    label: 'Exhausted (7+d)',  colorClass: 'bg-rose-400',   textClass: 'text-rose-700' },
  { key: 'working',      label: 'Working (3–6d)',   colorClass: 'bg-amber-300',  textClass: 'text-amber-700' },
  { key: 'light',        label: 'Light (1–2d)',     colorClass: 'bg-blue-300',   textClass: 'text-blue-700' },
  { key: 'never_called', label: 'Never Called',     colorClass: 'bg-gray-200',   textClass: 'text-gray-500' },
]

const BUCKET_SEGMENTS = [
  { key: 'xlarge', label: '$100K+',       colorClass: 'bg-violet-500', textClass: 'text-violet-700' },
  { key: 'large',  label: '$50K–$100K',  colorClass: 'bg-blue-400',   textClass: 'text-blue-700' },
  { key: 'mid',    label: '$15K–$50K',   colorClass: 'bg-emerald-400', textClass: 'text-emerald-700' },
  { key: 'small',  label: '<$15K',       colorClass: 'bg-gray-300',   textClass: 'text-gray-500' },
]

// ─── Helpers ──────────────────────────────────────────────────────────────────

function formatMillions(n: number): string {
  if (n >= 1_000_000) return `$${(n / 1_000_000).toFixed(1)}M`
  if (n >= 1_000)     return `$${Math.round(n / 1_000)}K`
  return `$${Math.round(n)}`
}

function SectionHeader({ title }: { title: string }) {
  return (
    <div className="flex items-center gap-3 mb-4">
      <h2 className="text-xs font-semibold uppercase tracking-wider text-gray-400">{title}</h2>
      <div className="flex-1 h-px bg-gray-100" />
    </div>
  )
}

// ─── County table ─────────────────────────────────────────────────────────────

function CountyTable({ data }: { data: PortfolioAnalytics['byCounty'] }) {
  const [showAll, setShowAll] = useState(false)
  const rows = showAll ? data : data.slice(0, 15)

  return (
    <div>
      <table className="w-full text-sm">
        <thead>
          <tr className="border-b border-gray-100">
            <th className="text-left py-2 text-[10px] font-semibold uppercase tracking-wider text-gray-400 pr-4">State</th>
            <th className="text-left py-2 text-[10px] font-semibold uppercase tracking-wider text-gray-400 pr-4">County</th>
            <th className="text-right py-2 text-[10px] font-semibold uppercase tracking-wider text-gray-400 pr-4">Deals</th>
            <th className="text-right py-2 text-[10px] font-semibold uppercase tracking-wider text-gray-400 pr-4">Value</th>
            <th className="text-right py-2 text-[10px] font-semibold uppercase tracking-wider text-gray-400">Avg Age</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-gray-50">
          {rows.map((row, i) => (
            <tr key={i} className="hover:bg-gray-50 transition-colors">
              <td className="py-2 pr-4">
                <span className="text-[11px] font-medium text-gray-500 bg-gray-100 rounded px-1.5 py-0.5">{row.state}</span>
              </td>
              <td className="py-2 pr-4 text-[13px] font-medium text-gray-800">{row.county}</td>
              <td className="py-2 pr-4 text-right text-[13px] text-gray-700">{row.deals}</td>
              <td className="py-2 pr-4 text-right text-[13px] text-gray-700">{formatAmount(row.value) ?? '—'}</td>
              <td className="py-2 text-right text-[12px] text-gray-400">
                {row.avgCaseAgeMonths != null ? `${Math.round(row.avgCaseAgeMonths)}mo` : '—'}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      {data.length > 15 && (
        <button
          onClick={() => setShowAll(v => !v)}
          className="mt-2 text-xs text-blue-600 hover:text-blue-800"
        >
          {showAll ? 'Show less' : `Show all ${data.length} counties`}
        </button>
      )}
    </div>
  )
}

// ─── Vintage bars ─────────────────────────────────────────────────────────────

function VintageBars({ data }: { data: PortfolioAnalytics['byVintage'] }) {
  const maxDeals = Math.max(...data.map(d => d.deals), 1)

  return (
    <div className="space-y-2">
      {data.map(row => (
        <div key={row.year} className="flex items-center gap-3">
          <span className="text-[12px] text-gray-500 w-10 shrink-0">{row.year}</span>
          <div className="flex-1 bg-gray-100 rounded-full h-2 overflow-hidden">
            <div
              className="bg-violet-400 h-full rounded-full transition-all"
              style={{ width: `${(row.deals / maxDeals) * 100}%` }}
            />
          </div>
          <span className="text-[12px] text-gray-700 w-16 text-right shrink-0">
            {row.deals} · {formatMillions(row.value)}
          </span>
        </div>
      ))}
    </div>
  )
}

// ─── State split bar ──────────────────────────────────────────────────────────

function StateSplitBar({ data }: { data: PortfolioAnalytics['byState'] }) {
  const STATE_COLORS: Record<string, string> = {
    GA: 'bg-blue-500',
    FL: 'bg-emerald-500',
  }
  const segments = data.map(s => ({
    key: s.state,
    label: `${s.state} (${s.deals})`,
    value: s.deals,
    colorClass: STATE_COLORS[s.state] ?? 'bg-gray-400',
  }))

  return <SegmentBar segments={segments} height="h-4" />
}

// ─── Main page ────────────────────────────────────────────────────────────────

export default function PipelinePage() {
  const { data, error, isLoading } = useSWR<PortfolioAnalytics>('/api/analytics', fetcher)

  if (isLoading) {
    return (
      <div className="flex items-center justify-center h-64 text-sm text-gray-400">
        Loading analytics…
      </div>
    )
  }

  if (error || !data) {
    return (
      <div className="m-6 px-4 py-3 bg-red-50 border border-red-200 rounded-lg text-sm text-red-700">
        {error?.message ?? 'Failed to load analytics'}
      </div>
    )
  }

  // Build intensity map for segment bar
  const intensityMap = Object.fromEntries(data.byCallIntensity.map(r => [r.tier, r.deals]))
  const intensitySegments = CALL_INTENSITY_SEGMENTS.map(s => ({
    ...s,
    value: intensityMap[s.key] ?? 0,
  }))

  const bucketMap = Object.fromEntries(data.byAmountBucket.map(r => [r.bucket, r.deals]))
  const bucketSegments = BUCKET_SEGMENTS.map(s => ({
    ...s,
    value: bucketMap[s.key] ?? 0,
  }))

  const gaData = data.byState.find(s => s.state === 'GA')
  const flData = data.byState.find(s => s.state === 'FL')

  return (
    <div className="px-8 py-6 max-w-5xl mx-auto space-y-10">

      {/* Page header */}
      <div>
        <h1 className="text-xl font-bold text-gray-900">Pipeline Health</h1>
        <p className="text-sm text-gray-400 mt-0.5">Portfolio overview — all {data.totalDeals} active deals</p>
      </div>

      {/* KPI row */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        <StatCard
          label="Total Value"
          primary={formatMillions(data.totalValue)}
          sub={`${data.totalDeals} deals`}
        />
        <StatCard
          label="Avg Case Age"
          primary={data.avgCaseAgeMonths != null ? `${Math.round(data.avgCaseAgeMonths)}mo` : '—'}
          sub="since tax sale date"
        />
        <StatCard
          label="Georgia"
          primary={gaData ? `${gaData.deals}` : '—'}
          sub={gaData ? formatMillions(gaData.value) : undefined}
          accent="blue"
        />
        <StatCard
          label="Florida"
          primary={flData ? `${flData.deals}` : '—'}
          sub={flData ? formatMillions(flData.value) : undefined}
          accent="green"
        />
      </div>

      {/* Geography */}
      <section>
        <SectionHeader title="Geography" />
        <div className="bg-white rounded-xl border border-gray-200 p-5 space-y-6">
          <div>
            <p className="text-xs text-gray-400 mb-2">State split — deals</p>
            <StateSplitBar data={data.byState} />
          </div>
          <div>
            <p className="text-xs text-gray-400 mb-3">Top counties by value</p>
            <CountyTable data={data.byCounty} />
          </div>
        </div>
      </section>

      {/* Outreach coverage */}
      <section>
        <SectionHeader title="Outreach Coverage" />
        <div className="bg-white rounded-xl border border-gray-200 p-5 space-y-4">
          <SegmentBar segments={intensitySegments} height="h-4" />
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 pt-2">
            {CALL_INTENSITY_SEGMENTS.map(s => {
              const count = intensityMap[s.key] ?? 0
              const sublabels: Record<string, string> = {
                never_called: 'Not yet dialed',
                light:        '1–2 days called',
                working:      '3–6 days called',
                exhausted:    '7+ days called',
              }
              return (
                <div key={s.key} className="rounded-lg border border-gray-100 px-4 py-3">
                  <p className={`text-2xl font-bold ${s.textClass}`}>{count}</p>
                  <p className="text-[11px] text-gray-500 mt-0.5">{sublabels[s.key]}</p>
                </div>
              )
            })}
          </div>
        </div>
      </section>

      {/* Vintage */}
      <section>
        <SectionHeader title="Tax Sale Vintage" />
        <div className="bg-white rounded-xl border border-gray-200 p-5">
          <VintageBars data={data.byVintage} />
        </div>
      </section>

      {/* Amount distribution */}
      <section>
        <SectionHeader title="Amount Distribution" />
        <div className="bg-white rounded-xl border border-gray-200 p-5 space-y-4">
          <SegmentBar segments={bucketSegments} height="h-4" />
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 pt-2">
            {BUCKET_SEGMENTS.map(s => {
              const row = data.byAmountBucket.find(r => r.bucket === s.key)
              return (
                <div key={s.key} className="rounded-lg border border-gray-100 px-4 py-3">
                  <p className={`text-2xl font-bold ${s.textClass}`}>{row?.deals ?? 0}</p>
                  <p className="text-[11px] text-gray-500 mt-0.5">{s.label}</p>
                  {row && <p className="text-[11px] text-gray-400">{formatAmount(row.value)}</p>}
                </div>
              )
            })}
          </div>
        </div>
      </section>

    </div>
  )
}
