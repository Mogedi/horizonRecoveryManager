'use client'

import { useEffect, useMemo, useRef, useState, useCallback } from 'react'
import Fuse from 'fuse.js'
import type { FuseResult } from 'fuse.js'
import type { SearchDoc } from '@/app/api/deals/search-index/route'
import { formatAmount } from '@/lib/utils/format'

// ─── Phone detection + normalization ──────────────────────────────────────────

function isPhoneQuery(q: string): boolean {
  const digits = q.replace(/\D/g, '')
  return digits.length >= 4 && digits.length / q.replace(/\s/g, '').length >= 0.6
}

function normalizePhone(q: string): string {
  return q.replace(/\D/g, '')
}

// ─── Fuse config ───────────────────────────────────────────────────────────────

const FUSE_KEYS: Fuse.FuseOptionKey<SearchDoc>[] = [
  { name: 'name', weight: 3 },
  { name: 'contactNames', weight: 3 },
  { name: 'county', weight: 2 },
  { name: 'propertyAddress', weight: 1.5 },
  { name: 'parcelId', weight: 1 },
  { name: 'stageName', weight: 0.5 },
]

// ─── Match reason label ────────────────────────────────────────────────────────

function getMatchReason(result: FuseResult<SearchDoc>, phoneQuery: string | null): string | null {
  if (phoneQuery) {
    const matchedPhone = result.item.phones.find(p => p.replace(/\D/g, '').includes(phoneQuery))
    if (matchedPhone) return `Phone: ${matchedPhone}`
  }
  if (!result.matches || result.matches.length === 0) return null
  const match = result.matches[0]
  const key = match.key ?? ''
  const val = match.value ?? ''
  if (key === 'name') return null  // name is the headline, no need to repeat
  if (key === 'contactNames') return `Contact: ${val}`
  if (key === 'county') return `County: ${val}`
  if (key === 'propertyAddress') return `Address: ${val}`
  if (key === 'parcelId') return `Parcel: ${val}`
  if (key === 'stageName') return `Stage: ${val}`
  return null
}

// ─── Result card ───────────────────────────────────────────────────────────────

function SearchResultCard({
  result,
  phoneQuery,
  isSelected,
  onClick,
}: {
  result: FuseResult<SearchDoc>
  phoneQuery: string | null
  isSelected: boolean
  onClick: () => void
}) {
  const { item } = result
  const reason = getMatchReason(result, phoneQuery)

  return (
    <button
      onClick={onClick}
      className={`w-full text-left px-4 py-3 border-b border-gray-100 transition-all border-l-2 ${
        isSelected
          ? 'border-l-indigo-400 bg-indigo-50 border-l-[3px]'
          : 'border-l-transparent hover:bg-gray-50'
      }`}
    >
      <div className="flex items-start justify-between gap-2 mb-0.5">
        <p className="text-[13px] font-semibold text-gray-900 truncate leading-snug">
          {item.name || 'Unnamed deal'}
        </p>
        {item.amount != null && (
          <p className="text-[11px] text-gray-400 shrink-0 mt-0.5">{formatAmount(item.amount)}</p>
        )}
      </div>
      <p className="text-[11px] text-gray-400 truncate">
        {item.stageName || '—'}{item.county ? ` · ${item.county}` : ''}
      </p>
      {reason && (
        <p className="text-[10px] text-indigo-500 mt-0.5 truncate">{reason}</p>
      )}
    </button>
  )
}

// ─── Main component ────────────────────────────────────────────────────────────

export type DealSearchProps = {
  onSelect: (hubspotId: string) => void
  selectedId: string | null
  onQueryChange: (active: boolean) => void
}

