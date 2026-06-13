'use client'

import { useState, useMemo } from 'react'
import useSWR from 'swr'
import { formatAmount } from '@/lib/utils/format'
import DealPanel from '@/components/DealPanel'
import type { ContactQualityRow, ContactQualityTier, ContactAction } from '@/lib/db/contact-quality'

const fetcher = (url: string) => fetch(url).then(r => r.ok ? r.json() : Promise.reject(new Error(r.statusText)))

// ─── Tier / action config ─────────────────────────────────────────────────────

const TIER_META: Record<ContactQualityTier, { label: string; className: string; sortOrder: number }> = {
  none:           { label: 'No Contacts',      className: 'bg-red-100 text-red-700',         sortOrder: 0 },
  thin:           { label: 'Thin (1)',          className: 'bg-orange-100 text-orange-700',   sortOrder: 1 },
  no_phones:      { label: 'No Phones',         className: 'bg-orange-100 text-orange-700',   sortOrder: 2 },
  phone_exhausted:{ label: 'Phone Exhausted',   className: 'bg-amber-100 text-amber-700',     sortOrder: 3 },
  weak:           { label: 'Weak (2–4)',        className: 'bg-yellow-100 text-yellow-700',   sortOrder: 4 },
  working:        { label: 'Working',           className: 'bg-blue-100 text-blue-700',       sortOrder: 5 },
  reached:        { label: 'Reached',           className: 'bg-emerald-100 text-emerald-700', sortOrder: 6 },
}

const ACTION_META: Record<ContactAction, { label: string; className: string }> = {
  skip_trace:   { label: 'Skip-Trace',   className: 'bg-red-50 border border-red-300 text-red-700' },
  add_contacts: { label: 'Add Contacts', className: 'bg-amber-50 border border-amber-300 text-amber-700' },
  keep_calling: { label: 'Keep Calling', className: 'bg-blue-50 border border-blue-300 text-blue-700' },
  monitor:      { label: 'Monitor',      className: 'bg-emerald-50 border border-emerald-300 text-emerald-700' },
  terminal:     { label: 'Closed',       className: 'bg-gray-100 border border-gray-200 text-gray-500' },
}

type FilterKey = 'all' | 'owner_reached' | 'skip_trace' | 'no_answer' | 'reached' | 'never_called'

const FILTER_TABS: { key: FilterKey; label: string }[] = [
  { key: 'all',           label: 'All' },
  { key: 'owner_reached', label: 'Owner Reached' },
  { key: 'skip_trace',    label: 'Skip-Trace Needed' },
  { key: 'no_answer',     label: 'No Answer' },
  { key: 'reached',       label: 'Any Reached' },
  { key: 'never_called',  label: 'Never Called' },
]

type SortKey = 'name' | 'tier' | 'amount' | 'contacts' | 'phones'

// ─── Helpers ──────────────────────────────────────────────────────────────────

function SortArrow({ col, sort, sortAsc }: { col: SortKey; sort: SortKey; sortAsc: boolean }) {
  if (sort !== col) return <span className="text-gray-300 ml-1">↕</span>
  return <span className="text-blue-500 ml-1">{sortAsc ? '↑' : '↓'}</span>
}

function Badge({ children, className }: { children: React.ReactNode; className: string }) {
  return (
    <span className={`inline-flex items-center px-2 py-0.5 rounded text-[11px] font-medium ${className}`}>
      {children}
    </span>
  )
}

function filterRows(rows: ContactQualityRow[], filter: FilterKey): ContactQualityRow[] {
  switch (filter) {
    case 'owner_reached':  return rows.filter(r => r.ownerReached)
    case 'skip_trace':     return rows.filter(r => r.action === 'skip_trace')
    case 'no_answer':      return rows.filter(r => !r.anyReached && r.phonesTried > 0)
    case 'reached':        return rows.filter(r => r.anyReached)
    case 'never_called':   return rows.filter(r => r.phonesTried === 0 && r.totalPhones > 0)
    default: return rows
  }
}

function sortRows(rows: ContactQualityRow[], sort: SortKey, asc: boolean): ContactQualityRow[] {
  return [...rows].sort((a, b) => {
    let cmp = 0
    switch (sort) {
      case 'name':     cmp = (a.dealName ?? '').localeCompare(b.dealName ?? ''); break
      case 'tier':     cmp = TIER_META[a.qualityTier].sortOrder - TIER_META[b.qualityTier].sortOrder; break
      case 'amount':   cmp = (a.amount ?? 0) - (b.amount ?? 0); break
      case 'contacts': cmp = a.contactCountL2 - b.contactCountL2; break
      case 'phones':   cmp = a.totalPhones - b.totalPhones; break
    }
    return asc ? cmp : -cmp
  })
}

