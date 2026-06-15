// Pure phone pre-filter rules — FREE decisions made before any paid validation lookup.
// The cheapest validation is the one we never make.

// Durable key: last 10 digits (so +1 / 1 country-code prefixes match).
export const phoneKey = (s: string): string => {
  const d = (s ?? '').replace(/\D/g, '')
  return d.length > 10 ? d.slice(-10) : d
}

// NANP toll-free area codes — these are business/service lines, not a person's cell.
const TOLL_FREE = new Set(['800', '833', '844', '855', '866', '877', '888', '822', '880', '881', '882', '889'])
export function isTollFree(number: string): boolean {
  const k = phoneKey(number)
  return k.length === 10 && TOLL_FREE.has(k.slice(0, 3))
}

// Obvious junk: wrong length, all-same digit, or the 555-01xx fictional range.
export function isLikelyJunk(number: string): boolean {
  const k = phoneKey(number)
  if (k.length !== 10) return true
  if (/^(\d)\1{9}$/.test(k)) return true // 0000000000, 5555555555, …
  if (k.slice(3, 6) === '555' && k.slice(6) >= '0100' && k.slice(6) <= '0199') return true // 555-0100..0199 reserved/fictional
  return false
}

export interface Prefilter { skip: boolean; reason?: string }
// business cases may legitimately want toll-free lines; everyone else skips them.
export function prefilterPhone(number: string, opts?: { business?: boolean }): Prefilter {
  if (isLikelyJunk(number)) return { skip: true, reason: 'invalid/junk format' }
  if (isTollFree(number) && !opts?.business) return { skip: true, reason: 'toll-free/business line' }
  return { skip: false }
}

// Order-insensitive name key for comparing "who a number belongs to" (matches derive's nameKey intent).
export const nameKey = (s: string): string =>
  (s ?? '').toLowerCase().replace(/[^a-z0-9 ]/g, ' ').replace(/\s+/g, ' ').trim()
    .split(' ').filter(t => t.length > 1).sort().join(' ')