export default function DealSearch({ onSelect, selectedId, onQueryChange }: DealSearchProps) {
  const [query, setQuery] = useState('')
  const [docs, setDocs] = useState<SearchDoc[] | null>(null)
  const [loadError, setLoadError] = useState(false)
  const inputRef = useRef<HTMLInputElement>(null)

  // Fetch search index once
  useEffect(() => {
    fetch('/api/deals/search-index')
      .then(r => r.ok ? r.json() : Promise.reject())
      .then((data: SearchDoc[]) => setDocs(data))
      .catch(() => setLoadError(true))
  }, [])

  // Notify parent when search is active/inactive
  useEffect(() => {
    onQueryChange(query.trim().length >= 2)
  }, [query, onQueryChange])

  // ⌘K or / to focus
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key === 'k') {
        e.preventDefault()
        inputRef.current?.focus()
        inputRef.current?.select()
      }
      if (e.key === '/' && document.activeElement === document.body) {
        e.preventDefault()
        inputRef.current?.focus()
      }
      if (e.key === 'Escape' && query) {
        setQuery('')
        inputRef.current?.blur()
      }
    }
    window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
  }, [query])

  const fuse = useMemo(() => {
    if (!docs) return null
    return new Fuse(docs, {
      keys: FUSE_KEYS,
      threshold: 0.35,
      includeMatches: true,
      includeScore: true,
      minMatchCharLength: 2,
      ignoreLocation: true,
    })
  }, [docs])

  const results = useMemo((): FuseResult<SearchDoc>[] => {
    const q = query.trim()
    if (q.length < 2 || !docs) return []

    if (isPhoneQuery(q)) {
      const digits = normalizePhone(q)
      const phoneMatches = docs
        .filter(d => d.phonesNormalized.some(p => p.includes(digits)))
        .map((item, i) => ({ item, refIndex: i, score: 0, matches: [] }))
      // Also run fuzzy on any remaining non-phone fields
      const fuseMatches = fuse?.search(q) ?? []
      const seen = new Set(phoneMatches.map(r => r.item.hubspotId))
      const extra = fuseMatches.filter(r => !seen.has(r.item.hubspotId))
      return [...phoneMatches, ...extra].slice(0, 30)
    }

    return (fuse?.search(q) ?? []).slice(0, 30)
  }, [query, docs, fuse])

  const phoneQuery = isPhoneQuery(query.trim()) ? normalizePhone(query.trim()) : null
  const isActive = query.trim().length >= 2

  return (
    <div className="flex flex-col min-h-0">
      {/* Search input */}
      <div className="px-3 py-2 border-b border-gray-100 bg-white">
        <div className="relative">
          <span className="absolute left-2.5 top-1/2 -translate-y-1/2 text-gray-300 text-[11px] pointer-events-none">
            ⌕
          </span>
          <input
            ref={inputRef}
            type="text"
            value={query}
            onChange={e => setQuery(e.target.value)}
            placeholder="Search deals, contacts, phones, counties… (⌘K)"
            className="w-full pl-6 pr-8 py-1.5 text-[12px] bg-gray-50 border border-gray-200 rounded-md focus:outline-none focus:ring-1 focus:ring-indigo-300 focus:border-indigo-300 placeholder:text-gray-300"
          />
          {query && (
            <button
              onClick={() => setQuery('')}
              className="absolute right-2 top-1/2 -translate-y-1/2 text-gray-300 hover:text-gray-500 text-sm leading-none"
              aria-label="Clear"
            >
              ×
            </button>
          )}
        </div>
        {loadError && (
          <p className="text-[10px] text-red-400 mt-1">Search index unavailable</p>
        )}
      </div>

      {/* Results */}
      {isActive && (
        <div className="flex-1 overflow-y-auto">
          {results.length === 0 ? (
            <div className="px-4 py-6 text-center">
              <p className="text-sm text-gray-400">No deals found</p>
              <p className="text-[11px] text-gray-300 mt-1">Try a name, contact, phone number, or county</p>
            </div>
          ) : (
            <>
              <p className="px-4 py-1.5 text-[10px] text-gray-400 bg-gray-50 border-b border-gray-100">
                {results.length} result{results.length !== 1 ? 's' : ''}
              </p>
              {results.map(result => (
                <SearchResultCard
                  key={result.item.hubspotId}
                  result={result}
                  phoneQuery={phoneQuery}
                  isSelected={selectedId === result.item.hubspotId}
                  onClick={() => onSelect(result.item.hubspotId)}
                />
              ))}
            </>
          )}
        </div>
      )}
    </div>
  )
}