function extractShortName(dealName: string | null): { county: string; address: string } {
  if (!dealName) return { county: '', address: '' }
  const normalized = dealName.replace(/ – /g, ' - ')
  const parts = normalized.split(' - ')
  return { county: parts[0]?.trim() ?? '', address: parts[1]?.trim() ?? '' }
}

// ─── Summary KPI strip ────────────────────────────────────────────────────────

function SummaryStrip({ rows }: { rows: ContactQualityRow[] }) {
  const tiles = [
    { label: 'Owner Reached',  value: rows.filter(r => r.ownerReached).length,                           color: 'text-emerald-700' },
    { label: 'Any Reached',    value: rows.filter(r => r.anyReached).length,                             color: 'text-emerald-600' },
    { label: 'Skip-Trace',     value: rows.filter(r => r.action === 'skip_trace').length,                color: 'text-red-700' },
    { label: 'No Answer',      value: rows.filter(r => !r.anyReached && r.phonesTried > 0).length,       color: 'text-amber-700' },
    { label: 'Never Dialed',   value: rows.filter(r => r.phonesTried === 0 && r.totalPhones > 0).length, color: 'text-gray-500' },
  ]

  return (
    <div className="grid grid-cols-5 gap-3">
      {tiles.map(t => (
        <div key={t.label} className="bg-white rounded-xl border border-gray-200 px-4 py-3">
          <p className={`text-2xl font-bold ${t.color}`}>{t.value}</p>
          <p className="text-[11px] text-gray-500 mt-0.5">{t.label}</p>
        </div>
      ))}
    </div>
  )
}

// ─── Main page ────────────────────────────────────────────────────────────────

