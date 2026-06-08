import type { ReactNode } from 'react'

const MARK = 'bg-amber-200 text-amber-900 rounded-[2px] px-[1px] not-italic'

// Highlight exact Fuse.js index ranges — used in search result cards.
export function highlightByIndices(
  text: string,
  indices: readonly [number, number][]
): ReactNode {
  if (!indices || indices.length === 0) return text
  const nodes: ReactNode[] = []
  let cursor = 0
  for (const [start, end] of indices) {
    if (start > cursor) nodes.push(text.slice(cursor, start))
    nodes.push(<mark key={start} className={MARK}>{text.slice(start, end + 1)}</mark>)
    cursor = end + 1
  }
  if (cursor < text.length) nodes.push(text.slice(cursor))
  return <>{nodes}</>
}

// Highlight a plain query string anywhere it appears in text (case-insensitive).
// Used in the DealPanel where we have the query but not Fuse indices.
export function highlightByQuery(
  text: string | null | undefined,
  query: string
): ReactNode {
  if (!text) return text ?? ''
  const q = query.trim()
  if (q.length < 2) return text

  // Phone query: strip to digits, match substring in digit-only version
  if (isPhoneQuery(q)) {
    return highlightPhone(text, normalizePhone(q))
  }

  const escaped = q.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  const regex = new RegExp(`(${escaped})`, 'gi')
  const parts = text.split(regex)
  if (parts.length === 1) return text
  return (
    <>
      {parts.map((part, i) =>
        i % 2 === 1
          ? <mark key={i} className={MARK}>{part}</mark>
          : part
      )}
    </>
  )
}

// Highlight a matched digit run inside a display-formatted phone number.
// Maps digit positions back to display characters (handles spaces, dashes, parens).
export function highlightPhone(phone: string, digitQuery: string): ReactNode {
  const digits = phone.replace(/\D/g, '')
  const idx = digits.indexOf(digitQuery)
  if (idx < 0) return phone

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
  return highlightByIndices(phone, [[start, end]])
}

export function isPhoneQuery(q: string): boolean {
  const digits = q.replace(/\D/g, '')
  return digits.length >= 4 && digits.length / q.replace(/\s/g, '').length >= 0.6
}

export function normalizePhone(q: string): string {
  return q.replace(/\D/g, '')
}
