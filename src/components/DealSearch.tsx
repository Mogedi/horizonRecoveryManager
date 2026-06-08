'use client'

import { useEffect, useMemo, useRef, useState } from 'react'
import Fuse from 'fuse.js'
import type { FuseResult, RangeTuple } from 'fuse.js'
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

// ─── Text highlighting ────────────────────────────────────────────────────────
// Uses Fuse's [start, end] index pairs to split text into plain/highlighted runs.

function highlightText(text: string, indices: readonly RangeTuple[]): React.ReactNode {
  if (!indices || indices.length === 0) return text
  const nodes: React.ReactNode[] = []
  let cursor = 0
  for (const [start, end] of indices) {
    if (start > cursor) nodes.push(text.slice(cursor, start))
    nodes.push(
      <mark key={start} className="bg-amber-200 text-amber-900 rounded-[2px] px-[1px] not-italic">
        {text.slice(start, end + 1)}
      </mark>
    )
    cursor = end + 1
  }
  if (cursor < text.length) nodes.push(text.slice(cursor))
  return <>{nodes}</>
}

// Highlight a phone number where the matched digit substring appears.
// Searches for the digit run in the display string and highlights that span.
function highlightPhone(phone: string, digitQuery: string): React.ReactNode {
  const digits = phone.replace(/\D/g, '')
  const idx = digits.indexOf(digitQuery)
  if (idx < 0) return phone

  // Map digit position back to display character position
  let digitCount = 0
  let start = -1
  let end = -1
  for (let i = 0; i < phone.length; i++) {
    if (/\d/.test(phone[i])) {
      if (digitCount === idx) start = i
      if (digitCount === idx + digitQuery.length - 1) { end = i; break }
      digitCount++
    }
  }
  if (start < 0 || end < 0) return phone
  return highlightText(phone, [[start, end]])
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
  const { item, matches = [] } = result

  // Build a lookup: field key → match (for non-array fields)
  // For array fields like contactNames, keep all matches for that key
  const matchByKey = new Map<string, typeof matches[0]>()
  for (const m of matches) {
    if (m.key && !matchByKey.has(m.key)) matchByKey.set(m.key, m)
  }

  // Deal name — highlight if name matched
  const nameMatch = matchByKey.get('name')
  const nameNode = nameMatch?.indices
    ? highlightText(item.name || 'Unnamed deal', nameMatch.indices)
    : (item.name || 'Unnamed deal')

  // County — highlight if county matched
  const countyMatch = matchByKey.get('county')
  const countyNode = item.county
    ? (countyMatch?.indices ? highlightText(item.county, countyMatch.indices) : item.county)
    : null

  // Stage — highlight if stage matched
  const stageMatch = matchByKey.get('stageName')
  const stageNode = stageMatch?.indices
    ? highlightText(item.stageName || '—', stageMatch.indices)
    : (item.stageName || '—')

  // Secondary match lines — show the most relevant non-name matched field
  const secondaryLines: React.ReactNode[] = []

  if (phoneQuery) {
    const matchedPhone = item.phones.find(p => p.replace(/\D/g, '').includes(phoneQuery))
    if (matchedPhone) {
      secondaryLines.push(
        <span key="phone" className="text-[10px] text-gray-500">
          Phone: {highlightPhone(matchedPhone, phoneQuery)}
        </span>
      )
    }
  }

  // Contact name match
  const contactMatch = matchByKey.get('contactNames')
  if (contactMatch?.value && contactMatch.indices) {
    secondaryLines.push(
      <span key="contact" className="text-[10px] text-gray-500">
        Contact: {highlightText(contactMatch.value, contactMatch.indices)}
      </span>
    )
  }

  // Address match
  const addrMatch = matchByKey.get('propertyAddress')
  if (addrMatch?.value && addrMatch.indices) {
    secondaryLines.push(
      <span key="addr" className="text-[10px] text-gray-500">
        Address: {highlightText(addrMatch.value, addrMatch.indices)}
      </span>
    )
  }

  // Parcel match
  const parcelMatch = matchByKey.get('parcelId')
  if (parcelMatch?.value && parcelMatch.indices) {
    secondaryLines.push(
      <span key="parcel" className="text-[10px] text-gray-500">
        Parcel: {highlightText(parcelMatch.value, parcelMatch.indices)}
      </span>
    )
  }

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
          {nameNode}
        </p>
        {item.amount != null && (
          <p className="text-[11px] text-gray-400 shrink-0 mt-0.5">{formatAmount(item.amount)}</p>
        )}
      </div>
      <p className="text-[11px] text-gray-400 truncate">
        {stageNode}{countyNode ? <> · {countyNode}</> : null}
      </p>
      {secondaryLines.length > 0 && (
        <div className="flex flex-col gap-0.5 mt-0.5">
          {secondaryLines.slice(0, 2)}
        </div>
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

  useEffect(() => {
    fetch('/api/deals/search-index')
      .then(r => r.ok ? r.json() : Promise.reject())
      .then((data: SearchDoc[]) => setDocs(data))
      .catch(() => setLoadError(true))
  }, [])

  useEffect(() => {
    onQueryChange(query.trim().length >= 2)
  }, [query, onQueryChange])

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
        .map((item, i) => ({ item, refIndex: i, score: 0, matches: [] as never[] }))
      const fuseMatches = fuse?.search(q) ?? []
      const seen = new Set(phoneMatches.map(r => r.item.hubspotId))
      return [...phoneMatches, ...fuseMatches.filter(r => !seen.has(r.item.hubspotId))].slice(0, 30)
    }

    return (fuse?.search(q) ?? []).slice(0, 30)
  }, [query, docs, fuse])

  const phoneQuery = isPhoneQuery(query.trim()) ? normalizePhone(query.trim()) : null
  const isActive = query.trim().length >= 2

  return (
    <div className="flex flex-col min-h-0">
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
        {loadError && <p className="text-[10px] text-red-400 mt-1">Search index unavailable</p>}
      </div>

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