export default function ContactsPage() {
  const { data: rows = [], error, isLoading } = useSWR<ContactQualityRow[]>('/api/contact-quality', fetcher)
  const [filter, setFilter] = useState<FilterKey>('all')
  const [sort, setSort] = useState<SortKey>('tier')
  const [sortAsc, setSortAsc] = useState(true)
  const [search, setSearch] = useState('')
  const [selectedDealId, setSelectedDealId] = useState<string | null>(null)

  const filtered = useMemo(() => {
    let r = filterRows(rows, filter)
    if (search.trim()) {
      const q = search.trim().toLowerCase()
      r = r.filter(row =>
        (row.dealName ?? '').toLowerCase().includes(q) ||
        (row.ownerName ?? '').toLowerCase().includes(q)
      )
    }
    return sortRows(r, sort, sortAsc)
  }, [rows, filter, sort, sortAsc, search])

  function toggleSort(key: SortKey) {
    if (sort === key) setSortAsc(v => !v)
    else { setSort(key); setSortAsc(true) }
  }

  const tabCounts = useMemo(() => ({
    all:           rows.length,
    owner_reached: rows.filter(r => r.ownerReached).length,
    skip_trace:    rows.filter(r => r.action === 'skip_trace').length,
    no_answer:     rows.filter(r => !r.anyReached && r.phonesTried > 0).length,
    reached:       rows.filter(r => r.anyReached).length,
    never_called:  rows.filter(r => r.phonesTried === 0 && r.totalPhones > 0).length,
  }), [rows])

  if (isLoading) {
    return (
      <div className="flex items-center justify-center h-64 text-sm text-gray-400">
        Loading contact quality…
      </div>
    )
  }

  if (error) {
    return (
      <div className="m-6 px-4 py-3 bg-red-50 border border-red-200 rounded-lg text-sm text-red-700">
        {error.message ?? 'Failed to load'}
      </div>
    )
  }

  return (
    <div className="h-full flex flex-col overflow-hidden">
      {/* Header */}
      <div className="px-8 pt-6 pb-4 border-b border-gray-200 bg-white shrink-0">
        <div className="max-w-6xl mx-auto">
          <h1 className="text-xl font-bold text-gray-900">Contact Quality</h1>
          <p className="text-sm text-gray-400 mt-0.5">
            Contact coverage and reachability across all {rows.length} deals
          </p>
        </div>
      </div>

      {/* Scrollable body */}
      <div className="flex-1 overflow-y-auto">
        <div className="px-8 py-6 max-w-6xl mx-auto space-y-6">

          {/* KPI strip */}
          <SummaryStrip rows={rows} />

          {/* Filter tabs + search */}
          <div className="flex items-center gap-4">
            <div className="flex gap-1 bg-gray-100 rounded-lg p-1 flex-wrap">
              {FILTER_TABS.map(tab => (
                <button
                  key={tab.key}
                  onClick={() => setFilter(tab.key)}
                  className={`px-3 py-1.5 text-xs font-medium rounded-md transition-colors ${
                    filter === tab.key
                      ? 'bg-white text-gray-900 shadow-sm'
                      : 'text-gray-500 hover:text-gray-700'
                  }`}
                >
                  {tab.label}
                  <span className="ml-1.5 text-[10px] text-gray-400">{tabCounts[tab.key]}</span>
                </button>
              ))}
            </div>

            <input
              type="text"
              placeholder="Search deal name or owner…"
              value={search}
              onChange={e => setSearch(e.target.value)}
              className="ml-auto px-3 py-1.5 text-sm border border-gray-200 rounded-lg w-64 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent"
            />
          </div>

          {/* Table */}
          <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
            <table className="w-full text-sm">
              <thead className="bg-gray-50 border-b border-gray-200">
                <tr>
                  <th className="text-left px-4 py-3">
                    <button onClick={() => toggleSort('name')} className="flex items-center text-[11px] font-semibold uppercase tracking-wider text-gray-400 hover:text-gray-600">
                      Deal <SortArrow col="name" sort={sort} sortAsc={sortAsc} />
                    </button>
                  </th>
                  <th className="text-left px-4 py-3 text-[11px] font-semibold uppercase tracking-wider text-gray-400">
                    Owner
                  </th>
                  <th className="text-center px-4 py-3">
                    <button onClick={() => toggleSort('tier')} className="flex items-center gap-1 text-[11px] font-semibold uppercase tracking-wider text-gray-400 hover:text-gray-600">
                      Quality <SortArrow col="tier" sort={sort} sortAsc={sortAsc} />
                    </button>
                  </th>
                  <th className="text-center px-3 py-3">
                    <button onClick={() => toggleSort('contacts')} className="text-[11px] font-semibold uppercase tracking-wider text-gray-400 hover:text-gray-600">
                      Contacts <SortArrow col="contacts" sort={sort} sortAsc={sortAsc} />
                    </button>
                  </th>
                  <th className="text-center px-3 py-3">
                    <button onClick={() => toggleSort('phones')} className="text-[11px] font-semibold uppercase tracking-wider text-gray-400 hover:text-gray-600">
                      Phones <SortArrow col="phones" sort={sort} sortAsc={sortAsc} />
                    </button>
                  </th>
                  <th className="text-center px-3 py-3 text-[11px] font-semibold uppercase tracking-wider text-gray-400">Tried</th>
                  <th className="text-center px-3 py-3 text-[11px] font-semibold uppercase tracking-wider text-gray-400">Live</th>
                  <th className="text-right px-4 py-3">
                    <button onClick={() => toggleSort('amount')} className="text-[11px] font-semibold uppercase tracking-wider text-gray-400 hover:text-gray-600">
                      Value <SortArrow col="amount" sort={sort} sortAsc={sortAsc} />
                    </button>
                  </th>
                  <th className="text-center px-4 py-3 text-[11px] font-semibold uppercase tracking-wider text-gray-400">Action</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-50">
                {filtered.map(row => {
                  const tier = TIER_META[row.qualityTier]
                  const action = ACTION_META[row.action]
                  const { county, address } = extractShortName(row.dealName)
                  const isSelected = selectedDealId === row.dealHubspotId

                  return (
                    <tr
                      key={row.dealHubspotId}
                      onClick={() => setSelectedDealId(row.dealHubspotId)}
                      className={`cursor-pointer transition-colors ${
                        isSelected
                          ? 'bg-blue-50'
                          : row.ownerReached
                          ? 'bg-emerald-50/40 hover:bg-emerald-50'
                          : 'hover:bg-gray-50'
                      }`}
                    >
                      {/* Deal */}
                      <td className="px-4 py-3">
                        <div>
                          <span className="text-[10px] font-semibold text-gray-400 uppercase mr-1.5">{county}</span>
                          <span className="text-[13px] text-gray-800">{address}</span>
                        </div>
                      </td>

                      {/* Owner */}
                      <td className="px-4 py-3">
                        {row.ownerName ? (
                          <div className="flex items-center gap-1.5">
                            <span className="text-[13px] text-gray-700">{row.ownerName}</span>
                            {row.ownerReached && (
                              <span title="Owner reached" className="text-[10px] font-bold text-white bg-emerald-500 rounded px-1 py-px leading-tight">✓</span>
                            )}
                            {!row.ownerReached && row.ownerInContacts && row.anyReached && (
                              <span title="Reached someone, not confirmed owner" className="text-amber-400 text-xs leading-tight">~</span>
                            )}
                          </div>
                        ) : (
                          <span className="text-[12px] text-gray-300">—</span>
                        )}
                      </td>

                      {/* Quality */}
                      <td className="px-4 py-3 text-center">
                        <Badge className={tier.className}>{tier.label}</Badge>
                      </td>

                      {/* Contacts */}
                      <td className="px-3 py-3 text-center">
                        <span className={`text-[13px] font-medium ${
                          row.contactCountL2 === 0 ? 'text-red-500' :
                          row.contactCountL2 === 1 ? 'text-orange-500' :
                          row.contactCountL2 <= 4  ? 'text-amber-600' : 'text-gray-700'
                        }`}>
                          {row.contactCountL2}
                        </span>
                      </td>

                      {/* Phones */}
                      <td className="px-3 py-3 text-center">
                        <span className={`text-[13px] ${row.totalPhones === 0 ? 'text-gray-300' : 'text-gray-600'}`}>
                          {row.totalPhones || '—'}
                        </span>
                      </td>

                      {/* Tried */}
                      <td className="px-3 py-3 text-center">
                        <span className={`text-[13px] ${
                          row.phonesTried === 0 ? 'text-gray-300' :
                          row.phonesTried >= row.totalPhones && row.totalPhones > 0 ? 'text-red-500' :
                          'text-gray-600'
                        }`}>
                          {row.phonesTried || '—'}
                        </span>
                      </td>

                      {/* Live */}
                      <td className="px-3 py-3 text-center">
                        <span className={`text-[13px] font-medium ${
                          row.phonesEverLive > 0 ? 'text-emerald-600' : 'text-gray-300'
                        }`}>
                          {row.phonesEverLive > 0 ? row.phonesEverLive : '—'}
                        </span>
                      </td>

                      {/* Value */}
                      <td className="px-4 py-3 text-right text-[13px] text-gray-600">
                        {row.amount != null ? formatAmount(row.amount) : '—'}
                      </td>

                      {/* Action */}
                      <td className="px-4 py-3 text-center">
                        <Badge className={action.className}>{action.label}</Badge>
                      </td>
                    </tr>
                  )
                })}

                {filtered.length === 0 && (
                  <tr>
                    <td colSpan={9} className="px-4 py-12 text-center text-sm text-gray-400">
                      No deals match this filter
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>

          {/* Tier guide */}
          <div className="bg-gray-50 rounded-xl border border-gray-200 px-5 py-4">
            <p className="text-[11px] font-semibold uppercase tracking-wider text-gray-400 mb-3">Quality Tier Guide</p>
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 text-[12px]">
              <div>
                <Badge className={TIER_META.none.className}>No Contacts</Badge>
                <p className="text-gray-500 mt-1">0 contacts. Skip-trace immediately.</p>
              </div>
              <div>
                <Badge className={TIER_META.phone_exhausted.className}>Phone Exhausted</Badge>
                <p className="text-gray-500 mt-1">All phones tried, zero live answers. May need fresh numbers.</p>
              </div>
              <div>
                <Badge className={TIER_META.weak.className}>Weak (2–4)</Badge>
                <p className="text-gray-500 mt-1">Few contacts. Consider adding more before exhausting outreach.</p>
              </div>
              <div>
                <Badge className={TIER_META.reached.className}>Reached</Badge>
                <p className="text-gray-500 mt-1">
                  Live answer recorded. ✓ = owner name confirmed in contacts. ~ = reached someone, owner unclear.
                </p>
              </div>
            </div>
            <p className="text-[11px] text-gray-400 mt-3">
              Owner matching uses the name in the deal title vs. contact names — heuristic only.
              Future: deed OCR verification will confirm owner identity.
            </p>
          </div>

        </div>
      </div>

      {/* Deal panel — slides in as fixed overlay when a row is selected */}
      {selectedDealId && (
        <DealPanel
          key={selectedDealId}
          hubspotId={selectedDealId}
          onClose={() => setSelectedDealId(null)}
        />
      )}
    </div>
  )
}
